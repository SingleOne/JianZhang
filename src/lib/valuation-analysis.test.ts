import { describe, expect, it } from 'vitest'
import type { FundamentalCompany, StockQuote, StockValuationHistory } from '../shared/types'
import {
  createStockValuationAnalysis,
  usesOrdinaryCorporateInvestmentMetrics,
  valuationPercentile
} from './valuation-analysis'

describe('valuation analysis', () => {
  it('calculates positive historical percentile ranks', () => {
    expect(valuationPercentile([8, 10, 12, 20], 12)).toBe(75)
    expect(valuationPercentile([8, 10], -2)).toBeNull()
  })

  it('keeps quote, history and industry valuation dates separate', () => {
    const quote = {
      quoteId: '1.600000',
      priceEarningsRatioTtm: 12,
      priceBookRatio: 1.5,
      updatedAt: '2026-08-05T14:30:00+08:00'
    } as StockQuote
    const company = {
      valuation: {
        dataDate: '2026-08-04',
        priceEarningsRatioTtm: 11.8,
        priceBookRatio: 1.48,
        totalMarketValue: 120_000_000_000,
        circulatingMarketValue: 96_000_000_000,
        priceEarningsIndustryPercentile: 40,
        priceBookIndustryPercentile: 35,
        priceEarningsIndustrySampleSize: 20,
        priceBookIndustrySampleSize: 22
      }
    } as FundamentalCompany
    const history: StockValuationHistory = {
      quoteId: '1.600000',
      fetchedAt: '2026-08-05T14:31:00+08:00',
      periodStart: '2021-08-05',
      periodEnd: '2026-08-05',
      priceEarningsRatioTtmValues: [8, 10, 12, 14],
      priceBookRatioValues: [1, 1.5, 2]
    }

    const result = createStockValuationAnalysis('1.600000', quote, company, history)

    expect(result.quoteDataAt).toBe('2026-08-05T14:30:00+08:00')
    expect(result.industryDataAt).toBe('2026-08-04')
    expect(result.totalMarketValue).toBe(120_000_000_000)
    expect(result.circulatingMarketValue).toBe(96_000_000_000)
    expect(result.priceEarningsRatioTtm.historicalPercentile).toBe(75)
    expect(result.priceBookRatio.industryPercentile).toBe(35)
  })

  it('calculates current PCF TTM from four consecutive quarter cash flows', () => {
    const quote = {
      quoteId: '1.600000',
      totalMarketValue: 120_000_000_000,
      latest: 12,
      updatedAt: '2026-08-05T14:30:00+08:00'
    } as StockQuote
    const company = {
      organizationType: 'general',
      quarterlyRiskReports: [
        { reportDate: '2025-09-30', operatingCashFlowQuarter: 2_000_000_000 },
        { reportDate: '2025-12-31', operatingCashFlowQuarter: 3_000_000_000 },
        { reportDate: '2026-03-31', operatingCashFlowQuarter: 2_000_000_000 },
        { reportDate: '2026-06-30', operatingCashFlowQuarter: 3_000_000_000 }
      ]
    } as FundamentalCompany

    const result = createStockValuationAnalysis('1.600000', quote, company, null)

    expect(result.priceCashFlowRatioTtm).toEqual({
      currentValue: 12,
      operatingCashFlowTtm: 10_000_000_000,
      reportDate: '2026-06-30',
      unavailableReason: null
    })
  })

  it('infers current market value from snapshot share count when the quote source omits it', () => {
    const quote = {
      quoteId: '1.600000',
      latest: 12,
      updatedAt: '2026-08-05T14:30:00+08:00'
    } as StockQuote
    const company = {
      organizationType: 'general',
      quarterlyRiskReports: [
        { reportDate: '2025-09-30', operatingCashFlowQuarter: 2_000_000_000 },
        { reportDate: '2025-12-31', operatingCashFlowQuarter: 3_000_000_000 },
        { reportDate: '2026-03-31', operatingCashFlowQuarter: 2_000_000_000 },
        { reportDate: '2026-06-30', operatingCashFlowQuarter: 3_000_000_000 }
      ],
      valuation: {
        closePrice: 10,
        totalMarketValue: 100_000_000_000
      }
    } as FundamentalCompany

    const result = createStockValuationAnalysis('1.600000', quote, company, null)

    expect(result.priceCashFlowRatioTtm.currentValue).toBe(12)
  })

  it('does not publish PCF when recent quarters are incomplete or cash flow is not positive', () => {
    const quote = {
      quoteId: '1.600000',
      totalMarketValue: 120_000_000_000,
      updatedAt: '2026-08-05T14:30:00+08:00'
    } as StockQuote
    const company = {
      organizationType: 'general',
      quarterlyRiskReports: [
        { reportDate: '2025-09-30', operatingCashFlowQuarter: 2_000_000_000 },
        { reportDate: '2025-12-31', operatingCashFlowQuarter: -3_000_000_000 },
        { reportDate: '2026-03-31', operatingCashFlowQuarter: -2_000_000_000 },
        { reportDate: '2026-06-30', operatingCashFlowQuarter: -3_000_000_000 }
      ]
    } as FundamentalCompany

    expect(
      createStockValuationAnalysis('1.600000', quote, company, null).priceCashFlowRatioTtm
        .unavailableReason
    ).toBe('non-positive-cash-flow')

    company.quarterlyRiskReports![2].reportDate = '2026-06-30'
    company.quarterlyRiskReports![3].reportDate = '2026-09-30'
    expect(
      createStockValuationAnalysis('1.600000', quote, company, null).priceCashFlowRatioTtm
        .unavailableReason
    ).toBe('cash-flow')
  })

  it('marks financial organizations outside ordinary corporate metric scope', () => {
    expect(usesOrdinaryCorporateInvestmentMetrics('general')).toBe(true)
    expect(usesOrdinaryCorporateInvestmentMetrics('bank')).toBe(false)
    expect(usesOrdinaryCorporateInvestmentMetrics('insurance')).toBe(false)
    expect(usesOrdinaryCorporateInvestmentMetrics('securities')).toBe(false)
  })
})
