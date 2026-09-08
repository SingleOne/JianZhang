import { describe, expect, it } from 'vitest'
import type { FundamentalCompany, FundamentalFcffCoverage } from '../shared/types'
import { createStrictDcfAnalysis, createWaccAnalysis } from './strict-dcf-analysis'

function company(): FundamentalCompany {
  return {
    code: '600001',
    name: '示例公司',
    market: 'SH',
    quoteId: '1.600001',
    organizationType: 'general',
    industryCode: 'C39',
    industryName: '制造业',
    annualReports: [80, 90, 100, 110, 120].map((fcff, index) => ({
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
        interestBearingDebt: 200,
        averageInterestBearingDebt: 190,
        preTaxDebtCost: 2.63,
        fcff,
        unavailableReason: null
      }
    })),
    latestBalanceSheet: {
      reportDate: '2025-12-31',
      noticeDate: null,
      totalAssets: 2_000,
      totalLiabilities: 800,
      debtAssetRatio: 40,
      industryPercentile: 50,
      netDebt: 50
    },
    valuation: {
      dataDate: '2026-09-08',
      closePrice: 10,
      totalMarketValue: 1_000,
      priceEarningsRatioTtm: 12,
      priceBookRatio: 2,
      priceEarningsIndustryPercentile: 40,
      priceBookIndustryPercentile: 50,
      priceEarningsIndustrySampleSize: 20,
      priceBookIndustrySampleSize: 20
    }
  }
}

const fcff: FundamentalFcffCoverage = {
  status: 'available',
  totalYears: 5,
  validYears: 5,
  positiveYears: 5,
  coefficientOfVariation: 0.14,
  normalizedFcff: 110,
  normalizationYears: 3,
  reason: null
}

describe('strict FCFF DCF', () => {
  it('calculates company WACC from explicit assumptions and capital structure', () => {
    const result = createWaccAnalysis(company(), ['stable-cash-flow'])

    expect(result.available).toBe(true)
    expect(result.value).toBeLessThan(result.costOfEquity)
    expect(result.inputs.beta.source).toContain('假设')
  })

  it('creates conservative, base and optimistic values in order', () => {
    const result = createStrictDcfAnalysis(company(), 12, ['stable-cash-flow'], fcff)

    expect(result.analysis?.scenarios.map((scenario) => scenario.scenario)).toEqual([
      'conservative',
      'base',
      'optimistic'
    ])
    expect(result.analysis?.rangeLow).toBeLessThan(result.analysis!.rangeHigh)
  })

  it('returns parameter incomplete when debt cost is missing', () => {
    const input = company()
    input.annualReports.at(-1)!.fcffBreakdown!.preTaxDebtCost = null

    expect(createStrictDcfAnalysis(input, 12, [], fcff).unavailableReason).toBe('wacc')
  })
})
