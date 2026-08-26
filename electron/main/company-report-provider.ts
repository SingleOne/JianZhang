import type { CompanyReportLibraryResult, StockMarket } from '../../src/shared/types'

export interface CompanyReportProvider {
  readonly market: StockMarket
  fetch(quoteId: string): Promise<CompanyReportLibraryResult>
}

export function reportCodeFromQuoteId(quoteId: string): string {
  return quoteId.includes('.') ? (quoteId.split('.')[1] ?? '') : quoteId
}

export function reportPeriodRange(yearCount = 5): { periodStart: string; periodEnd: string } {
  const now = new Date()
  const periodEnd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  return { periodStart: `${now.getFullYear() - yearCount}-01-01`, periodEnd }
}
