import { describe, expect, it } from 'vitest'
import type { FundamentalCompany, FundamentalOrganizationType } from '../shared/types'
import { createFundamentalValuationProfile } from './fundamental-valuation'

function company(
  organizationType: FundamentalOrganizationType,
  freeCashFlows: number[] = [100, 105, 110, 108, 112]
): FundamentalCompany {
  return {
    code: '600001',
    name: '示例公司',
    market: 'SH',
    quoteId: '1.600001',
    organizationType,
    industryCode: 'C26',
    industryName: '化学原料',
    annualReports: freeCashFlows.map((freeCashFlow, index) => ({
      year: 2021 + index,
      reportDate: `${2021 + index}-12-31`,
      noticeDate: null,
      weightedAverageRoe: 15,
      deductedWeightedAverageRoe: 14,
      netProfit: 100,
      parentNetProfit: 100,
      deductedParentNetProfit: 90,
      operatingCashFlow: freeCashFlow + 20,
      capitalExpenditure: 20,
      freeCashFlow
    })),
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 1_000,
      totalLiabilities: 400,
      debtAssetRatio: 40,
      industryPercentile: 50,
      netDebt: 20
    }
  }
}

describe('fundamental valuation profile', () => {
  it('classifies ordinary company tags with deterministic rules', () => {
    const profile = createFundamentalValuationProfile(company('general'))

    expect(profile.primaryModel).toBe('简化现金流 DCF')
    expect(profile.tags).toContain('stable-cash-flow')
    expect(profile.tags).toContain('cyclical')
  })

  it('uses financial-company specific guidance instead of ordinary FCFF', () => {
    const profile = createFundamentalValuationProfile(company('bank'))

    expect(profile.primaryModel).toBe('PB−ROE 框架')
    expect(profile.unavailableMetrics).toContain('普通企业 FCFF')
    expect(profile.metricGuidance).toContainEqual(
      expect.objectContaining({ id: 'bank-special', availability: 'insufficient-data' })
    )
  })
})
