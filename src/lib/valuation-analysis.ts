import type {
  FundamentalCompany,
  FundamentalOrganizationType,
  StockPriceCashFlowAnalysis,
  StockQuote,
  StockValuationAnalysis,
  StockValuationHistory
} from '../shared/types'

function quarterIndex(reportDate: string): number {
  const year = Number(reportDate.slice(0, 4))
  const month = Number(reportDate.slice(5, 7))
  return year * 4 + Math.floor((month - 1) / 3)
}

function trailingOperatingCashFlow(
  company: FundamentalCompany | null | undefined
): Pick<StockPriceCashFlowAnalysis, 'operatingCashFlowTtm' | 'reportDate'> {
  const reports = [...(company?.quarterlyRiskReports ?? [])]
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate))
    .slice(-4)
  const reportDate = reports.at(-1)?.reportDate ?? null
  const completeSequence =
    reports.length === 4 &&
    reports.every(
      (report, index) =>
        report.operatingCashFlowQuarter !== null &&
        (index === 0 ||
          quarterIndex(report.reportDate) === quarterIndex(reports[index - 1].reportDate) + 1)
    )

  return {
    operatingCashFlowTtm: completeSequence
      ? reports.reduce((total, report) => total + report.operatingCashFlowQuarter!, 0)
      : null,
    reportDate
  }
}

function currentTotalMarketValue(
  quote: StockQuote | null | undefined,
  company: FundamentalCompany | null | undefined
): number | null {
  if (
    quote?.totalMarketValue !== null &&
    quote?.totalMarketValue !== undefined &&
    quote.totalMarketValue > 0
  ) {
    return quote.totalMarketValue
  }

  const currentPrice = quote?.latest
  const snapshotMarketValue = company?.valuation?.totalMarketValue
  const snapshotClosePrice = company?.valuation?.closePrice
  if (
    currentPrice === null ||
    currentPrice === undefined ||
    currentPrice <= 0 ||
    snapshotMarketValue === null ||
    snapshotMarketValue === undefined ||
    snapshotMarketValue <= 0 ||
    snapshotClosePrice === null ||
    snapshotClosePrice === undefined ||
    snapshotClosePrice <= 0
  ) {
    return null
  }

  return (snapshotMarketValue / snapshotClosePrice) * currentPrice
}

function createPriceCashFlowAnalysis(
  quote: StockQuote | null | undefined,
  company: FundamentalCompany | null | undefined
): StockPriceCashFlowAnalysis {
  if (!usesOrdinaryCorporateInvestmentMetrics(company?.organizationType)) {
    return {
      currentValue: null,
      operatingCashFlowTtm: null,
      reportDate: company?.quarterlyRiskReports?.at(-1)?.reportDate ?? null,
      unavailableReason: 'not-applicable'
    }
  }

  const { operatingCashFlowTtm, reportDate } = trailingOperatingCashFlow(company)
  if (operatingCashFlowTtm === null) {
    return { currentValue: null, operatingCashFlowTtm, reportDate, unavailableReason: 'cash-flow' }
  }
  if (operatingCashFlowTtm <= 0) {
    return {
      currentValue: null,
      operatingCashFlowTtm,
      reportDate,
      unavailableReason: 'non-positive-cash-flow'
    }
  }

  const marketValue = currentTotalMarketValue(quote, company)
  if (marketValue === null) {
    return {
      currentValue: null,
      operatingCashFlowTtm,
      reportDate,
      unavailableReason: 'market-value'
    }
  }

  return {
    currentValue: marketValue / operatingCashFlowTtm,
    operatingCashFlowTtm,
    reportDate,
    unavailableReason: null
  }
}

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
    },
    priceCashFlowRatioTtm: createPriceCashFlowAnalysis(quote, company)
  }
}
