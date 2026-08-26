import type { CorporateActionListResult, StockMarket } from '../../src/shared/types'

export interface CorporateActionProvider {
  readonly market: StockMarket
  fetch(quoteId: string): Promise<CorporateActionListResult>
}

export function corporateActionCodeFromQuoteId(quoteId: string): string {
  return quoteId.includes('.') ? quoteId.split('.').slice(1).join('.') : quoteId
}

export function corporateActionPeriodRange(yearCount = 2): {
  periodStart: string
  periodEnd: string
} {
  const end = new Date()
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - yearCount)
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10)
  }
}
