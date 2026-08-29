import { describe, expect, it } from 'vitest'
import type { FundamentalCompany } from '../shared/types'
import { DCF_LOW_VALUE_THRESHOLD_PERCENT, createDcfAnalysis } from './dcf-analysis'

function company(overrides: Partial<FundamentalCompany> = {}): FundamentalCompany {
  return {
    code: '600001',
    name: '示例公司',
    market: 'SH',
    quoteId: '1.600001',
    organizationType: 'general',
    industryCode: 'A01',
    industryName: '示例行业',
    annualReports: [100, 110, 120, 130, 140].map((freeCashFlow, index) => ({
      year: 2021 + index,
      reportDate: `${2021 + index}-12-31`,
      noticeDate: null,
      weightedAverageRoe: 18,
      deductedWeightedAverageRoe: 17,
      netProfit: 100,
      parentNetProfit: 100,
      deductedParentNetProfit: 95,
      operatingCashFlow: freeCashFlow + 20,
      capitalExpenditure: 20,
      freeCashFlow
    })),
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 2_000,
      totalLiabilities: 800,
      debtAssetRatio: 40,
      industryPercentile: 35,
      netDebt: 50
    },
    valuation: {
      dataDate: '2026-08-05',
      closePrice: 10,
      totalMarketValue: 1_000,
      circulatingMarketValue: 900,
      priceEarningsRatioTtm: 12,
      priceBookRatio: 2,
      priceEarningsIndustryPercentile: 40,
      priceBookIndustryPercentile: 50,
      priceEarningsIndustrySampleSize: 20,
      priceBookIndustrySampleSize: 20
    },
    ...overrides
  }
}

describe('DCF analysis', () => {
  it('calculates fair value per share and compares it with the live price', () => {
    const result = createDcfAnalysis(company(), 12)

    expect(result.unavailableReason).toBeNull()
    expect(result.analysis?.sharesOutstanding).toBe(100)
    expect(result.analysis?.normalizedFreeCashFlow).toBe(130)
    expect(result.analysis?.forecastGrowthRate).toBeCloseTo(8.78, 2)
    expect(result.analysis?.fairValuePerShare).toBeCloseTo(23.87, 1)
    expect(result.analysis?.differencePercent).toBeCloseTo(98.95, 0)
    expect(result.analysis?.priceToFairValuePercent).toBeCloseTo(50.26, 1)
    expect(result.analysis?.belowLowValueThreshold).toBe(false)
  })

  it('marks DCF values below 70% of the live price', () => {
    const result = createDcfAnalysis(company(), 40)

    expect(result.analysis?.fairValueToPricePercent).toBeLessThan(DCF_LOW_VALUE_THRESHOLD_PERCENT)
    expect(result.analysis?.priceToFairValuePercent).toBeGreaterThan(100)
    expect(result.analysis?.belowLowValueThreshold).toBe(true)
  })

  it('uses a neutral growth assumption when historical CAGR cannot be calculated', () => {
    const input = company()
    input.annualReports[0].freeCashFlow = -20

    const result = createDcfAnalysis(input, 12)

    expect(result.analysis?.historicalGrowthRate).toBeNull()
    expect(result.analysis?.forecastGrowthRate).toBe(0)
  })

  it('does not apply ordinary-company DCF to financial companies', () => {
    const result = createDcfAnalysis(company({ organizationType: 'bank' }), 12)

    expect(result).toEqual({ analysis: null, unavailableReason: 'not-applicable' })
  })

  it('requires snapshot close price to derive total shares', () => {
    const input = company()
    input.valuation = { ...input.valuation!, closePrice: undefined }

    const result = createDcfAnalysis(input, 12)

    expect(result).toEqual({ analysis: null, unavailableReason: 'share-count' })
  })
})
