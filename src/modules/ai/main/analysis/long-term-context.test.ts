import { describe, expect, it } from 'vitest'
import type {
  DataSnapshotRuntimeState,
  DividendFinancingSnapshot,
  FundamentalSnapshot,
  KlineResult,
  StockQuote,
  StockValuationHistory
} from '../../../../shared/types'
import { buildLongTermContext, calculateLongTermPriceStrength } from './long-term-context'

const readyState: DataSnapshotRuntimeState = {
  status: 'ready',
  progressMessage: null,
  error: null,
  snapshotDate: '2026-08-05',
  generatedAt: '2026-08-05T12:00:00+08:00',
  recordCount: 1,
  periodLabel: '2021—2025 年',
  staleReason: null
}

function quote(latest = 120): StockQuote {
  return {
    code: '600000',
    name: '测试公司',
    quoteId: '1.600000',
    latest,
    change: -1,
    changePercent: -0.83,
    open: 121,
    high: 122,
    low: 119,
    previousClose: 121,
    volume: 1000,
    amount: 12_000_000,
    turnoverRate: 1.2,
    priceEarningsRatioTtm: 12.5,
    priceBookRatio: 1.8,
    updatedAt: '2026-08-05T14:30:00+08:00'
  }
}

function dailyKline(): KlineResult {
  return {
    quoteId: '1.600000',
    name: '测试公司',
    tradingDate: '2025-08-01 至 2026-08-05',
    bars: Array.from({ length: 260 }, (_, index) => ({
      time: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: 80 + index * 0.1,
      close: 80 + index * 0.1,
      high: 81 + index * 0.1,
      low: 79 + index * 0.1,
      volume: 1000,
      amount: 100_000
    }))
  }
}

function fundamentalSnapshot(): FundamentalSnapshot {
  return {
    schemaVersion: 3,
    snapshotDate: '2026-08-05',
    generatedAt: '2026-08-05T12:00:00+08:00',
    currency: 'CNY',
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    latestAnnualReportDate: '2025-12-31',
    sources: [],
    coverage: {
      companyCount: 1,
      completeFiveYearRoeCount: 1,
      completeFiveYearCashProfitCount: 1,
      completeFiveYearFreeCashFlowCount: 1,
      completeFiveYearRoicCount: 1,
      latestDebtAssetRatioCount: 1,
      latestIndustryPercentileCount: 1,
      latestNetDebtCount: 1,
      industryCount: 1
    },
    industries: [{ code: '10', name: '测试行业', sampleSize: 20, debtAssetRatioP60: 50 }],
    rows: [{
      code: '600000',
      name: '测试公司',
      market: 'SH',
      quoteId: '1.600000',
      organizationType: 'general',
      industryCode: '10',
      industryName: '测试行业',
      annualReports: [2021, 2022, 2023, 2024, 2025].map((year) => ({
        year,
        reportDate: `${year}-12-31`,
        noticeDate: null,
        weightedAverageRoe: 18,
        deductedWeightedAverageRoe: 17,
        roic: 14,
        netProfit: 100,
        parentNetProfit: 95,
        deductedParentNetProfit: 92,
        operatingCashFlow: 130,
        capitalExpenditure: 30,
        freeCashFlow: 100
      })),
      latestBalanceSheet: {
        reportDate: '2025-12-31',
        noticeDate: null,
        totalAssets: 1000,
        totalLiabilities: 400,
        debtAssetRatio: 40,
        industryPercentile: 35,
        monetaryFunds: 200,
        interestBearingDebt: 120,
        netDebt: -80
      },
      valuation: {
        dataDate: '2026-08-04',
        priceEarningsRatioTtm: 12.3,
        priceBookRatio: 1.75,
        priceEarningsIndustryPercentile: 42,
        priceBookIndustryPercentile: 36,
        priceEarningsIndustrySampleSize: 20,
        priceBookIndustrySampleSize: 21
      }
    }]
  }
}

function valuationHistory(): StockValuationHistory {
  return {
    quoteId: '1.600000',
    fetchedAt: '2026-08-05T14:30:30+08:00',
    periodStart: '2021-08-05',
    periodEnd: '2026-08-05',
    priceEarningsRatioTtmValues: [8, 10, 12, 15],
    priceBookRatioValues: [1, 1.5, 2, 2.5]
  }
}

