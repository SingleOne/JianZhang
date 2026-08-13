import { net, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJsonSync } from './file-storage'
import pdfParse from 'pdf-parse'
import {
  companyReportVariant,
  companyReportYear,
  createCompanyReportSummaryExcerpt,
  isAmendedCompanyReport,
  limitCompanyReportsToRecentYears,
  normalizeCompanyReportTitle,
  parseCompanyReportSummary,
  sortCompanyReports
} from '../../src/lib/company-reports'
import type {
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportSummary,
  CompanyReportType
} from '../../src/shared/types'
import type {
  AiStructuredTaskRequest,
  AiStructuredTaskResult
} from '../../src/modules/ai/shared/types'

const STOCK_LIST_URL = 'https://www.cninfo.com.cn/new/data/szse_stock.json'
const ANNOUNCEMENT_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
const PDF_BASE_URL = 'https://static.cninfo.com.cn/'
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const PAGE_SIZE = 30
const SUMMARY_PROMPT = `你是上市公司定期报告摘要助手。只能依据用户提供的财报原文摘录，不得补充外部信息或猜测未披露内容。

输出必须是 JSON 对象，且只包含 managementDiscussion、auditOpinion、financialStatementNotes、aiConclusion：
- managementDiscussion：用 100—220 字总结管理层讨论中的主营业务变化、经营趋势、收入利润、现金流、资本开支和明确风险；摘录未包含时为 null。
- auditOpinion：用 50—150 字总结审计意见类型、持续经营事项和关键审计事项；未经审计或摘录未包含时为 null。
- financialStatementNotes：用 80—180 字总结附注中对长期判断重要的会计政策变化、减值、或有事项、关联交易、债务及其他异常；摘录未包含时为 null。
- aiConclusion：用 100—220 字综合前三部分及报告中的资产负债信息，概括经营质量、财务安全和主要不确定性；不得给出买卖建议、目标价或收益承诺。

格式必须为 {"managementDiscussion":"...","auditOpinion":"...","financialStatementNotes":"...","aiConclusion":"..."}，没有依据的前三项使用 null。
所有非 null 字段必须是纯文本，不得使用 Markdown、标题、列表或“根据摘录”等开场白。`
const REPORT_CATEGORIES: Record<CompanyReportType, string> = {
  annual: 'category_ndbg_szsh;',
  semiannual: 'category_bndbg_szsh;',
  firstQuarter: 'category_yjdbg_szsh;',
  thirdQuarter: 'category_sjdbg_szsh;'
}
const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.cninfo.com.cn',
  Referer: 'https://www.cninfo.com.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'X-Requested-With': 'XMLHttpRequest'
}

interface CninfoStock {
  code?: string
  orgId?: string
  category?: string
}

interface CninfoAnnouncement {
  announcementId?: string
  announcementTitle?: string
  announcementTime?: number
  adjunctUrl?: string
  secCode?: string
}

interface CninfoAnnouncementResponse {
  announcements?: CninfoAnnouncement[] | null
  totalAnnouncement?: number
}

type RunStructuredTask = (
  request: AiStructuredTaskRequest,
  signal: AbortSignal
) => Promise<AiStructuredTaskResult>

export class CompanyReportService {
  private readonly cacheDirectory: string
  private stockOrganizations: Promise<Map<string, string>> | null = null

  constructor(userDataDirectory: string) {
    this.cacheDirectory = join(userDataDirectory, 'company-reports')
  }

  async get(code: string, forceRefresh = false): Promise<CompanyReportLibraryResult> {
    if (!/^\d{6}$/.test(code)) throw new Error('财报库仅支持六位 A 股代码')
    const cached = this.readCache(code)
    if (
      !forceRefresh &&
      cached &&
      Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE
    ) {
      return this.attachSummaries({ ...this.limitToRecentYears(cached), fromCache: true })
    }

    try {
      const result = this.limitToRecentYears(await this.fetch(code))
      this.writeCache(result)
      return this.attachSummaries(result)
    } catch (reason) {
      if (!cached) throw reason
      return this.attachSummaries({
        ...this.limitToRecentYears(cached),
        fromCache: true,
        warning: `在线更新失败，当前显示本地缓存：${reason instanceof Error ? reason.message : '未知错误'}`
      })
    }
  }

