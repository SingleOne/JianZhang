import { describe, expect, it } from 'vitest'
import type {
  FundamentalAnnualReport,
  FundamentalCompany,
  FundamentalIndustryBenchmark
} from '../shared/types'
import {
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  evaluateFundamentalCompany
} from './fundamental-screening'
import {
  calculatePortfolioQualitySummary,
  type PortfolioQualityInput
} from './portfolio-quality'

const benchmark: FundamentalIndustryBenchmark = {
  code: '1001',
  name: '测试行业',
  sampleSize: 20,
  debtAssetRatioP60: 55
}

function annualReport(
  year: number,
  overrides: Partial<FundamentalAnnualReport> = {}
): FundamentalAnnualReport {
  return {
    year,
    reportDate: `${year}-12-31`,
    noticeDate: null,
    weightedAverageRoe: 18,
    deductedWeightedAverageRoe: 17,
    netProfit: 100,
    parentNetProfit: 95,
    deductedParentNetProfit: 90,
    operatingCashFlow: 120,
    ...overrides
  }
}

function company(overrides: Partial<FundamentalCompany> = {}): FundamentalCompany {
  return {
    code: '600001',
    name: '测试股份',
    market: 'SH',
    quoteId: '1.600001',
    organizationType: 'general',
    industryCode: '1001',
    industryName: '测试行业',
    annualReports: [2021, 2022, 2023, 2024, 2025].map((year) => annualReport(year)),
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 1000,
      totalLiabilities: 400,
      debtAssetRatio: 40,
      industryPercentile: 35
    },
    ...overrides
  }
}

function input(
  quoteId: string,
  marketValue: number | null,
  overrides: Partial<PortfolioQualityInput> = {}
): PortfolioQualityInput {
  return {
    quoteId,
    code: quoteId.slice(-6),
    name: `股票${quoteId.slice(-1)}`,
    industryName: '测试行业',
    marketValue,
    costValue: 80,
    hasDividendLabel: false,
    ...overrides
  }
}

describe('portfolio quality summary', () => {
  it('weights four exclusive value categories by priced position market value', () => {
    const passed = evaluateFundamentalCompany(
      company(),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const failed = evaluateFundamentalCompany(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025]
          .map((year) => annualReport(year, { weightedAverageRoe: 10 }))
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const result = calculatePortfolioQualitySummary([
      input('1.600001', 40, { fundamentalEvaluation: passed, hasDividendLabel: true }),
      input('1.600002', 30, { fundamentalEvaluation: passed }),
      input('1.600003', 20, { fundamentalEvaluation: failed, hasDividendLabel: true }),
      input('1.600004', 10, { fundamentalEvaluation: failed })
    ])

    expect(result.totalMarketValue).toBe(100)
    expect(result.valueBuckets.dual).toMatchObject({ count: 1, marketValue: 40, percent: 40 })
    expect(result.valueBuckets.fundamental.percent).toBe(30)
    expect(result.valueBuckets.dividend.percent).toBe(20)
    expect(result.valueBuckets.unlabeled.percent).toBe(10)
    expect(result.holdings.map((holding) => holding.weight)).toEqual([40, 30, 20, 10])
  })

  it('separates critical, warning, clear and unassessed risk exposure', () => {
    const critical = evaluateFundamentalCompany(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025]
          .map((year) => annualReport(year, { operatingCashFlow: 70 }))
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const warning = evaluateFundamentalCompany(
      company({
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 85
        }
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const clear = evaluateFundamentalCompany(
      company(),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const incomplete = evaluateFundamentalCompany(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025]
          .map((year, index) => annualReport(year, {
            deductedWeightedAverageRoe: index === 0 ? null : 17
          }))
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const result = calculatePortfolioQualitySummary([
      input('1.600001', 40, { fundamentalEvaluation: critical }),
      input('1.600002', 30, { fundamentalEvaluation: warning }),
      input('1.600003', 20, { fundamentalEvaluation: clear }),
      input('1.600004', 10, { fundamentalEvaluation: incomplete }),
      input('1.600005', null)
    ])

    expect(result.riskBuckets.critical).toMatchObject({ count: 1, percent: 40 })
    expect(result.riskBuckets.warning).toMatchObject({ count: 1, percent: 30 })
    expect(result.riskBuckets.clear).toMatchObject({ count: 1, percent: 20 })
    expect(result.riskBuckets.unassessed).toMatchObject({ count: 2, percent: 10 })
    expect(result.holdings[0].riskTags).toContain('cashDivergence')
    expect(result.holdings[1].riskTags).toContain('highLeverageRoe')
    expect(result.riskTagBuckets.cashDivergence).toMatchObject({ count: 1, percent: 40 })
    expect(result.riskTagBuckets.highLeverageRoe).toMatchObject({ count: 1, percent: 30 })
  })

  it('summarizes portfolio concentration and value mix inside each industry', () => {
    const passed = evaluateFundamentalCompany(
      company(),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const result = calculatePortfolioQualitySummary([
      input('1.600001', 60, {
        industryName: '消费',
        fundamentalEvaluation: passed,
        hasDividendLabel: true
      }),
      input('1.600002', 20, {
        industryName: '消费',
        fundamentalEvaluation: passed
      }),
      input('1.600003', 20, { industryName: '制造' }),
      input('1.600004', null, { industryName: '行业待核' })
    ])

    expect(result.industries.map((industry) => industry.name)).toEqual([
      '消费',
      '制造',
      '行业待核'
    ])
    expect(result.industries[0]).toMatchObject({
      count: 2,
      pricedCount: 2,
      marketValue: 80,
      percent: 80
    })
    expect(result.industries[0].valueBuckets.dual.percent).toBe(75)
    expect(result.industries[0].valueBuckets.fundamental.percent).toBe(25)
    expect(result.industries[2]).toMatchObject({
      count: 1,
      pricedCount: 0,
      marketValue: 0,
      percent: 0
    })
  })

  it('keeps unpriced positions out of percentages and reports their cost value', () => {
    const result = calculatePortfolioQualitySummary([
      input('1.600001', 100),
      input('1.600002', null, { costValue: 800 })
    ])

    expect(result).toMatchObject({
      positionCount: 2,
      pricedPositionCount: 1,
      unpricedPositionCount: 1,
      totalMarketValue: 100,
      unpricedCostValue: 800
    })
    expect(result.holdings.at(-1)).toMatchObject({
      quoteId: '1.600002',
      marketValue: null,
      weight: null
    })
  })
})