function dividendSnapshot(): DividendFinancingSnapshot {
  return {
    schemaVersion: 2,
    scoreMethodologyVersion: 1,
    snapshotDate: '2026-08-05',
    generatedAt: '2026-08-05T13:00:00+08:00',
    thresholdPercent: 100,
    activeStockCount: 1,
    exactCandidateCount: 1,
    dualListedCount: 0,
    financingErrorCount: 0,
    dividendErrorCount: 0,
    rows: [{
      rank: 1,
      code: '600000',
      name: '测试公司',
      market: 'SH',
      dividendYi: 100,
      financingYi: 20,
      ratio: 500,
      qualityScore: 88
    }]
  }
}

describe('long-term AI context', () => {
  it('calculates price strength independently from fundamental metrics', () => {
    const strength = calculateLongTermPriceStrength(quote(), dailyKline())

    expect(strength.currentPrice).toBe(120)
    expect(strength.return20).not.toBeNull()
    expect(strength.return250).not.toBeNull()
    expect(strength.distanceFromMa60).not.toBeNull()
    expect(strength.range250Position).toBeGreaterThan(0)
  })

  it('combines financial quality, valuation, shareholder return and price timing', () => {
    const context = buildLongTermContext({
      quoteId: '1.600000',
      quote: quote(),
      dailyKline: dailyKline(),
      valuationHistory: valuationHistory(),
      fundamentalSnapshot: fundamentalSnapshot(),
      fundamentalState: readyState,
      dividendSnapshot: dividendSnapshot(),
      dividendState: readyState,
      generatedAt: '2026-08-05T14:31:00+08:00'
    })

    expect(context.valueCategory).toBe('dual')
    expect(context.valuation).toMatchObject({
      priceEarningsRatioTtm: {
        currentValue: 12.5,
        historicalPercentile: 75,
        industryPercentile: 42
      },
      priceBookRatio: {
        currentValue: 1.8,
        historicalPercentile: 50,
        industryPercentile: 36
      }
    })
    expect(context.fundamental.company?.annualReports.at(-1)).toMatchObject({
      roic: 14,
      freeCashFlow: 100
    })
    expect(context.fundamental.company?.latestBalanceSheet.netDebt).toBe(-80)
    expect(context.dividendFinancing.listed).toBe(true)
  })

  it('changes only price context and fingerprint when the quote weakens', () => {
    const base = {
      quoteId: '1.600000',
      dailyKline: dailyKline(),
      valuationHistory: valuationHistory(),
      fundamentalSnapshot: fundamentalSnapshot(),
      fundamentalState: readyState,
      dividendSnapshot: dividendSnapshot(),
      dividendState: readyState,
      generatedAt: '2026-08-05T14:31:00+08:00'
    }
    const strong = buildLongTermContext({ ...base, quote: quote(120) })
    const weak = buildLongTermContext({ ...base, quote: quote(90) })

    expect(weak.fundamental).toEqual(strong.fundamental)
    expect(weak.priceStrength.currentPrice).toBe(90)
    expect(weak.snapshotId).not.toBe(strong.snapshotId)
  })

  it('excludes ordinary corporate cash flow, ROIC and net debt for financial companies', () => {
    const financialSnapshot = fundamentalSnapshot()
    financialSnapshot.rows[0].organizationType = 'bank'
    const context = buildLongTermContext({
      quoteId: '1.600000',
      quote: quote(),
      dailyKline: dailyKline(),
      valuationHistory: valuationHistory(),
      fundamentalSnapshot: financialSnapshot,
      fundamentalState: readyState,
      dividendSnapshot: dividendSnapshot(),
      dividendState: readyState,
      generatedAt: '2026-08-05T14:31:00+08:00'
    })

    expect(context.fundamental.company?.ordinaryCorporateMetricsApplicable).toBe(false)
    expect(context.fundamental.company?.annualReports.at(-1)?.roic).toBeNull()
    expect(context.fundamental.company?.annualReports.at(-1)?.freeCashFlow).toBeNull()
    expect(context.fundamental.company?.latestBalanceSheet.netDebt).toBeNull()
    expect(context.valuation.priceBookRatio.industryPercentile).toBe(36)
  })

  it('reuses the fingerprint when only the quote refresh timestamp changes', () => {
    const base = {
      quoteId: '1.600000',
      dailyKline: dailyKline(),
      valuationHistory: valuationHistory(),
      fundamentalSnapshot: fundamentalSnapshot(),
      fundamentalState: readyState,
      dividendSnapshot: dividendSnapshot(),
      dividendState: readyState,
      generatedAt: '2026-08-05T14:31:00+08:00'
    }
    const first = buildLongTermContext({ ...base, quote: quote() })
    const refreshed = buildLongTermContext({
      ...base,
      quote: { ...quote(), updatedAt: '2026-08-05T14:31:00+08:00' }
    })

    expect(refreshed.snapshotId).toBe(first.snapshotId)
  })
})
