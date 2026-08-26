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
import {
  HkexNewsClient,
  hkexDocumentUrl,
  hkexPublishedAt,
  type HkexSearchItem
} from './hkex-news-client'

const RESULT_CATEGORY_CODES = ['13300', '13400', '13600', '13700', '13800']

function reportTypeForTitle(title: string): CompanyReportType | null {
  if (/annual report|annual results|final results|year ended/i.test(title)) return 'annual'
  if (/interim|half[- ]year|six months/i.test(title)) return 'semiannual'
  if (/quarter|three months|nine months/i.test(title)) return 'quarterly'
  return null
}

export class HkexCompanyReportProvider implements CompanyReportProvider {
  readonly market = 'HK' as const

  constructor(private readonly client = new HkexNewsClient()) {}

  async fetch(quoteId: string): Promise<CompanyReportLibraryResult> {
    const code = reportCodeFromQuoteId(quoteId).padStart(5, '0')
    if (!/^\d{5}$/.test(code)) throw new Error('港股代码无效')
    const stock = await this.client.resolveStock(code)
    const { periodStart, periodEnd } = reportPeriodRange()
    const queryGroups = await Promise.all([
      this.client.search(stock.stockId!, periodStart, periodEnd, '40000'),
      ...RESULT_CATEGORY_CODES.map((code) =>
        this.client.search(stock.stockId!, periodStart, periodEnd, '10000', code)
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

  private mapReport(quoteId: string, code: string, item: HkexSearchItem): CompanyReportItem | null {
    if (!item.NEWS_ID || !item.TITLE || !item.DATE_TIME || !item.FILE_LINK) return null
    const title = normalizeCompanyReportTitle(item.TITLE)
    if (/environmental|social and governance|esg report/i.test(title)) return null
    const reportType = reportTypeForTitle(`${title} ${item.LONG_TEXT ?? ''}`)
    if (!reportType) return null
    const publication = hkexPublishedAt(item.DATE_TIME)
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
      url: hkexDocumentUrl(item.FILE_LINK),
      format: item.FILE_TYPE?.toUpperCase() === 'PDF' ? 'pdf' : 'html',
      formType: normalizeCompanyReportTitle(item.LONG_TEXT ?? '') || 'HKEX disclosure'
    }
  }
}