  async generateSummary(
    report: CompanyReportItem,
    runStructuredTask: RunStructuredTask
  ): Promise<CompanyReportSummary> {
    if (!/^\d{6}$/.test(report.code)) throw new Error('财报股票代码无效')
    this.validateReportUrl(report.url)
    const response = await net.fetch(report.url, {
      headers: {
        Referer: 'https://www.cninfo.com.cn/',
        'User-Agent': REQUEST_HEADERS['User-Agent']
      },
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) throw new Error(`财报 PDF 下载失败：HTTP ${response.status}`)
    const parsed = await pdfParse(Buffer.from(await response.arrayBuffer()))
    const excerpt = createCompanyReportSummaryExcerpt(parsed.text)
    if (!excerpt) throw new Error('财报 PDF 没有提取到可总结的文字')

    const result = await runStructuredTask(
      {
        systemPrompt: SUMMARY_PROMPT,
        userContent: JSON.stringify({
          code: report.code,
          title: report.title,
          reportType: report.reportType,
          reportYear: report.reportYear,
          publishedAt: report.publishedAt,
          excerpt
        })
      },
      AbortSignal.timeout(180_000)
    )
    const sections = parseCompanyReportSummary(result.content)
    const summary: CompanyReportSummary = {
      reportId: report.id,
      code: report.code,
      content: sections.aiConclusion.slice(0, 1_000),
      managementDiscussion: sections.managementDiscussion?.slice(0, 1_000) ?? null,
      auditOpinion: sections.auditOpinion?.slice(0, 1_000) ?? null,
      financialStatementNotes: sections.financialStatementNotes?.slice(0, 1_000) ?? null,
      aiConclusion: sections.aiConclusion.slice(0, 1_000),
      reportTitle: report.title,
      reportType: report.reportType,
      reportYear: report.reportYear,
      publishedAt: report.publishedAt,
      generatedAt: new Date().toISOString(),
      providerId: result.providerId,
      model: result.model
    }
    const summaries = this.readSummaries()
    summaries[report.id] = summary
    this.writeSummaries(summaries)
    return summary
  }

  getSummaries(code: string): CompanyReportSummary[] {
    const reports = new Map(
      (this.readCache(code)?.reports ?? []).map((report) => [report.id, report])
    )
    return Object.values(this.readSummaries())
      .filter((summary) => summary.code === code)
      .map((summary) => {
        const report = reports.get(summary.reportId)
        return {
          ...summary,
          reportTitle: summary.reportTitle ?? report?.title,
          reportType: summary.reportType ?? report?.reportType,
          reportYear: summary.reportYear ?? report?.reportYear,
          publishedAt: summary.publishedAt ?? report?.publishedAt
        }
      })
      .sort(
        (left, right) =>
          (right.reportYear ?? 0) - (left.reportYear ?? 0) ||
          (right.publishedAt ?? right.generatedAt).localeCompare(
            left.publishedAt ?? left.generatedAt
          )
      )
  }

  async open(url: string): Promise<void> {
    this.validateReportUrl(url)
    await shell.openExternal(url)
  }

  private async fetch(code: string): Promise<CompanyReportLibraryResult> {
    const organizations = await this.getStockOrganizations()
    const orgId = organizations.get(code)
    if (!orgId) throw new Error(`巨潮资讯未找到股票 ${code}`)

    const now = new Date()
    const periodStart = `${now.getFullYear() - 5}-01-01`
    const periodEnd = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-')
    const reportsByType = await Promise.all(
      (Object.keys(REPORT_CATEGORIES) as CompanyReportType[]).map((reportType) =>
        this.fetchReportType(code, orgId, reportType, periodStart, periodEnd)
      )
    )
    const unique = new Map(reportsByType.flat().map((report) => [report.id, report]))
    return {
      code,
      source: '巨潮资讯',
      periodStart,
      periodEnd,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      reports: sortCompanyReports([...unique.values()])
    }
  }

  private async fetchReportType(
    code: string,
    orgId: string,
    reportType: CompanyReportType,
    periodStart: string,
    periodEnd: string
  ): Promise<CompanyReportItem[]> {
    const first = await this.fetchReportPage(code, orgId, reportType, periodStart, periodEnd, 1)
    const pageCount = Math.max(1, Math.ceil((first.totalAnnouncement ?? 0) / PAGE_SIZE))
    const remaining = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        this.fetchReportPage(code, orgId, reportType, periodStart, periodEnd, index + 2)
      )
    )
    return [first, ...remaining].flatMap((payload) =>
      (payload.announcements ?? []).flatMap((item): CompanyReportItem[] => {
        if (
          !item.announcementId ||
          !item.announcementTitle ||
          !item.announcementTime ||
          !item.adjunctUrl
        ) {
          return []
        }
        const title = normalizeCompanyReportTitle(item.announcementTitle)
        const publishedAt = new Date(item.announcementTime).toISOString()
        return [
          {
            id: item.announcementId,
            code,
            title,
            reportType,
            reportYear: companyReportYear(title, reportType, publishedAt),
            variant: companyReportVariant(title),
            amended: isAmendedCompanyReport(title),
            publishedAt,
            url: new URL(item.adjunctUrl, PDF_BASE_URL).toString()
          }
        ]
      })
    )
  }

  private async fetchReportPage(
    code: string,
    orgId: string,
    reportType: CompanyReportType,
    periodStart: string,
    periodEnd: string,
    pageNumber: number
  ): Promise<CninfoAnnouncementResponse> {
    const { column, plate } = this.marketParams(code, orgId)
    const body = new URLSearchParams({
      pageNum: String(pageNumber),
      pageSize: String(PAGE_SIZE),
      column,
      tabName: 'fulltext',
      plate,
      stock: `${code},${orgId}`,
      searchkey: '',
      secid: '',
      category: REPORT_CATEGORIES[reportType],
      trade: '',
      seDate: `${periodStart}~${periodEnd}`,
      sortName: 'time',
      sortType: 'desc',
      isHLtitle: 'true'
    })
    return this.requestJson<CninfoAnnouncementResponse>(ANNOUNCEMENT_URL, {
      method: 'POST',
      headers: {
        ...REQUEST_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString()
    })
  }

  private getStockOrganizations(): Promise<Map<string, string>> {
    if (!this.stockOrganizations) {
      this.stockOrganizations = this.requestJson<{ stockList?: CninfoStock[] }>(STOCK_LIST_URL, {
        headers: REQUEST_HEADERS
      })
        .then(
          (payload) =>
            new Map(
              (payload.stockList ?? [])
                .filter(
                  (item): item is CninfoStock & { code: string; orgId: string } =>
                    item.category === 'A股' && Boolean(item.code && item.orgId)
                )
                .map((item) => [item.code, item.orgId])
            )
        )
        .catch((reason) => {
          this.stockOrganizations = null
          throw reason
        })
    }
    return this.stockOrganizations
  }

  private marketParams(code: string, orgId: string): { column: string; plate: string } {
    if (orgId.includes('bj')) return { column: 'szse', plate: 'bj' }
    if (code.startsWith('6')) return { column: 'sse', plate: 'sh' }
    return { column: 'szse', plate: 'sz' }
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await net.fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`请求巨潮资讯失败：HTTP ${response.status}`)
    return response.json() as Promise<T>
  }

  private validateReportUrl(url: string): void {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.cninfo.com.cn') {
      throw new Error('只能读取巨潮资讯的财报原文')
    }
  }

  private limitToRecentYears(result: CompanyReportLibraryResult): CompanyReportLibraryResult {
    const reports = limitCompanyReportsToRecentYears(
      result.reports.map((report) => ({
        ...report,
        reportYear: companyReportYear(report.title, report.reportType, report.publishedAt)
      }))
    )
    const earliestYear =
      reports.length > 0 ? Math.min(...reports.map((report) => report.reportYear)) : null
    return {
      ...result,
      periodStart: earliestYear === null ? result.periodStart : `${earliestYear}-01-01`,
      reports
    }
  }

  private attachSummaries(result: CompanyReportLibraryResult): CompanyReportLibraryResult {
    const summaries = this.readSummaries()
    return {
      ...result,
      reports: result.reports.map((report) => ({
        ...report,
        summary: summaries[report.id]
      }))
    }
  }

  private summariesPath(): string {
    return join(this.cacheDirectory, 'summaries.json')
  }

  private readSummaries(): Record<string, CompanyReportSummary> {
    const path = this.summariesPath()
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, CompanyReportSummary>)
      : {}
  }

  private writeSummaries(summaries: Record<string, CompanyReportSummary>): void {
    mkdirSync(this.cacheDirectory, { recursive: true })
    atomicWriteJsonSync(this.summariesPath(), summaries)
  }

  private cachePath(code: string): string {
    return join(this.cacheDirectory, `${code}.json`)
  }

  private readCache(code: string): CompanyReportLibraryResult | null {
    const path = this.cachePath(code)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as CompanyReportLibraryResult
  }

  private writeCache(result: CompanyReportLibraryResult): void {
    mkdirSync(this.cacheDirectory, { recursive: true })
    atomicWriteJsonSync(this.cachePath(result.code), result)
  }
}
