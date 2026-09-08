import { describe, expect, it } from 'vitest'
import type { FundamentalCompany, FundamentalOrganizationType } from '../shared/types'
import { createFinancialValuationAnalysis } from './financial-valuation'

function company(organizationType: FundamentalOrganizationType): FundamentalCompany {
  return {
    code: '600001',
    name: '示例公司',
    market: 'SH',
    quoteId: '1.600001',
    organizationType,
    industryCode: 'J66',
    industryName: '金融业',
    annualReports: [
      {
        year: 2025,
        reportDate: '2025-12-31',
        noticeDate: null,
        weightedAverageRoe: 12,
        deductedWeightedAverageRoe: 11,
        netProfit: 100,
        parentNetProfit: 90,
        deductedParentNetProfit: 85,
        operatingCashFlow: null
      }
    ],
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 1_000,
      totalLiabilities: 900,
      debtAssetRatio: 90,
      industryPercentile: 50
    },
    valuation: {
      dataDate: '2026-09-08',
      priceEarningsRatioTtm: 7,
      priceBookRatio: 0.8,
      priceEarningsIndustryPercentile: 30,
      priceBookIndustryPercentile: 40,
      priceEarningsIndustrySampleSize: 20,
      priceBookIndustrySampleSize: 20
    }
  }
}

describe('financial-company valuation', () => {
  it('provides bank facts without inventing banking metrics', () => {
    const analysis = createFinancialValuationAnalysis(company('bank'))

    expect(analysis?.framework).toContain('PB−ROE')
    expect(analysis?.facts.find((fact) => fact.id === 'pb')?.value).toBe(0.8)
    expect(analysis?.requiredMetrics.every((metric) => metric.status === 'not-integrated')).toBe(
      true
    )
  })

  it('uses an insurance-specific framework', () => {
    expect(createFinancialValuationAnalysis(company('insurance'))?.framework).toContain('P/EV')
  })

  it('returns null for ordinary companies', () => {
    expect(createFinancialValuationAnalysis(company('general'))).toBeNull()
  })
})
