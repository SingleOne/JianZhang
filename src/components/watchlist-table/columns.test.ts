import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FundamentalScreeningEvaluation } from '../../lib/fundamental-screening'
import type { PositionMetrics } from '../../lib/portfolio'
import type { StockQuote, WatchStock } from '../../shared/types'
import {
  calculatePreviousCloseDividendYield,
  calculateSinceAddedPerformance,
  sortRows,
  sortValue,
  type StockRowData
} from './columns'

const EMPTY_METRICS: PositionMetrics = {
  currency: 'CNY',
  exchangeRate: 1,
  costExchangeRate: 1,
  marketValue: null,
  todayProfit: null,
  todayProfitPercent: null,
  todayCostBasis: null,
  holdingCost: null,
  holdingCostBasis: null,
  totalProfit: null,
  profitPercent: null,
  cnyMarketValue: null,
  cnyTodayProfit: null,
  cnyTodayCostBasis: null,
  cnyCostBasis: null,
  cnyHoldingCostBasis: null,
  cnyTotalProfit: null,
  cnyProfitPercent: null
}

function stock(quoteId: string, name: string): WatchStock {
  return {
    quoteId,
    code: quoteId,
    name,
    marketLabel: '测试',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true
  }
}

function quote(quoteId: string, latest: number | null): StockQuote {
  return {
    quoteId,
    code: quoteId,
    name: quoteId,
    latest,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    volume: null,
    amount: null,
    turnoverRate: null,
    updatedAt: '2026-07-31 10:00:00'
  }
}

function row(
  quoteId: string,
  name: string,
  latest: number | null,
  manualIndex: number,
  metrics: Partial<PositionMetrics> = {}
): StockRowData {
  return {
    stock: stock(quoteId, name),
    quote: quote(quoteId, latest),
    dividendFinancing: undefined,
    fundamentalScreening: undefined,
    fundamentalPeerComparison: undefined,
    metrics: { ...EMPTY_METRICS, ...metrics },
    manualIndex
  }
}

function screeningEvaluation({
  roe = true,
  cash = true,
  debt = true,
  missingRoe = false,
  financial = false
}: {
  roe?: boolean
  cash?: boolean
  debt?: boolean
  missingRoe?: boolean
  financial?: boolean
} = {}): FundamentalScreeningEvaluation {
  const checks = { roe, cash, debt }
  return {
    eligibleOrganization: !financial,
    roeValues: missingRoe ? [18, 18, null, 18, 18] : [18, 18, 18, 18, 18],
    cumulativeNetProfit: 500,
    cumulativeOperatingCashFlow: 600,
    checks,
    passed: !financial && !missingRoe && Object.values(checks).every(Boolean),
    company: {
      organizationType: financial ? 'bank' : 'general',
      latestBalanceSheet: { industryPercentile: debt ? 40 : 70 }
    }
  } as FundamentalScreeningEvaluation
}

