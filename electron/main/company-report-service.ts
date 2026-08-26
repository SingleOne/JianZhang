import { net, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pdfParse from 'pdf-parse'
import {
  createCompanyReportSummaryExcerpt,
  limitCompanyReportsToRecentYears,
  parseCompanyReportSummary
} from '../../src/lib/company-reports'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import type {
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportSummary,
  StockMarket
} from '../../src/shared/types'
import type {
  AiStructuredTaskRequest,
  AiStructuredTaskResult
} from '../../src/modules/ai/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import type { CompanyReportProvider } from './company-report-provider'
import { CninfoCompanyReportProvider } from './cninfo-company-report-provider'
import { HkexCompanyReportProvider } from './hkex-company-report-provider'
import { SecCompanyReportProvider } from './sec-company-report-provider'
import { SecEdgarClient } from './sec-edgar-client'

const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const SUMMARY_PROMPT = `你是上市公司定期报告摘要助手。只能依据用户提供的官方财报原文摘录，不得补充外部信息或猜测未披露内容。

输出必须是 JSON 对象，且只包含 managementDiscussion、auditOpinion、financialStatementNotes、aiConclusion：
- managementDiscussion：用 100—220 字总结管理层讨论中的主营业务变化、经营趋势、收入利润、现金流、资本开支和明确风险；摘录未包含时为 null。
- auditOpinion：用 50—150 字总结审计意见类型、持续经营事项和关键审计事项；未经审计或摘录未包含时为 null。
- financialStatementNotes：用 80—180 字总结附注中对长期判断重要的会计政策变化、减值、或有事项、关联交易、债务及其他异常；摘录未包含时为 null。
- aiConclusion：用 100—220 字综合前三部分及报告中的资产负债信息，概括经营质量、财务安全和主要不确定性；不得给出买卖建议、目标价或收益承诺。

格式必须为 {"managementDiscussion":"...","auditOpinion":"...","financialStatementNotes":"...","aiConclusion":"..."}，没有依据的前三项使用 null。
所有非 null 字段必须使用中文纯文本，不得使用 Markdown、标题、列表或“根据摘录”等开场白。`
const REPORT_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.sec.gov',
  'sec.gov',
  'www1.hkexnews.hk',
  'www.hkexnews.hk'
])

type RunStructuredTask = (
  request: AiStructuredTaskRequest,
  signal: AbortSignal
) => Promise<AiStructuredTaskResult>

export class CompanyReportService {
  private readonly cacheDirectory: string
  private readonly providers: Record<StockMarket, CompanyReportProvider>

  constructor(userDataDirectory: string, secClient = new SecEdgarClient()) {
    this.cacheDirectory = join(userDataDirectory, 'company-reports')
    this.providers = {
      CN: new CninfoCompanyReportProvider(),
      HK: new HkexCompanyReportProvider(),
      US: new SecCompanyReportProvider(secClient)
    }
  }

  async get(quoteId: string, forceRefresh = false): Promise<CompanyReportLibraryResult> {
    const market = marketFromQuoteId(quoteId)
    const cached = this.readCache(quoteId, market)
    if (!forceRefresh && cached && this.isFresh(cached.fetchedAt)) {
      return this.attachSummaries({ ...this.limitToRecentYears(cached), fromCache: true })
    }

    try {
      const result = this.limitToRecentYears(await this.providers[market].fetch(quoteId))
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
    this.validateReportUrl(report.url)
    const response = await net.fetch(report.url, {
      headers: {
        Referer: this.refererForReport(report),
        'User-Agent': 'JianZhang Desktop stock research app'
      },
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) throw new Error(`财报原文下载失败：HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const text =
      report.format === 'html'
        ? this.extractHtmlText(buffer.toString('utf8'))
        : (await pdfParse(buffer)).text
    const excerpt = createCompanyReportSummaryExcerpt(text)
    if (!excerpt) throw new Error('财报原文没有提取到可总结的文字')

    const result = await runStructuredTask(
      {
        systemPrompt: SUMMARY_PROMPT,
        userContent: JSON.stringify({
          market: report.market,
          code: report.code,
          title: report.title,
          formType: report.formType,
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
      quoteId: report.quoteId,
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
    return Object.values(this.readSummaries())
      .filter((summary) => summary.code === code)
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

  private isFresh(fetchedAt: string): boolean {
    return Date.now() - new Date(fetchedAt).getTime() < CACHE_MAX_AGE
  }

  private validateReportUrl(url: string): void {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !REPORT_HOSTS.has(parsed.hostname)) {
      throw new Error('只能读取受支持交易所或监管机构的官方财报原文')
    }
  }

  private refererForReport(report: CompanyReportItem): string {
    if (report.source === 'SEC EDGAR') return 'https://www.sec.gov/'
    if (report.source === 'HKEXnews') return 'https://www1.hkexnews.hk/'
    return 'https://www.cninfo.com.cn/'
  }

  private extractHtmlText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(x[\da-f]+|\d+);/gi, (_match, entity: string) =>
        String.fromCodePoint(
          Number.parseInt(
            entity.startsWith('x') ? entity.slice(1) : entity,
            entity.startsWith('x') ? 16 : 10
          )
        )
      )
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private limitToRecentYears(result: CompanyReportLibraryResult): CompanyReportLibraryResult {
    const reports = limitCompanyReportsToRecentYears(result.reports)
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
        summary: summaries[report.id] ?? summaries[report.id.replace(/^(cninfo|sec|hkex):/, '')]
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

  private cachePath(quoteId: string, market: StockMarket): string {
    return join(
      this.cacheDirectory,
      market.toLowerCase(),
      `${quoteId.replace(/[^\w.-]/g, '_')}.json`
    )
  }

  private readCache(quoteId: string, market: StockMarket): CompanyReportLibraryResult | null {
    const path = this.cachePath(quoteId, market)
    const legacyPath =
      market === 'CN'
        ? join(
            this.cacheDirectory,
            `${quoteId.includes('.') ? quoteId.split('.')[1] : quoteId}.json`
          )
        : ''
    const readablePath = existsSync(path)
      ? path
      : legacyPath && existsSync(legacyPath)
        ? legacyPath
        : null
    return readablePath
      ? (JSON.parse(readFileSync(readablePath, 'utf8')) as CompanyReportLibraryResult)
      : null
  }

  private writeCache(result: CompanyReportLibraryResult): void {
    const quoteId = result.quoteId ?? result.code
    const market = result.market ?? marketFromQuoteId(quoteId)
    const path = this.cachePath(quoteId, market)
    mkdirSync(join(this.cacheDirectory, market.toLowerCase()), { recursive: true })
    atomicWriteJsonSync(path, result)
  }
}
