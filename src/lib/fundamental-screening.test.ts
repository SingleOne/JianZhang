import { describe, expect, it } from 'vitest'
import type {
  FundamentalAnnualReport,
  FundamentalCompany,
  FundamentalIndustryBenchmark,
  FundamentalSnapshot
} from '../shared/types'
import {
  classifyFundamentalDividendCategory,
  createFundamentalChangeReport,
  createFundamentalPeerComparisonMap,
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  evaluateFundamentalCompany,
  evaluateFundamentalQuality,
  evaluateFundamentalRisk,
  hasFundamentalRisk,
  matchesFundamentalDividendFilter,
  matchesFundamentalWatchlistFilter,
  summarizeFundamentalDividendWatchlist,
  summarizeFundamentalWatchlist,
  summarizeFundamentalScreening
} from './fundamental-screening'

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
      totalLiabilities: 450,
      debtAssetRatio: 45,
      industryPercentile: 40
    },
    ...overrides
  }
}

const benchmark: FundamentalIndustryBenchmark = {
  code: '1001',
  name: '测试行业',
  sampleSize: 30,
  debtAssetRatioP60: 52
}

function snapshot(snapshotDate: string, rows: FundamentalCompany[]): FundamentalSnapshot {
  return {
    schemaVersion: 1,
    snapshotDate,
    generatedAt: `${snapshotDate}T12:00:00+08:00`,
    currency: 'CNY',
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    latestAnnualReportDate: '2025-12-31',
    sources: [],
    coverage: {
      companyCount: rows.length,
      completeFiveYearRoeCount: rows.length,
      completeFiveYearCashProfitCount: rows.length,
      latestDebtAssetRatioCount: rows.length,
      latestIndustryPercentileCount: rows.length,
      industryCount: 1
    },
    industries: [benchmark],
    rows
  }
}