describe('watchlist column sorting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T10:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('sorts numeric columns and keeps missing values at the end', () => {
    const rows = [
      row('missing', 'Missing', null, 0),
      row('low', 'Low', 10, 1),
      row('high', 'High', 20, 2)
    ]

    expect(
      sortRows(rows, { column: 'latest', direction: 'desc' }, []).map(({ stock }) => stock.quoteId)
    ).toEqual(['high', 'low', 'missing'])
  })

  it('uses manual order as the fallback when both values are missing', () => {
    const rows = [
      row('second', 'Second', null, 2),
      row('first', 'First', null, 0),
      row('middle', 'Middle', null, 1)
    ]

    expect(
      sortRows(rows, { column: 'latest', direction: 'asc' }, []).map(({ stock }) => stock.quoteId)
    ).toEqual(['first', 'middle', 'second'])
  })

  it('sorts derived position metrics without changing the input array', () => {
    const rows = [
      row('loss', 'Loss', 10, 0, { totalProfit: -200 }),
      row('profit', 'Profit', 10, 1, { totalProfit: 500 })
    ]

    const sorted = sortRows(rows, { column: 'totalProfit', direction: 'desc' }, [])

    expect(sorted.map(({ stock }) => stock.quoteId)).toEqual(['profit', 'loss'])
    expect(rows.map(({ stock }) => stock.quoteId)).toEqual(['loss', 'profit'])
  })

  it('sorts the dividend financing ratio and leaves stocks outside the snapshot last', () => {
    const missing = row('missing', 'Missing', 10, 0)
    const lower = row('lower', 'Lower', 10, 1)
    lower.dividendFinancing = {
      rank: 20,
      code: 'lower',
      name: 'Lower',
      market: 'SH',
      dividendYi: 20,
      financingYi: 10,
      ratio: 200
    }
    const higher = row('higher', 'Higher', 10, 2)
    higher.dividendFinancing = {
      ...lower.dividendFinancing,
      rank: 10,
      code: 'higher',
      name: 'Higher',
      ratio: 500
    }

    expect(
      sortRows(
        [missing, lower, higher],
        { column: 'dividendFinancingRatio', direction: 'desc' },
        []
      ).map(({ stock }) => stock.quoteId)
    ).toEqual(['higher', 'lower', 'missing'])
  })

  it('sorts by the displayed dividend yield and keeps missing values last', () => {
    const missing = row('missing', 'Missing', 10, 0)
    const lower = row('lower', 'Lower', 10, 1)
    const higher = row('higher', 'Higher', 10, 2)
    for (const item of [lower, higher]) {
      item.quote = {
        ...item.quote!,
        previousClose: 10,
        totalMarketValue: 1_000_000_000
      }
    }
    lower.dividendFinancing = {
      rank: 1,
      code: 'lower',
      name: 'Lower',
      market: 'SH',
      dividendYi: 20,
      financingYi: 4,
      ratio: 500,
      lastDividendYear: 2025,
      annualDividends: [{ year: 2025, amountYi: 0.5, eventCount: 1 }]
    }
    higher.dividendFinancing = {
      ...lower.dividendFinancing,
      rank: 2,
      code: 'higher',
      name: 'Higher',
      ratio: 200,
      annualDividends: [{ year: 2025, amountYi: 1, eventCount: 1 }]
    }

    expect(
      sortRows(
        [missing, lower, higher],
        {
          column: 'dividendFinancingRatio',
          direction: 'desc',
          dividendFinancingMetric: 'yield'
        },
        []
      ).map(({ stock }) => stock.quoteId)
    ).toEqual(['higher', 'lower', 'missing'])
  })

  it('calculates price performance from the recorded add price', () => {
    const added = stock('added', 'Added')
    added.addedAt = '2026-07-01T02:00:00.000Z'
    added.addedPrice = 8

    expect(calculateSinceAddedPerformance(added, quote('added', 10))).toEqual({
      change: 2,
      changePercent: 25
    })
    expect(
      calculateSinceAddedPerformance(stock('legacy', 'Legacy'), quote('legacy', 10))
    ).toBeNull()
  })

  it('calculates the last annual dividend yield from previous close', () => {
    const currentQuote = quote('yield', 10)
    currentQuote.previousClose = 8
    currentQuote.totalMarketValue = 10_000_000_000

    expect(
      calculatePreviousCloseDividendYield(
        {
          rank: 1,
          code: 'yield',
          name: 'Yield',
          market: 'SH',
          dividendYi: 10,
          financingYi: 5,
          ratio: 200,
          lastDividendYear: 2025,
          annualDividends: [{ year: 2025, amountYi: 2, eventCount: 1 }]
        },
        currentQuote
      )
    ).toEqual({
      dividendPerShare: 0.2,
      dividendYear: 2025,
      yieldPercent: 2.5
    })
  })

  it('sorts value tags by the number of passed screening badges', () => {
    const none = row('none', 'None', 10, 0)
    const dividend = row('dividend', 'Dividend', 10, 1)
    dividend.dividendFinancing = {
      rank: 1,
      code: 'dividend',
      name: 'Dividend',
      market: 'SH',
      dividendYi: 20,
      financingYi: 10,
      ratio: 200
    }
    const both = row('both', 'Both', 10, 2)
    both.dividendFinancing = dividend.dividendFinancing
    both.fundamentalScreening = screeningEvaluation()

    expect(
      sortRows([none, dividend, both], { column: 'valueTags', direction: 'desc' }, []).map(
        ({ stock }) => stock.quoteId
      )
    ).toEqual(['both', 'dividend', 'none'])
  })

  it('keeps manual order among stocks with the same positive value-label count', () => {
    const passed = row('passed', 'Passed', 10, 0)
    passed.fundamentalScreening = screeningEvaluation()
    const oneReview = row('one-review', 'One review', 10, 1)
    oneReview.fundamentalScreening = screeningEvaluation({ debt: false })
    const twoReviews = row('two-reviews', 'Two reviews', 10, 2)
    twoReviews.fundamentalScreening = screeningEvaluation({ roe: false, cash: false })
    const financial = row('financial', 'Financial', 10, 3)
    financial.fundamentalScreening = screeningEvaluation({ financial: true })
    const missing = row('missing', 'Missing', 10, 4)
    missing.fundamentalScreening = screeningEvaluation({ roe: false, missingRoe: true })
    const unavailable = row('unavailable', 'Unavailable', 10, 5)

    expect(
      sortRows(
        [missing, twoReviews, unavailable, passed, financial, oneReview],
        { column: 'valueTags', direction: 'desc' },
        []
      ).map(({ stock }) => stock.quoteId)
    ).toEqual(['passed', 'one-review', 'two-reviews', 'financial', 'missing', 'unavailable'])
  })

  it('uses only current-day radar signals as the radar sort value', () => {
    const current = row('current', 'Current', 10, 0)
    current.quote!.radarSignals = [
      {
        type: '8201',
        label: '快速拉升',
        date: '20260731',
        time: '10:00',
        info: '',
        direction: 'up'
      }
    ]
    const historical = row('historical', 'Historical', 10, 1)
    historical.quote!.radarSignals = [
      {
        type: '8201',
        label: '快速拉升',
        date: '20260730',
        time: '10:00',
        info: '',
        direction: 'up'
      }
    ]

    expect(sortValue(current, 'radar', [])).toBe('20260731 10:00')
    expect(sortValue(historical, 'radar', [])).toBeNull()
  })
})
