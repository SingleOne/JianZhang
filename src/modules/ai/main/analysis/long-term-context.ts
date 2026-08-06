import { createHash } from 'node:crypto'
import {
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  FUNDAMENTAL_QUALITY_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_LABELS,
  classifyFundamentalDividendCategory,
  createFundamentalPeerComparisonMap,
  evaluateFundamentalCompany,
  evaluateFundamentalQuality,
  evaluateFundamentalRisk,
  screenFundamentalCompanies,
  summarizeFundamentalScreening
} from '../../../../lib/fundamental-screening'
import type {
  DataSnapshotRuntimeState,
  DividendFinancingSnapshot,
  FundamentalSnapshot,
  KlineResult,
  StockQuote,
  StockValuationHistory
} from '../../../../shared/types'
import {
  DCF_DISCOUNT_RATE,
  DCF_FORECAST_YEARS,
  DCF_LOW_VALUE_THRESHOLD_PERCENT,
  DCF_MAX_FORECAST_GROWTH_RATE,
  DCF_MIN_FORECAST_GROWTH_RATE,
  DCF_TERMINAL_GROWTH_RATE,
  createDcfAnalysis
} from '../../../../lib/dcf-analysis'
import {
  createStockValuationAnalysis,
  usesOrdinaryCorporateInvestmentMetrics
} from '../../../../lib/valuation-analysis'

interface LongTermContextInput {
  quoteId: string
  quote: StockQuote | null
  dailyKline: KlineResult | null
  valuationHistory: StockValuationHistory | null
  fundamentalSnapshot: FundamentalSnapshot | null
  fundamentalState: DataSnapshotRuntimeState
  dividendSnapshot: DividendFinancingSnapshot | null
  dividendState: DataSnapshotRuntimeState
  generatedAt: string
}

function percentChange(current: number | null, base: number | undefined): number | null {
  return current !== null && base !== undefined && base !== 0
    ? (current / base - 1) * 100
    : null
}

function average(values: readonly number[]): number | null {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
}

function distancePercent(current: number | null, reference: number | null): number | null {
  return current !== null && reference !== null && reference !== 0
    ? (current / reference - 1) * 100
    : null
}

export function calculateLongTermPriceStrength(
  quote: StockQuote | null,
  dailyKline: KlineResult | null
) {
  const bars = dailyKline?.bars ?? []
  const closes = bars.map((bar) => bar.close)
  const currentPrice = quote?.latest ?? closes.at(-1) ?? null
  const movingAverage = (sessions: number) => average(closes.slice(-sessions))
  const rangeBars = bars.slice(-250)
  const rangeHigh = rangeBars.length > 0
    ? Math.max(...rangeBars.map((bar) => bar.high), currentPrice ?? Number.NEGATIVE_INFINITY)
    : null
  const rangeLow = rangeBars.length > 0
    ? Math.min(...rangeBars.map((bar) => bar.low), currentPrice ?? Number.POSITIVE_INFINITY)
    : null
  const rangePosition = currentPrice !== null && rangeHigh !== null && rangeLow !== null && rangeHigh !== rangeLow
    ? (currentPrice - rangeLow) / (rangeHigh - rangeLow) * 100
    : null

  return {
    dataAt: quote?.updatedAt ?? bars.at(-1)?.time ?? null,
    latestTradingDate: bars.at(-1)?.time ?? null,
    currentPrice,
    currentDayChangePercent: quote?.changePercent ?? null,
    return20: percentChange(currentPrice, closes.at(-21)),
    return60: percentChange(currentPrice, closes.at(-61)),
    return120: percentChange(currentPrice, closes.at(-121)),
    return250: percentChange(currentPrice, closes.at(-251)),
    distanceFromMa20: distancePercent(currentPrice, movingAverage(20)),
    distanceFromMa60: distancePercent(currentPrice, movingAverage(60)),
    distanceFromMa120: distancePercent(currentPrice, movingAverage(120)),
    distanceFromMa250: distancePercent(currentPrice, movingAverage(250)),
    range250High: rangeHigh,
    range250Low: rangeLow,
    range250Position: rangePosition,
    distanceFrom250High: distancePercent(currentPrice, rangeHigh),
    distanceFrom250Low: distancePercent(currentPrice, rangeLow)
  }
}