describe('fundamental screening', () => {
  it('passes an ordinary company that meets all recommended rules', () => {
    const result = evaluateFundamentalCompany(
      company(),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(result.minimumRoe).toBe(18)
    expect(result.cumulativeCashConversion).toBe(120)
    expect(result.checks).toEqual({ roe: true, cash: true, debt: true })
    expect(result.passed).toBe(true)
  })

  it('uses strict boundaries and does not treat non-positive profit as cash conversion', () => {
    const reports = [2021, 2022, 2023, 2024, 2025].map((year) =>
      annualReport(year, {
        weightedAverageRoe: year === 2023 ? 15 : 18,
        netProfit: -10,
        operatingCashFlow: 20
      })
    )
    const result = evaluateFundamentalCompany(
      company({
        annualReports: reports,
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 60
        }
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(result.checks).toEqual({ roe: false, cash: false, debt: false })
    expect(result.passed).toBe(false)
  })

  it('supports deducted ROE and latest-year cash-flow modes', () => {
    const reports = [2021, 2022, 2023, 2024, 2025].map((year) =>
      annualReport(year, {
        deductedWeightedAverageRoe: year === 2022 ? 12 : 17,
        operatingCashFlow: year === 2025 ? 80 : 150
      })
    )
    const result = evaluateFundamentalCompany(company({ annualReports: reports }), benchmark, {
      ...DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
      roeMetric: 'deducted',
      cashFlowMode: 'latest'
    })

    expect(result.checks.roe).toBe(false)
    expect(result.cumulativeCashConversion).toBe(136)
    expect(result.latestCashConversion).toBe(80)
    expect(result.checks.cash).toBe(false)
  })

  it('marks banks as ineligible even when all three numbers pass', () => {
    const result = evaluateFundamentalCompany(
      company({ organizationType: 'bank' }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(result.passedRuleCount).toBe(3)
    expect(result.eligibleOrganization).toBe(false)
    expect(result.passed).toBe(false)
    expect(summarizeFundamentalScreening(result).status).toBe('financial')
  })

  it('separates rule failures from missing financial data', () => {
    const review = evaluateFundamentalCompany(
      company({
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 65
        }
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const missing = evaluateFundamentalCompany(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            weightedAverageRoe: year === 2023 ? null : 18
          })
        )
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(summarizeFundamentalScreening(review)).toMatchObject({
      status: 'review',
      reviewReasons: ['杠杆待核'],
      missingReasons: [],
      reviewCount: 1
    })
    expect(summarizeFundamentalScreening(missing)).toMatchObject({
      status: 'missing',
      reviewReasons: [],
      missingReasons: ['ROE数据不足'],
      reviewCount: 0
    })
  })

  it('adds fixed quality labels only when their recommended evidence passes', () => {
    const profile = evaluateFundamentalQuality(company())

    expect(profile.tags).toEqual([
      'strictFundamental',
      'cashSustained',
      'roeStable',
      'deductedSolid'
    ])
    expect(profile.metrics).toMatchObject({
      minimumDeductedRoe: 17,
      sustainedCashYears: 5,
      netProfitCagr: 0,
      roeRange: 0
    })
    expect(profile.metrics.deductedProfitRatio).toBeCloseTo(94.7368, 4)
  })

  it('supports overlapping growth and improvement labels with reusable evidence', () => {
    const reports = [2021, 2022, 2023, 2024, 2025].map((year, index) => {
      const netProfit = 100 * Math.pow(1.12, index)
      const parentNetProfit = netProfit * 0.95
      return annualReport(year, {
        weightedAverageRoe: 16 + index,
        deductedWeightedAverageRoe: 16 + index,
        netProfit,
        parentNetProfit,
        deductedParentNetProfit: parentNetProfit * 0.95,
        operatingCashFlow: netProfit * 1.2
      })
    })
    const profile = evaluateFundamentalQuality(company({ annualReports: reports }))

    expect(profile.tags).toEqual([
      'strictFundamental',
      'cashSustained',
      'profitGrowth',
      'roeStable',
      'deductedSolid',
      'improving'
    ])
    expect(profile.metrics.netProfitCagr).toBeCloseTo(12)
    expect(profile.metrics.latestCashConversion).toBeCloseTo(120)
  })

  it('uses strict tag boundaries and keeps improvement available outside the hard screen', () => {
    const reports = [2021, 2022, 2023, 2024, 2025].map((year, index) => {
      const netProfits = [100, 110, 120, 130, 146]
      const weightedRoes = [16, 16, 16, 20, 24]
      return annualReport(year, {
        weightedAverageRoe: weightedRoes[index],
        deductedWeightedAverageRoe: index === 0 ? 15 : 18,
        netProfit: netProfits[index],
        parentNetProfit: 100,
        deductedParentNetProfit: 90,
        operatingCashFlow: index === 0 ? netProfits[index] : netProfits[index] * 1.2
      })
    })
    const boundaryProfile = evaluateFundamentalQuality(company({ annualReports: reports }))
    const improvingOnly = evaluateFundamentalQuality(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year, index) =>
          annualReport(year, {
            weightedAverageRoe: [8, 8, 9, 10, 11][index],
            netProfit: [80, 90, 100, 110, 120][index],
            operatingCashFlow: [90, 100, 110, 125, 150][index]
          })
        )
      })
    )

    expect(boundaryProfile.tags).toEqual(['improving'])
    expect(improvingOnly.tags).toEqual(['improving'])
    expect(
      evaluateFundamentalQuality(
        company({
          organizationType: 'bank',
          annualReports: reports
        })
      ).tags
    ).toEqual([])
  })

  it('identifies overlapping fundamental risks and promotes direct cash divergence to critical', () => {
    const reports = [2021, 2022, 2023, 2024, 2025].map((year, index) =>
      annualReport(year, {
        weightedAverageRoe: [25, 24, 23, 21, 19][index],
        deductedWeightedAverageRoe: 12,
        netProfit: [100, 110, 120, 130, 140][index],
        operatingCashFlow: [220, 210, 200, 150, 100][index]
      })
    )
    const profile = evaluateFundamentalRisk(
      company({
        annualReports: reports,
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 85
        }
      })
    )

    expect(profile.tags).toEqual([
      'highLeverageRoe',
      'deductedWeak',
      'profitCashDivergence',
      'roeDecline',
      'singleYearCashWeak'
    ])
    expect(profile.severity).toBe('critical')
    expect(profile.metrics).toMatchObject({
      minimumWeightedRoe: 19,
      minimumDeductedRoe: 12,
      debtIndustryPercentile: 85,
      roeDeclinePoints: 6
    })
    expect(profile.metrics.latestCashConversion).toBeCloseTo(71.4286, 4)
  })

  it('uses strict risk thresholds and excludes financial organizations', () => {
    const boundaryReports = [2021, 2022, 2023, 2024, 2025].map((year, index) =>
      annualReport(year, {
        weightedAverageRoe: [22, 21, 20, 18, 17][index],
        deductedWeightedAverageRoe: index === 0 ? 15 : 18,
        netProfit: 100,
        operatingCashFlow: index === 4 ? 100 : 125
      })
    )
    const boundaryCompany = company({
      annualReports: boundaryReports,
      latestBalanceSheet: {
        ...company().latestBalanceSheet,
        industryPercentile: 80
      }
    })
    const boundaryProfile = evaluateFundamentalRisk(boundaryCompany)
    const cashDivergence = evaluateFundamentalRisk(
      company({
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            operatingCashFlow: 70
          })
        )
      })
    )

    expect(boundaryProfile.tags).toEqual(['highLeverageRoe', 'deductedWeak', 'roeDecline'])
    expect(boundaryProfile.severity).toBe('warning')
    expect(cashDivergence.tags).toEqual(['cashDivergence'])
    expect(cashDivergence.severity).toBe('critical')
    expect(
      hasFundamentalRisk(
        evaluateFundamentalCompany(
          boundaryCompany,
          benchmark,
          DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
        )
      )
    ).toBe(true)
    expect(
      evaluateFundamentalRisk(
        company({
          organizationType: 'bank',
          annualReports: boundaryReports
        })
      ).tags
    ).toEqual([])
  })

  it('includes quarterly financial mine warnings in the combined risk filter', () => {
    const evaluation = evaluateFundamentalCompany(
      company({
        quarterlyRiskReports: [
          {
            reportDate: '2026-06-30',
            noticeDate: '2026-08-01',
            operatingCashFlowCumulative: 100,
            operatingCashFlowQuarter: 20,
            accountsReceivable: 120,
            accountsReceivableGrowthYoY: 25,
            totalOperatingRevenue: 500,
            revenueGrowthYoY: 10,
            receivableRevenueDivergence: 15,
            inventory: 80,
            operatingCost: 300,
            inventoryTurnoverDays: 70,
            inventoryDaysChangeYoY: 5,
            goodwill: 10,
            totalAssets: 1000,
            goodwillAssetRatio: 1
          }
        ]
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(evaluateFundamentalRisk(evaluation.company).tags).toEqual([])
    expect(hasFundamentalRisk(evaluation)).toBe(true)
  })

  it('ranks complete ordinary companies against valid peers in the same industry', () => {
    const evaluations = Array.from({ length: 10 }, (_, index) =>
      evaluateFundamentalCompany(
        company({
          code: `6000${index.toString().padStart(2, '0')}`,
          annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
            annualReport(year, {
              weightedAverageRoe: index === 8 ? 19 : 10 + index,
              operatingCashFlow: 100 + index * 10
            })
          ),
          latestBalanceSheet: {
            ...company().latestBalanceSheet,
            debtAssetRatio: 50 - index
          }
        }),
        benchmark,
        DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
      )
    )
    const comparisons = createFundamentalPeerComparisonMap(evaluations)
    const best = comparisons.get('600009')
    const tiedBest = comparisons.get('600008')

    expect(best?.roe).toMatchObject({
      sampleSize: 10,
      rank: 1,
      topPercent: 10,
      betterThanPercent: 89
    })
    expect(tiedBest?.roe.rank).toBe(1)
    expect(best?.cash).toMatchObject({ rank: 1, betterThanPercent: 100 })
    expect(best?.debt).toMatchObject({ rank: 1, betterThanPercent: 100 })
  })

  it('does not publish a peer rank below the minimum valid sample size', () => {
    const evaluations = Array.from({ length: 9 }, (_, index) =>
      evaluateFundamentalCompany(
        company({ code: `6001${index.toString().padStart(2, '0')}` }),
        benchmark,
        DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
      )
    )
    const comparison = createFundamentalPeerComparisonMap(evaluations).get('600100')

    expect(comparison?.roe).toMatchObject({ sampleSize: 9, rank: null, topPercent: null })
    expect(comparison?.cash.rank).toBeNull()
    expect(comparison?.debt.rank).toBeNull()
  })

  it('summarizes and filters the current watchlist scope without treating missing data as failure', () => {
    const passed = evaluateFundamentalCompany(
      company({ code: '600201' }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const review = evaluateFundamentalCompany(
      company({
        code: '600202',
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 70
        }
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const missing = evaluateFundamentalCompany(
      company({
        code: '600203',
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            weightedAverageRoe: year === 2024 ? null : 18
          })
        )
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const financial = evaluateFundamentalCompany(
      company({ code: '600204', organizationType: 'bank' }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )

    expect(summarizeFundamentalWatchlist([passed, review, missing, financial, undefined])).toEqual({
      total: 5,
      covered: 4,
      passed: 1,
      review: 1,
      missing: 1,
      financial: 1,
      unavailable: 1,
      roe: 0,
      cash: 0,
      debt: 1,
      risk: 0
    })
    expect(matchesFundamentalWatchlistFilter(review, 'review')).toBe(true)
    expect(matchesFundamentalWatchlistFilter(review, 'debt')).toBe(true)
    expect(matchesFundamentalWatchlistFilter(missing, 'roe')).toBe(false)
    expect(matchesFundamentalWatchlistFilter(undefined, 'unavailable')).toBe(true)
  })

  it('classifies and filters the four fundamental-dividend value combinations', () => {
    const passed = evaluateFundamentalCompany(
      company({ code: '600211' }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const review = evaluateFundamentalCompany(
      company({
        code: '600212',
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 70
        }
      }),
      benchmark,
      DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
    )
    const items = [
      { evaluation: passed, hasDividendLabel: true },
      { evaluation: passed, hasDividendLabel: false },
      { evaluation: review, hasDividendLabel: true },
      { evaluation: undefined, hasDividendLabel: false }
    ]

    expect(summarizeFundamentalDividendWatchlist(items)).toEqual({
      total: 4,
      dual: 1,
      fundamental: 1,
      dividend: 1,
      unlabeled: 1
    })
    expect(classifyFundamentalDividendCategory(review, true)).toBe('dividend')
    expect(matchesFundamentalDividendFilter(items[0], 'dual')).toBe(true)
    expect(matchesFundamentalDividendFilter(items[3], 'unlabeled')).toBe(true)
    expect(matchesFundamentalDividendFilter(items[1], 'dividend')).toBe(false)
  })

  it('creates a change report only for coverage and screening-state changes', () => {
    const previous = snapshot('2026-04-01', [
      company({ code: '600301', name: '移出候选' }),
      company({
        code: '600302',
        name: '新入候选',
        latestBalanceSheet: {
          ...company().latestBalanceSheet,
          industryPercentile: 70
        }
      }),
      company({
        code: '600303',
        name: '补齐数据',
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            weightedAverageRoe: year === 2024 ? null : 18
          })
        )
      }),
      company({ code: '600304', name: '退出覆盖' }),
      company({ code: '600305', name: '只有数值变化' })
    ])
    const current = snapshot('2026-08-01', [
      company({
        code: '600301',
        name: '移出候选',
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            operatingCashFlow: 80
          })
        )
      }),
      company({ code: '600302', name: '新入候选' }),
      company({ code: '600303', name: '补齐数据' }),
      company({
        code: '600305',
        name: '只有数值变化',
        annualReports: [2021, 2022, 2023, 2024, 2025].map((year) =>
          annualReport(year, {
            weightedAverageRoe: 19
          })
        )
      }),
      company({ code: '600306', name: '新增覆盖' })
    ])
    const report = createFundamentalChangeReport(previous, current, '2026-08-01T13:00:00+08:00')

    expect(report.summary).toEqual({
      enteredCount: 2,
      exitedCount: 1,
      reviewAddedCount: 1,
      reviewResolvedCount: 1,
      dataChangedCount: 1,
      addedCoverageCount: 1,
      removedCoverageCount: 1,
      organizationChangedCount: 0
    })
    expect(report.rows.map((item) => item.code)).not.toContain('600305')
    expect(report.rows.find((item) => item.code === '600301')).toMatchObject({
      changeTypes: ['exited', 'reviewAdded'],
      previousStatus: 'passed',
      currentStatus: 'review',
      ruleChanges: [{ rule: 'cash', previousStatus: 'passed', currentStatus: 'failed' }]
    })
    expect(report.rows.find((item) => item.code === '600303')?.changeTypes).toEqual([
      'entered',
      'dataCompleted'
    ])
  })
})
