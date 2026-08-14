import { describe, expect, it } from 'vitest'
import type { FundamentalCompany, FundamentalQuarterlyRiskReport } from '../shared/types'
import { evaluateFinancialMine } from './financial-mine-detector'

function quarterlyReport(
  reportDate: string,
  overrides: Partial<FundamentalQuarterlyRiskReport> = {}
): FundamentalQuarterlyRiskReport {
  return {
    reportDate,
    noticeDate: null,
    operatingCashFlowCumulative: 100,
    operatingCashFlowQuarter: 20,
    accountsReceivable: 100,
    accountsReceivableGrowthYoY: 5,
    totalOperatingRevenue: 500,
    revenueGrowthYoY: 10,
    receivableRevenueDivergence: -5,
    inventory: 80,
    operatingCost: 300,
    inventoryTurnoverDays: 70,
    inventoryDaysChangeYoY: 5,
    goodwill: 10,
    totalAssets: 1000,
    goodwillAssetRatio: 1,
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
    industryCode: '10',
    industryName: '测试行业',
    annualReports: [],
    quarterlyRiskReports: [
      quarterlyReport('2025-09-30'),
      quarterlyReport('2025-12-31'),
      quarterlyReport('2026-03-31'),
      quarterlyReport('2026-06-30')
    ],
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

describe('financial mine detector', () => {
  it('marks any critical signal as high risk and keeps an eight-point maximum score', () => {
    const reports: FundamentalQuarterlyRiskReport[] = company().quarterlyRiskReports!.map(
      (report) => ({
        ...report,
        operatingCashFlowQuarter: -20
      })
    )
    reports[3] = quarterlyReport('2026-06-30', {
      operatingCashFlowQuarter: -20,
      receivableRevenueDivergence: 25,
      inventoryDaysChangeYoY: 35,
      goodwillAssetRatio: 31
    })
    const result = evaluateFinancialMine(company({ quarterlyRiskReports: reports }))

    expect(result.level).toBe('high')
    expect(result.score).toBe(8)
    expect(result.consecutiveNegativeCashFlowQuarters).toBe(4)
    expect(result.indicators.map((indicator) => indicator.status)).toEqual([
      'critical',
      'critical',
      'warning',
      'warning'
    ])
  })

  it('uses strict thresholds and reports only warning signals as medium risk', () => {
    const reports: FundamentalQuarterlyRiskReport[] = company().quarterlyRiskReports!.map(
      (report, index) => ({
        ...report,
        operatingCashFlowQuarter: index >= 2 ? -10 : 20
      })
    )
    reports[3] = quarterlyReport('2026-06-30', {
      operatingCashFlowQuarter: -10,
      receivableRevenueDivergence: 20,
      inventoryDaysChangeYoY: 30,
      goodwillAssetRatio: 30
    })
    const result = evaluateFinancialMine(company({ quarterlyRiskReports: reports }))

    expect(result.level).toBe('medium')
    expect(result.score).toBe(2)
    expect(result.indicators.map((indicator) => indicator.status)).toEqual([
      'warning',
      'warning',
      'passed',
      'passed'
    ])
  })

  it('does not misclassify missing data as low risk', () => {
    const result = evaluateFinancialMine(company({ quarterlyRiskReports: undefined }))

    expect(result.level).toBe('insufficient')
    expect(result.indicators.every((indicator) => indicator.status === 'missing')).toBe(true)
  })

  it('excludes financial organizations from ordinary-company mine detection', () => {
    const result = evaluateFinancialMine(company({ organizationType: 'bank' }))

    expect(result.level).toBe('notApplicable')
    expect(result.indicators).toEqual([])
  })
})
