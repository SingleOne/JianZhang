import type { FundamentalCompany } from '../shared/types'
import { usesOrdinaryCorporateInvestmentMetrics } from './valuation-analysis'

export const DCF_FORECAST_YEARS = 5
export const DCF_DISCOUNT_RATE = 10
export const DCF_TERMINAL_GROWTH_RATE = 3
export const DCF_MIN_FORECAST_GROWTH_RATE = -10
export const DCF_MAX_FORECAST_GROWTH_RATE = 15
export const DCF_LOW_VALUE_THRESHOLD_PERCENT = 70

export type DcfUnavailableReason = 'not-applicable' | 'free-cash-flow' | 'net-debt' | 'share-count'

export interface DcfAnalysis {
  normalizedFreeCashFlow: number
  historicalGrowthRate: number | null
  forecastGrowthRate: number
  enterpriseValue: number
  equityValue: number
  sharesOutstanding: number
  fairValuePerShare: number
  currentPrice: number | null
  differencePercent: number | null
  fairValueToPricePercent: number | null
  priceToFairValuePercent: number | null
  currentPriceDifferencePercent: number | null
  belowLowValueThreshold: boolean
}

export type DcfAnalysisResult =
  | { analysis: DcfAnalysis; unavailableReason: null }
  | { analysis: null; unavailableReason: DcfUnavailableReason }

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function createDcfAnalysis(
  company: FundamentalCompany,
  currentPrice: number | null | undefined
): DcfAnalysisResult {
  if (!usesOrdinaryCorporateInvestmentMetrics(company.organizationType)) {
    return { analysis: null, unavailableReason: 'not-applicable' }
  }

  const freeCashFlows = company.annualReports.map((report) => report.freeCashFlow)
  const recentFreeCashFlows = freeCashFlows.slice(-3)
  if (
    recentFreeCashFlows.length < 3 ||
    recentFreeCashFlows.some((value) => value === null || value === undefined)
  ) {
    return { analysis: null, unavailableReason: 'free-cash-flow' }
  }

  const normalizedFreeCashFlow = average(recentFreeCashFlows as number[])
  if (normalizedFreeCashFlow <= 0) {
    return { analysis: null, unavailableReason: 'free-cash-flow' }
  }

  const firstFreeCashFlow = freeCashFlows[0]
  const latestFreeCashFlow = freeCashFlows.at(-1)!
  const historicalGrowthRate =
    freeCashFlows.length >= 2 &&
    firstFreeCashFlow !== null &&
    firstFreeCashFlow !== undefined &&
    firstFreeCashFlow > 0 &&
    latestFreeCashFlow !== null &&
    latestFreeCashFlow !== undefined &&
    latestFreeCashFlow > 0
      ? (Math.pow(latestFreeCashFlow / firstFreeCashFlow, 1 / (freeCashFlows.length - 1)) - 1) * 100
      : null
  const forecastGrowthRate = clamp(
    historicalGrowthRate ?? 0,
    DCF_MIN_FORECAST_GROWTH_RATE,
    DCF_MAX_FORECAST_GROWTH_RATE
  )

  const netDebt = company.latestBalanceSheet.netDebt
  if (netDebt === null || netDebt === undefined) {
    return { analysis: null, unavailableReason: 'net-debt' }
  }

  const valuation = company.valuation
  const totalMarketValue = valuation?.totalMarketValue
  const closePrice = valuation?.closePrice
  if (
    totalMarketValue === null ||
    totalMarketValue === undefined ||
    totalMarketValue <= 0 ||
    closePrice === null ||
    closePrice === undefined ||
    closePrice <= 0
  ) {
    return { analysis: null, unavailableReason: 'share-count' }
  }

  const discountRate = DCF_DISCOUNT_RATE / 100
  const terminalGrowthRate = DCF_TERMINAL_GROWTH_RATE / 100
  const growthRate = forecastGrowthRate / 100
  let discountedForecastCashFlow = 0
  let finalForecastCashFlow = normalizedFreeCashFlow
  for (let year = 1; year <= DCF_FORECAST_YEARS; year += 1) {
    finalForecastCashFlow *= 1 + growthRate
    discountedForecastCashFlow += finalForecastCashFlow / Math.pow(1 + discountRate, year)
  }
  const terminalValue =
    (finalForecastCashFlow * (1 + terminalGrowthRate)) / (discountRate - terminalGrowthRate)
  const enterpriseValue =
    discountedForecastCashFlow + terminalValue / Math.pow(1 + discountRate, DCF_FORECAST_YEARS)
  const equityValue = enterpriseValue - netDebt
  const sharesOutstanding = totalMarketValue / closePrice
  const fairValuePerShare = equityValue / sharesOutstanding
  const comparableCurrentPrice =
    currentPrice !== null && currentPrice !== undefined && currentPrice > 0 ? currentPrice : null
  const fairValueToPricePercent =
    comparableCurrentPrice === null ? null : (fairValuePerShare / comparableCurrentPrice) * 100
  const differencePercent = fairValueToPricePercent === null ? null : fairValueToPricePercent - 100
  const priceToFairValuePercent =
    comparableCurrentPrice === null || fairValuePerShare <= 0
      ? null
      : (comparableCurrentPrice / fairValuePerShare) * 100
  const currentPriceDifferencePercent =
    priceToFairValuePercent === null ? null : priceToFairValuePercent - 100

  return {
    analysis: {
      normalizedFreeCashFlow,
      historicalGrowthRate,
      forecastGrowthRate,
      enterpriseValue,
      equityValue,
      sharesOutstanding,
      fairValuePerShare,
      currentPrice: comparableCurrentPrice,
      differencePercent,
      fairValueToPricePercent,
      priceToFairValuePercent,
      currentPriceDifferencePercent,
      belowLowValueThreshold:
        fairValueToPricePercent !== null &&
        fairValueToPricePercent < DCF_LOW_VALUE_THRESHOLD_PERCENT
    },
    unavailableReason: null
  }
}
