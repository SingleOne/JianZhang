import { net, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  companyReportVariant,
  companyReportYear,
  isAmendedCompanyReport,
  normalizeCompanyReportTitle,
  sortCompanyReports
} from '../../src/lib/company-reports'
import type {
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportType
} from '../../src/shared/types'

const STOCK_LIST_URL = 'https://www.cninfo.com.cn/new/data/szse_stock.json'
const ANNOUNCEMENT_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
const PDF_BASE_URL = 'https://static.cninfo.com.cn/'
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const PAGE_SIZE = 30
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
      return { ...cached, fromCache: true }
    }

    try {
      const result = await this.fetch(code)
      this.writeCache(result)
      return result
    } catch (reason) {
      if (!cached) throw reason
      return {
        ...cached,
        fromCache: true,
        warning: `在线更新失败，当前显示本地缓存：${reason instanceof Error ? reason.message : '未知错误'}`
      }
    }
  }

  async open(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.cninfo.com.cn') {
      throw new Error('只能打开巨潮资讯的财报原文')
    }
    await shell.openExternal(url)
  }

  private async fetch(code: string): Promise<CompanyReportLibraryResult> {
    const organizations = await this.getStockOrganizations()
    const orgId = organizations.get(code)
    if (!orgId) throw new Error(`巨潮资讯未找到股票 ${code}`)

    const now = new Date()
    const periodStart = `${now.getFullYear() - 9}-01-01`
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
            reportYear: companyReportYear(title, publishedAt),
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
    writeFileSync(this.cachePath(result.code), JSON.stringify(result, null, 2), 'utf8')
  }
}
