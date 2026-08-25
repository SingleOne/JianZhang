import { sortCompanyReports } from '../../src/lib/company-reports'
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
import { SecEdgarClient, type SecSubmissionsRecent } from './sec-edgar-client'

const PERIODIC_FORMS = new Set([
  '10-K',
  '10-K/A',
  '10-Q',
  '10-Q/A',
  '20-F',
  '20-F/A',
  '40-F',
  '40-F/A'
])
const CURRENT_FORMS = new Set(['8-K', '8-K/A', '6-K', '6-K/A'])
const RESULTS_DESCRIPTION = /results|earnings|financial statements|interim|quarter|annual report/i

function valueAt(values: string[] | undefined, index: number): string {
  return values?.[index] ?? ''
}

function reportTypeForForm(form: string): CompanyReportType {
  if (/^(10-K|20-F|40-F)/.test(form)) return 'annual'
  if (/^10-Q/.test(form)) return 'quarterly'
  return 'current'
}

export class SecCompanyReportProvider implements CompanyReportProvider {
  readonly market = 'US' as const

  constructor(private readonly client: SecEdgarClient) {}

  async fetch(quoteId: string): Promise<CompanyReportLibraryResult> {
    const code = reportCodeFromQuoteId(quoteId).toUpperCase()
    const issuer = await this.client.resolveIssuer(code)
    const submissions = await this.client.getSubmissions(issuer.cik)
    const recent = submissions.filings?.recent ?? {}
    const { periodStart, periodEnd } = reportPeriodRange()
    const reports = this.mapReports(quoteId, code, issuer.cik, recent).filter(
      (report) => report.publishedAt.slice(0, 10) >= periodStart
    )
    return {
      quoteId,
      market: 'US',
      code,
      source: 'SEC EDGAR',
      periodStart,
      periodEnd,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      reports: sortCompanyReports(reports)
    }
  }

  private mapReports(
    quoteId: string,
    code: string,
    cik: number,
    recent: SecSubmissionsRecent
  ): CompanyReportItem[] {
    return (recent.accessionNumber ?? []).flatMap((accessionNumber, index) => {
      const formType = valueAt(recent.form, index)
      const description = valueAt(recent.primaryDocDescription, index)
      const primaryDocument = valueAt(recent.primaryDocument, index)
      const filingDate = valueAt(recent.filingDate, index)
      const periodEnd = valueAt(recent.reportDate, index)
      const isPeriodic = PERIODIC_FORMS.has(formType)
      const isResultsCurrent =
        /^6-K/.test(formType) ||
        (CURRENT_FORMS.has(formType) && RESULTS_DESCRIPTION.test(description))
      if ((!isPeriodic && !isResultsCurrent) || !primaryDocument || !filingDate) return []
      const reportType = reportTypeForForm(formType)
      const reportYear = Number((periodEnd || filingDate).slice(0, 4))
      const title = description || `${formType} · ${periodEnd || filingDate}`
      return [
        {
          id: `sec:${accessionNumber}`,
          quoteId,
          market: 'US',
          source: 'SEC EDGAR',
          code,
          title,
          reportType,
          reportYear,
          variant: 'full',
          amended: formType.endsWith('/A'),
          publishedAt: `${filingDate}T00:00:00.000Z`,
          url: this.client.filingUrl(cik, accessionNumber, primaryDocument),
          format: primaryDocument.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html',
          formType,
          fiscalPeriod:
            reportType === 'annual' ? 'FY' : reportType === 'quarterly' ? 'Quarter' : 'Current',
          periodEnd: periodEnd || undefined
        }
      ]
    })
  }
}
