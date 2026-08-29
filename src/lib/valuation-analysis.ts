import type {
  FundamentalCompany,
  FundamentalOrganizationType,
  StockQuote,
  StockValuationAnalysis,
  StockValuationHistory
} from '../shared/types'

export function usesOrdinaryCorporateInvestmentMetrics(
  organizationType: FundamentalOrganizationType | undefined
): boolean {
  return (
    organizationType === undefined || organizationType === 'general' || organizationType === 'other'
  )
}

export function valuationPercentile(
  values: readonly number[],
  current: number | null
): number | null {
  if (current === null || current <= 0 || values.length === 0) return null
  const lessOrEqual = values.reduce((count, value) => count + (value <= current ? 1 : 0), 0)
  return (lessOrEqual / values.length) * 100
}

export function createStockValuationAnalysis(
  quoteId: string,
  quote: StockQuote | null | undefined,
  company: FundamentalCompany | null | undefined,
  history: StockValuationHistory | null
): StockValuationAnalysis {
  const valuation = company?.valuation
  const currentPe = quote?.priceEarningsRatioTtm ?? null
  const currentPb = quote?.priceBookRatio ?? null

  return {
    quoteId,
    quoteDataAt: quote?.dataAt ?? quote?.updatedAt ?? null,
    historyFetchedAt: history?.fetchedAt ?? null,
    historyPeriodStart: history?.periodStart ?? null,
    historyPeriodEnd: history?.periodEnd ?? null,
    industryDataAt: valuation?.dataDate ?? null,
    totalMarketValue: valuation?.totalMarketValue ?? null,
    circulatingMarketValue: valuation?.circulatingMarketValue ?? null,
    priceEarningsRatioTtm: {
      currentValue: currentPe,
      historicalPercentile: valuationPercentile(
        history?.priceEarningsRatioTtmValues ?? [],
        currentPe
      ),
      historicalSampleSize: history?.priceEarningsRatioTtmValues.length ?? 0,
      industryPercentile: valuation?.priceEarningsIndustryPercentile ?? null,
      industrySampleSize: valuation?.priceEarningsIndustrySampleSize ?? 0,
      industryBasisValue: valuation?.priceEarningsRatioTtm ?? null
    },
    priceBookRatio: {
      currentValue: currentPb,
      historicalPercentile: valuationPercentile(history?.priceBookRatioValues ?? [], currentPb),
      historicalSampleSize: history?.priceBookRatioValues.length ?? 0,
      industryPercentile: valuation?.priceBookIndustryPercentile ?? null,
      industrySampleSize: valuation?.priceBookIndustrySampleSize ?? 0,
      industryBasisValue: valuation?.priceBookRatio ?? null
    }
  }
}
