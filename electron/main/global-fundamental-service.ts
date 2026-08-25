import { net } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pdfParse from 'pdf-parse'
import {
  buildStructuredFinancialPeriods,
  extractHkexFinancialMetrics,
  type FilingSource
} from '../../src/lib/global-fundamentals'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import type {
  CompanyReportItem,
  GlobalFinancialPeriod,
  GlobalFundamentalSnapshot
} from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import type { CompanyReportService } from './company-report-service'
import { reportCodeFromQuoteId } from './company-report-provider'
import { SecEdgarClient, type SecSubmissionsRecent } from './sec-edgar-client'

const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const MONTH_NUMBERS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12'
}

export class GlobalFundamentalService {
  private readonly cacheDirectory: string

  constructor(
    userDataDirectory: string,
    private readonly companyReports: CompanyReportService,
    private readonly secClient: SecEdgarClient
  ) {
    this.cacheDirectory = join(userDataDirectory, 'global-fundamentals')
  }

  async get(quoteId: string, forceRefresh = false): Promise<GlobalFundamentalSnapshot> {
    const market = marketFromQuoteId(quoteId)
    if (market === 'CN') throw new Error('A 股基本面使用本地全市场基本面快照')
    const cached = this.readCache(quoteId)
    if (!forceRefresh && cached && this.isFresh(cached.fetchedAt)) {
      return { ...cached, fromCache: true }
    }
    try {
      const snapshot =
        market === 'US'
          ? await this.fetchSecSnapshot(quoteId)
          : await this.fetchHkexSnapshot(quoteId, forceRefresh)
      this.writeCache(snapshot)
      return snapshot
    } catch (reason) {
      if (!cached) throw reason
      return {
        ...cached,
        fromCache: true,
        warning: `在线更新失败，当前显示本地缓存：${reason instanceof Error ? reason.message : '未知错误'}`
      }
    }
  }

  private async fetchSecSnapshot(quoteId: string): Promise<GlobalFundamentalSnapshot> {
    const code = reportCodeFromQuoteId(quoteId).toUpperCase()
    const issuer = await this.secClient.resolveIssuer(code)
    const [submissions, companyFacts] = await Promise.all([
      this.secClient.getSubmissions(issuer.cik),
      this.secClient.getCompanyFacts(issuer.cik)
    ])
    const filingSources = this.secFilingSources(issuer.cik, submissions.filings?.recent ?? {})
    const periods = buildStructuredFinancialPeriods(companyFacts, filingSources)
    const reportingCurrency =
      periods.flatMap((period) => period.metrics).find((metric) => metric.currency)?.currency ??
      null
    const taxonomies = Object.keys(companyFacts.facts ?? {})
    return {
      schemaVersion: 1,
      quoteId,
      market: 'US',
      code,
      name: submissions.name ?? issuer.name,
      officialIssuerId: String(issuer.cik).padStart(10, '0'),
      accountingStandard: taxonomies.includes('us-gaap')
        ? 'US GAAP'
        : taxonomies.includes('ifrs-full')
          ? 'IFRS'
          : '未识别',
      reportingCurrency,
      fiscalYearEnd: submissions.fiscalYearEnd,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      warning:
        periods.length === 0 ? 'SEC Company Facts 暂无可稳定映射的结构化财务期间。' : undefined,
      source: {
        name: 'SEC Company Facts',
        url: this.secClient.issuerPageUrl(issuer.cik)
      },
      periods
    }
  }

  private secFilingSources(cik: number, recent: SecSubmissionsRecent): FilingSource[] {
    return (recent.accessionNumber ?? []).flatMap((accessionNumber, index): FilingSource[] => {
      const document = recent.primaryDocument?.[index]
      return document
        ? [{ accessionNumber, url: this.secClient.filingUrl(cik, accessionNumber, document) }]
        : []
    })
  }

