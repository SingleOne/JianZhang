import { describe, expect, it } from 'vitest'
import type { FundamentalCompany } from '../shared/types'
import { createFcffAnalysis } from './fcff-analysis'

function company(fcffValues: Array<number | null>): FundamentalCompany {
  return {
    code: '600001',
    name: '示例公司',
    market: 'SH',
    quoteId: '1.600001',
    organizationType: 'general',
    industryCode: 'C39',
    industryName: '制造业',
    annualReports: fcffValues.map((fcff, index) => ({
      year: 2021 + index,
      reportDate: `${2021 + index}-12-31`,
      noticeDate: null,
      weightedAverageRoe: 15,
      deductedWeightedAverageRoe: 14,
      netProfit: 100,
      parentNetProfit: 100,
      deductedParentNetProfit: 90,
      operatingCashFlow: 120,
      fcffBreakdown: {
        year: 2021 + index,
        reportDate: `${2021 + index}-12-31`,
        operatingProfit: 100,
        interestExpense: 5,
        nonOperatingIncomeAdjustments: 2,
        adjustedEbit: 103,
        totalProfit: 100,
        incomeTaxExpense: 25,
        effectiveTaxRate: 25,
        nopat: 77.25,
        depreciationAndAmortization: 10,
        capitalExpenditure: 15,
        operatingCurrentAssets: 200,
        operatingCurrentLiabilities: 120,
        operatingWorkingCapital: 80,
        operatingWorkingCapitalChange: 5,
        fcff,
        unavailableReason: fcff === null ? '营运资本同比数据缺失' : null
      }
    })),
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 1_000,
      totalLiabilities: 400,
      debtAssetRatio: 40,
      industryPercentile: 50
    }
  }
}

describe('strict FCFF analysis', () => {
  it('normalizes the latest three valid years', () => {
    const result = createFcffAnalysis(company([80, 90, 100, 110, 120]))

    expect(result.status).toBe('available')
    expect(result.normalizedFcff).toBe(110)
    expect(result.validYears).toBe(5)
  })

  it('keeps missing annual inputs unavailable instead of treating them as zero', () => {
    const result = createFcffAnalysis(company([80, 90, 100, null, 120]))

    expect(result.status).toBe('insufficient-data')
    expect(result.normalizedFcff).toBeNull()
  })

  it('does not apply ordinary FCFF to banks', () => {
    const input = company([80, 90, 100, 110, 120])
    input.organizationType = 'bank'

    expect(createFcffAnalysis(input).status).toBe('not-applicable')
  })
})