export function buildLongTermContext(input: LongTermContextInput) {
  const fundamentalCompany = input.fundamentalSnapshot?.rows.find((row) => row.quoteId === input.quoteId)
  const industryBenchmark = fundamentalCompany
    ? input.fundamentalSnapshot?.industries.find((industry) => industry.code === fundamentalCompany.industryCode) ?? null
    : null
  const evaluation = fundamentalCompany
    ? evaluateFundamentalCompany(
        fundamentalCompany,
        industryBenchmark,
        DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
      )
    : null
  const screening = evaluation ? summarizeFundamentalScreening(evaluation) : null
  const quality = fundamentalCompany ? evaluateFundamentalQuality(fundamentalCompany) : null
  const risk = fundamentalCompany ? evaluateFundamentalRisk(fundamentalCompany) : null
  const peerComparison = fundamentalCompany && input.fundamentalSnapshot
    ? createFundamentalPeerComparisonMap(screenFundamentalCompanies(
        input.fundamentalSnapshot,
        DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
      )).get(fundamentalCompany.code) ?? null
    : null
  const dividendItem = input.dividendSnapshot?.rows.find((row) => row.code === fundamentalCompany?.code || row.code === input.quote?.code)
  const valueCategory = input.fundamentalSnapshot && input.dividendSnapshot
    ? classifyFundamentalDividendCategory(evaluation ?? undefined, Boolean(dividendItem))
    : null
  const priceStrength = calculateLongTermPriceStrength(input.quote, input.dailyKline)
  const ordinaryCorporateMetricsApplicable = usesOrdinaryCorporateInvestmentMetrics(
    fundamentalCompany?.organizationType
  )
  const marketValuation = createStockValuationAnalysis(
    input.quoteId,
    input.quote,
    fundamentalCompany,
    input.valuationHistory
  )
  const dcfResult = fundamentalCompany
    ? createDcfAnalysis(fundamentalCompany, input.quote?.latest)
    : null
  const dcf = dcfResult?.analysis ? {
    available: true as const,
    unavailableReason: null,
    normalizedFreeCashFlow: dcfResult.analysis.normalizedFreeCashFlow,
    historicalGrowthRate: dcfResult.analysis.historicalGrowthRate,
    forecastGrowthRate: dcfResult.analysis.forecastGrowthRate,
    forecastYears: DCF_FORECAST_YEARS,
    discountRate: DCF_DISCOUNT_RATE,
    terminalGrowthRate: DCF_TERMINAL_GROWTH_RATE,
    forecastGrowthRateRange: {
      minimum: DCF_MIN_FORECAST_GROWTH_RATE,
      maximum: DCF_MAX_FORECAST_GROWTH_RATE
    },
    enterpriseValue: dcfResult.analysis.enterpriseValue,
    equityValue: dcfResult.analysis.equityValue,
    sharesOutstanding: dcfResult.analysis.sharesOutstanding,
    fairValuePerShare: dcfResult.analysis.fairValuePerShare,
    currentPrice: dcfResult.analysis.currentPrice,
    differencePercent: dcfResult.analysis.differencePercent,
    fairValueToPricePercent: dcfResult.analysis.fairValueToPricePercent,
    lowValueThresholdPercent: DCF_LOW_VALUE_THRESHOLD_PERCENT,
    belowLowValueThreshold: dcfResult.analysis.belowLowValueThreshold
  } : {
    available: false as const,
    unavailableReason: dcfResult?.unavailableReason ?? 'company-not-covered'
  }
  const valuation = {
    ...marketValuation,
    dcf
  }

  const fundamental = {
    available: Boolean(input.fundamentalSnapshot),
    companyCovered: Boolean(fundamentalCompany),
    snapshotDate: input.fundamentalSnapshot?.snapshotDate ?? null,
    generatedAt: input.fundamentalSnapshot?.generatedAt ?? null,
    fiscalYears: input.fundamentalSnapshot?.fiscalYears ?? [],
    staleReason: input.fundamentalState.status === 'stale'
      ? input.fundamentalState.staleReason
      : null,
    company: fundamentalCompany ? {
      code: fundamentalCompany.code,
      name: fundamentalCompany.name,
      organizationType: fundamentalCompany.organizationType,
      industryCode: fundamentalCompany.industryCode,
      industryName: fundamentalCompany.industryName,
      ordinaryCorporateMetricsApplicable,
      ordinaryCorporateMetricsReason: ordinaryCorporateMetricsApplicable
        ? null
        : '银行、保险和券商的普通企业 ROIC、自由现金流和净负债不适用，应使用金融行业专用指标。',
      annualReports: fundamentalCompany.annualReports.map((report) => ({
        year: report.year,
        reportDate: report.reportDate,
        noticeDate: report.noticeDate,
        weightedAverageRoe: report.weightedAverageRoe,
        deductedWeightedAverageRoe: report.deductedWeightedAverageRoe,
        roic: ordinaryCorporateMetricsApplicable ? report.roic ?? null : null,
        netProfit: report.netProfit,
        parentNetProfit: report.parentNetProfit,
        deductedParentNetProfit: report.deductedParentNetProfit,
        operatingCashFlow: report.operatingCashFlow,
        capitalExpenditure: report.capitalExpenditure ?? null,
        freeCashFlow: ordinaryCorporateMetricsApplicable ? report.freeCashFlow ?? null : null
      })),
      latestBalanceSheet: {
        reportDate: fundamentalCompany.latestBalanceSheet.reportDate,
        debtAssetRatio: fundamentalCompany.latestBalanceSheet.debtAssetRatio,
        industryDebtPercentile: fundamentalCompany.latestBalanceSheet.industryPercentile,
        industryDebtP60: industryBenchmark?.debtAssetRatioP60 ?? null,
        monetaryFunds: fundamentalCompany.latestBalanceSheet.monetaryFunds ?? null,
        interestBearingDebt: fundamentalCompany.latestBalanceSheet.interestBearingDebt ?? null,
        netDebt: ordinaryCorporateMetricsApplicable
          ? fundamentalCompany.latestBalanceSheet.netDebt ?? null
          : null
      },
      screening: evaluation && screening ? {
        status: screening.status,
        ruleStatuses: screening.ruleStatuses,
        minimumWeightedRoe: evaluation.minimumRoe,
        cumulativeCashConversion: evaluation.cumulativeCashConversion,
        latestCashConversion: evaluation.latestCashConversion,
        missingReasons: screening.missingReasons,
        reviewReasons: screening.reviewReasons
      } : null,
      quality: quality ? {
        tags: quality.tags.map((tag) => ({ id: tag, label: FUNDAMENTAL_QUALITY_TAG_LABELS[tag] })),
        metrics: quality.metrics
      } : null,
      risk: risk ? {
        severity: risk.severity,
        tags: risk.tags.map((tag) => ({ id: tag, label: FUNDAMENTAL_RISK_TAG_LABELS[tag] })),
        metrics: risk.metrics
      } : null,
      peerComparison
    } : null
  }

  const dividendFinancing = {
    available: Boolean(input.dividendSnapshot),
    snapshotDate: input.dividendSnapshot?.snapshotDate ?? null,
    generatedAt: input.dividendSnapshot?.generatedAt ?? null,
    staleReason: input.dividendState.status === 'stale'
      ? input.dividendState.staleReason
      : null,
    listed: Boolean(dividendItem),
    item: dividendItem ? {
      rank: dividendItem.rank,
      dividendYi: dividendItem.dividendYi,
      financingYi: dividendItem.financingYi,
      ratio: dividendItem.ratio,
      netReturnYi: dividendItem.netReturnYi ?? null,
      dividendYears: dividendItem.dividendYears ?? null,
      consecutiveDividendYears: dividendItem.consecutiveDividendYears ?? null,
      recent3YearDividendYi: dividendItem.recent3YearDividendYi ?? null,
      recent5YearDividendYi: dividendItem.recent5YearDividendYi ?? null,
      dividendTrend: dividendItem.dividendTrend ?? null,
      qualityScore: dividendItem.qualityScore ?? null,
      qualityScoreRank: dividendItem.scoreRank ?? null,
      lastFinancingDate: dividendItem.lastFinancingDate ?? null
    } : null
  }

  const snapshotBasis = JSON.stringify({
    quoteId: input.quoteId,
    fundamentalGeneratedAt: fundamental.generatedAt,
    dividendGeneratedAt: dividendFinancing.generatedAt,
    valuation: {
      ...valuation,
      quoteDataAt: undefined,
      historyFetchedAt: undefined
    },
    priceStrength: {
      ...priceStrength,
      dataAt: undefined
    }
  })
  const fingerprint = createHash('sha256').update(snapshotBasis).digest('hex').slice(0, 20)

  return {
    snapshotId: `long-term:${input.quoteId}:${fingerprint}`,
    quoteId: input.quoteId,
    generatedAt: input.generatedAt,
    valueCategory,
    valuation,
    priceStrength,
    fundamental,
    dividendFinancing
  }
}

export type CompactLongTermContext = ReturnType<typeof buildLongTermContext>