  private async fetchHkexSnapshot(
    quoteId: string,
    forceRefresh: boolean
  ): Promise<GlobalFundamentalSnapshot> {
    const code = reportCodeFromQuoteId(quoteId).padStart(5, '0')
    const library = await this.companyReports.get(quoteId, forceRefresh)
    const selectedReports = this.selectHkexReports(library.reports)
    const extracted = await Promise.all(
      selectedReports.map((report) => this.extractHkexPeriod(report))
    )
    const periods = extracted.flatMap((item) => (item?.period ? [item.period] : []))
    const reportingCurrency =
      periods.flatMap((period) => period.metrics).find((metric) => metric.currency)?.currency ??
      null
    const accountingStandard = extracted.some((item) => item?.standard === 'HKFRS')
      ? 'HKFRS'
      : extracted.some((item) => item?.standard === 'IFRS')
        ? 'IFRS'
        : '未识别'
    return {
      schemaVersion: 1,
      quoteId,
      market: 'HK',
      code,
      name: code,
      officialIssuerId: code,
      accountingStandard,
      reportingCurrency,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      warning:
        periods.length === 0
          ? '官方报告已找到，但未同时确认币种、数量级、期间和指标标签，因此未展示推测数值。'
          : undefined,
      source: {
        name: 'HKEXnews',
        url: `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en&market=SEHK`
      },
      periods: periods.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))
    }
  }

  private selectHkexReports(reports: CompanyReportItem[]): CompanyReportItem[] {
    const ranked = [...reports].sort((left, right) => {
      const leftReport = /\breport\b/i.test(left.title) ? 1 : 0
      const rightReport = /\breport\b/i.test(right.title) ? 1 : 0
      return (
        right.reportYear - left.reportYear ||
        rightReport - leftReport ||
        right.publishedAt.localeCompare(left.publishedAt)
      )
    })
    const selected = new Map<string, CompanyReportItem>()
    for (const report of ranked) {
      const type =
        report.reportType === 'annual'
          ? 'annual'
          : report.reportType === 'semiannual'
            ? 'semiannual'
            : null
      if (!type) continue
      const key = `${type}:${report.reportYear}`
      if (!selected.has(key)) selected.set(key, report)
      if (selected.size >= 3) break
    }
    return [...selected.values()]
  }

  private async extractHkexPeriod(report: CompanyReportItem): Promise<{
    period: GlobalFinancialPeriod | null
    standard: 'HKFRS' | 'IFRS' | '未识别'
  }> {
    const response = await net.fetch(report.url, {
      headers: {
        Referer: 'https://www1.hkexnews.hk/',
        'User-Agent': 'JianZhang Desktop stock research app'
      },
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) throw new Error(`HKEXnews 财报下载失败：HTTP ${response.status}`)
    const text = (await pdfParse(Buffer.from(await response.arrayBuffer()))).text
    const extracted = extractHkexFinancialMetrics(text)
    const periodEnd = this.reportingPeriodEnd(`${report.title}\n${text.slice(0, 30_000)}`)
    const standard = /Hong Kong Financial Reporting Standards|HKFRS/i.test(text)
      ? 'HKFRS'
      : /International Financial Reporting Standards|\bIFRS\b/i.test(text)
        ? 'IFRS'
        : '未识别'
    if (!extracted || !periodEnd) return { period: null, standard }
    return {
      standard,
      period: {
        id: `hkex:${report.id}:${periodEnd}`,
        periodType: report.reportType === 'annual' ? 'annual' : 'interim',
        fiscalYear: report.reportYear,
        fiscalPeriod: report.reportType === 'annual' ? 'FY' : 'Half-year',
        periodEnd,
        filedAt: report.publishedAt,
        formType: report.formType ?? report.title,
        sourceUrl: report.url,
        metrics: extracted.metrics
      }
    }
  }

  private reportingPeriodEnd(text: string): string | null {
    const matched = text.match(
      /(?:year|period|months)\s+ended\s+(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})/i
    )
    if (!matched) return null
    const month = MONTH_NUMBERS[matched[2].toLowerCase()]
    return month ? `${matched[3]}-${month}-${matched[1].padStart(2, '0')}` : null
  }

  private isFresh(fetchedAt: string): boolean {
    return Date.now() - new Date(fetchedAt).getTime() < CACHE_MAX_AGE
  }

  private cachePath(quoteId: string): string {
    return join(this.cacheDirectory, `${quoteId.replace(/[^\w.-]/g, '_')}.json`)
  }

  private readCache(quoteId: string): GlobalFundamentalSnapshot | null {
    const path = this.cachePath(quoteId)
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as GlobalFundamentalSnapshot)
      : null
  }

  private writeCache(snapshot: GlobalFundamentalSnapshot): void {
    mkdirSync(this.cacheDirectory, { recursive: true })
    atomicWriteJsonSync(this.cachePath(snapshot.quoteId), snapshot)
  }
}
