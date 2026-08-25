import { net } from 'electron'
import {
  companyReportYear,
  normalizeCompanyReportTitle,
  sortCompanyReports
} from '../../src/lib/company-reports'
import type {
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportType
} from '../../src/shared/types'
import {
  type CompanyReportProvider,
  reportCodeFromQuoteId,
  reportPeriodRange
} from './company-report-provider'

const HKEX_BASE_URL = 'https://www1.hkexnews.hk'
const HKEX_SEARCH_URL = `${HKEX_BASE_URL}/search/titleSearchServlet.do`
const HKEX_PREFIX_URL = `${HKEX_BASE_URL}/search/prefix.do`
const HKEX_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${HKEX_BASE_URL}/search/titlesearch.xhtml?lang=en`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

interface HkexStockInfo {
  stockId?: number
  code?: string
  name?: string
}

interface HkexSearchItem {
  NEWS_ID?: string
  TITLE?: string
  DATE_TIME?: string
  FILE_LINK?: string
  FILE_TYPE?: string
  LONG_TEXT?: string
}

interface HkexSearchResponse {
  result?: string
}

const RESULT_CATEGORY_CODES = ['13300', '13400', '13600', '13700', '13800']

function compactDate(date: string): string {
  return date.replaceAll('-', '')
}

function publishedAt(value: string): string {
  const matched = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/)
  if (!matched) return new Date(value).toISOString()
  return `${matched[3]}-${matched[2]}-${matched[1]}T${matched[4] ?? '00'}:${matched[5] ?? '00'}:00+08:00`
}

function reportTypeForTitle(title: string): CompanyReportType | null {
  if (/annual report|annual results|final results|year ended/i.test(title)) return 'annual'
  if (/interim|half[- ]year|six months/i.test(title)) return 'semiannual'
  if (/quarter|three months|nine months/i.test(title)) return 'quarterly'
  return null
}

export class HkexCompanyReportProvider implements CompanyReportProvider {
  readonly market = 'HK' as const

  async fetch(quoteId: string): Promise<CompanyReportLibraryResult> {
    const code = reportCodeFromQuoteId(quoteId).padStart(5, '0')
    if (!/^\d{5}$/.test(code)) throw new Error('港股代码无效')
    const stock = await this.resolveStock(code)
    const { periodStart, periodEnd } = reportPeriodRange()
    const queryGroups = await Promise.all([
      this.search(stock.stockId!, periodStart, periodEnd, '40000'),
      ...RESULT_CATEGORY_CODES.map((code) =>
        this.search(stock.stockId!, periodStart, periodEnd, '10000', code)
      )
    ])
    const unique = new Map<string, CompanyReportItem>()
    for (const item of queryGroups.flat()) {
      const report = this.mapReport(quoteId, code, item)
      if (report) unique.set(report.id, report)
    }
    return {
      quoteId,
      market: 'HK',
      code,
      source: 'HKEXnews',
      periodStart,
      periodEnd,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      reports: sortCompanyReports([...unique.values()])
    }
  }

  private async resolveStock(code: string): Promise<HkexStockInfo> {
    const url = new URL(HKEX_PREFIX_URL)
    url.search = new URLSearchParams({
      callback: 'callback',
      lang: 'EN',
      type: 'A',
      name: code,
      market: 'SEHK'
    }).toString()
    const response = await net.fetch(url.toString(), {
      headers: HKEX_HEADERS,
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`请求 HKEXnews 失败：HTTP ${response.status}`)
    const payload = (await response.text()).replace(/^callback\(/, '').replace(/\);?$/, '')
    const stocks = (JSON.parse(payload) as { stockInfo?: HkexStockInfo[] }).stockInfo ?? []
    const stock = stocks.find((item) => item.code === code && Number.isFinite(item.stockId))
    if (!stock) throw new Error(`HKEXnews 未找到港股代码 ${code}`)
    return stock
  }

  private async search(
    stockId: number,
    periodStart: string,
    periodEnd: string,
    tierOneCode: string,
    tierTwoCode = '-2'
  ): Promise<HkexSearchItem[]> {
    const url = new URL(HKEX_SEARCH_URL)
    url.search = new URLSearchParams({
      sortDir: '0',
      sortByOptions: 'DateTime',
      category: '0',
      market: 'SEHK',
      stockId: String(stockId),
      documentType: '-1',
      fromDate: compactDate(periodStart),
      toDate: compactDate(periodEnd),
      title: '',
      searchType: '1',
      t1code: tierOneCode,
      t2Gcode: '-2',
      t2code: tierTwoCode,
      rowRange: '100',
      lang: 'EN'
    }).toString()
    const response = await net.fetch(url.toString(), {
      headers: HKEX_HEADERS,
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`请求 HKEXnews 失败：HTTP ${response.status}`)
    const payload = (await response.json()) as HkexSearchResponse
    return payload.result ? (JSON.parse(payload.result) as HkexSearchItem[]) : []
  }

  private mapReport(quoteId: string, code: string, item: HkexSearchItem): CompanyReportItem | null {
    if (!item.NEWS_ID || !item.TITLE || !item.DATE_TIME || !item.FILE_LINK) return null
    const title = normalizeCompanyReportTitle(item.TITLE)
    if (/environmental|social and governance|esg report/i.test(title)) return null
    const reportType = reportTypeForTitle(`${title} ${item.LONG_TEXT ?? ''}`)
    if (!reportType) return null
    const publication = publishedAt(item.DATE_TIME)
    return {
      id: `hkex:${item.NEWS_ID}`,
      quoteId,
      market: 'HK',
      source: 'HKEXnews',
      code,
      title,
      reportType,
      reportYear: companyReportYear(title, reportType, publication),
      variant: 'full',
      amended: /revised|revision|amended|supplemental/i.test(title),
      publishedAt: publication,
      url: new URL(item.FILE_LINK, HKEX_BASE_URL).toString(),
      format: item.FILE_TYPE?.toUpperCase() === 'PDF' ? 'pdf' : 'html',
      formType: normalizeCompanyReportTitle(item.LONG_TEXT ?? '') || 'HKEX disclosure'
    }
  }
}
