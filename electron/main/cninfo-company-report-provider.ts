import {
  CninfoClient,
  cninfoMarketParams,
  isCninfoForbidden,
  type CninfoAnnouncement,
  type CninfoAnnouncementResponse,
  type CninfoOrganization
} from './cninfo-client'
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
import {
  type CompanyReportProvider,
  reportCodeFromQuoteId,
  reportPeriodRange
} from './company-report-provider'

const PDF_BASE_URL = 'https://static.cninfo.com.cn/'
const PAGE_SIZE = 30
const REPORT_CATEGORIES: Record<
  Extract<CompanyReportType, 'annual' | 'semiannual' | 'firstQuarter' | 'thirdQuarter'>,
  string
> = {
  annual: 'category_ndbg_szsh;',
  semiannual: 'category_bndbg_szsh;',
  firstQuarter: 'category_yjdbg_szsh;',
  thirdQuarter: 'category_sjdbg_szsh;'
}
function searchReportType(title: string): keyof typeof REPORT_CATEGORIES | null {
  // Search also returns notices about reports. Require a report title through its end.
  const normalized = title.replace(/\s+/g, '')
  const suffix = '(?:全文|正文|摘要|英文版)?(?:[（(][^（）()]*[）)])*'
  const periods: Array<[keyof typeof REPORT_CATEGORIES, string]> = [
    ['semiannual', '(?:半年度|中期)'],
    ['firstQuarter', '第?[一1]季(?:度)?'],
    ['thirdQuarter', '第?[三3]季(?:度)?'],
    ['annual', '年度?']
  ]
  for (const [type, period] of periods) {
    if (new RegExp(`(?:19|20)\\d{2}年?${period}(?:财务)?报告${suffix}$`).test(normalized)) {
      return type
    }
  }
  return null
}

export class CninfoCompanyReportProvider implements CompanyReportProvider {
  readonly market = 'CN' as const
  constructor(private readonly client = new CninfoClient()) {}

  async fetch(quoteId: string): Promise<CompanyReportLibraryResult> {
    const code = reportCodeFromQuoteId(quoteId)
    if (!/^\d{6}$/.test(code)) throw new Error('财报库仅支持六位 A 股代码')
    const organization = await this.client.getOrganization(code)
    if (!organization) throw new Error(`巨潮资讯未找到股票 ${code}`)
    const { periodStart, periodEnd } = reportPeriodRange()
    const reportTypes = Object.keys(REPORT_CATEGORIES) as Array<keyof typeof REPORT_CATEGORIES>
    let reports: CompanyReportItem[]
    try {
      const reportsByType = await Promise.all(
        reportTypes.map((reportType) =>
          this.fetchReportType(
            quoteId,
            code,
            organization.orgId,
            reportType,
            periodStart,
            periodEnd
          )
        )
      )
      reports = reportsByType.flat()
    } catch (error) {
      if (!isCninfoForbidden(error)) throw error
      // The historical-query CDN can deny requests while the website's public search works.
      reports = await this.fetchSearchReports(quoteId, code, organization, periodStart, periodEnd)
    }
    const unique = new Map(reports.map((report) => [report.id, report]))
    return {
      quoteId,
      market: 'CN',
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
    quoteId: string,
    code: string,
    orgId: string,
    reportType: keyof typeof REPORT_CATEGORIES,
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
      (payload.announcements ?? []).flatMap((item) =>
        this.createReport(quoteId, code, reportType, item)
      )
    )
  }

  private createReport(
    quoteId: string,
    code: string,
    reportType: keyof typeof REPORT_CATEGORIES,
    item: CninfoAnnouncement
  ): CompanyReportItem[] {
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
        id: `cninfo:${item.announcementId}`,
        quoteId,
        market: 'CN',
        source: '巨潮资讯',
        code,
        title,
        reportType,
        reportYear: companyReportYear(title, reportType, publishedAt),
        variant: companyReportVariant(title),
        amended: isAmendedCompanyReport(title),
        publishedAt,
        url: new URL(item.adjunctUrl, PDF_BASE_URL).toString(),
        format: 'pdf'
      }
    ]
  }

  private async fetchSearchReports(
    quoteId: string,
    code: string,
    organization: CninfoOrganization,
    periodStart: string,
    periodEnd: string
  ): Promise<CompanyReportItem[]> {
    const announcements = await this.client.searchAnnouncements(
      code,
      organization,
      periodStart,
      periodEnd,
      Infinity,
      '报告'
    )
    return announcements.flatMap((item) => {
      const reportType = searchReportType(normalizeCompanyReportTitle(item.announcementTitle ?? ''))
      return reportType ? this.createReport(quoteId, code, reportType, item) : []
    })
  }

  private async fetchReportPage(
    code: string,
    orgId: string,
    reportType: keyof typeof REPORT_CATEGORIES,
    periodStart: string,
    periodEnd: string,
    pageNumber: number
  ): Promise<CninfoAnnouncementResponse> {
    const { column, plate } = cninfoMarketParams(code, orgId)
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
    return this.client.queryAnnouncements(body)
  }
}
