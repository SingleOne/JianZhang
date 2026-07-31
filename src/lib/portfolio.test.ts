import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockQuote, TTradingAccount, TTradeRecord, WatchStock } from '../shared/types'
import {
  calculatePortfolioSummary,
  calculatePositionMetrics,
  getAvailablePositionQuantity
} from './portfolio'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '600000',
    name: '浦发银行',
    quoteId: '1.600000',
    latest: 11,
    change: 0.5,
    changePercent: 4.76,
    open: 10.5,
    high: 11.2,
    low: 10.4,
    previousClose: 10.5,
    volume: 1_000_000,
    amount: 10_000_000,
    turnoverRate: 1,
    updatedAt: '2026-07-31T07:00:00.000Z',
    ...overrides
  }
}

function account(tradeRecords: TTradeRecord[]): TTradingAccount {
  return {
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    history: [],
    tradeRecords
  }
}

describe('portfolio calculations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('calculates market value, total profit and intraday profit', () => {
    const metrics = calculatePositionMetrics(
      { quantity: 1_000, cost: 10, openedToday: false, openedOn: '2026-07-01' },
      quote()
    )

    expect(metrics.marketValue).toBe(11_000)
    expect(metrics.totalProfit).toBe(1_000)
    expect(metrics.profitPercent).toBeCloseTo(10)
    expect(metrics.todayCostBasis).toBe(10_500)
    expect(metrics.todayProfit).toBe(500)
    expect(metrics.todayProfitPercent).toBeCloseTo(4.7619)
  })

  it('preserves zero and negative profit values instead of treating them as missing', () => {
    const position = { quantity: 1_000, cost: 10, openedToday: false, openedOn: '2026-07-01' }
    const zero = calculatePositionMetrics(position, quote({ latest: 10, previousClose: 10 }))
    const loss = calculatePositionMetrics(position, quote({ latest: 9, previousClose: 10 }))

    expect(zero.totalProfit).toBe(0)
    expect(zero.profitPercent).toBe(0)
    expect(zero.todayProfit).toBe(0)
    expect(loss.totalProfit).toBe(-1_000)
    expect(loss.todayProfit).toBe(-1_000)
    expect(loss.todayProfitPercent).toBe(-10)
  })

  it('includes same-day buy fees in intraday profit and available quantity', () => {
    const buy: TTradeRecord = {
      id: 'buy-today',
      side: 'buy',
      purpose: 'base',
      tradedAt: '2026-07-31T01:30:00.000Z',
      price: 10,
      quantity: 100,
      fees: { ...EMPTY_FEES, commission: 1 },
      note: ''
    }
    const position = { quantity: 1_000, cost: 10, openedToday: false, openedOn: '2026-07-01' }
    const metrics = calculatePositionMetrics(position, quote(), account([buy]))

    expect(metrics.todayCostBasis).toBe(10_451)
    expect(metrics.todayProfit).toBe(549)
    expect(getAvailablePositionQuantity(position, account([buy]))).toBe(900)
  })

  it('uses the actual purchase cost for a position opened today', () => {
    const buy: TTradeRecord = {
      id: 'new-position',
      side: 'buy',
      purpose: 'base',
      tradedAt: '2026-07-31T01:30:00.000Z',
      price: 10,
      quantity: 100,
      fees: EMPTY_FEES,
      note: ''
    }
    const metrics = calculatePositionMetrics(
      { quantity: 100, cost: 10, openedToday: true, openedOn: '2026-07-31' },
      quote(),
      account([buy])
    )

    expect(metrics.todayCostBasis).toBe(1_000)
    expect(metrics.todayProfit).toBe(100)
    expect(
      getAvailablePositionQuantity(
        { quantity: 100, cost: 10, openedToday: true, openedOn: '2026-07-31' },
        account([buy])
      )
    ).toBe(0)
  })

  it('aggregates priced positions without losing the total position count', () => {
    const stocks: WatchStock[] = [
      {
        code: '600000',
        name: '浦发银行',
        quoteId: '1.600000',
        marketLabel: '沪A',
        showInTaskbar: false,
        isPriority: true,
        showRadarSignals: true,
        position: { quantity: 1_000, cost: 10, openedToday: false, openedOn: '2026-07-01' }
      },
      {
        code: '000001',
        name: '平安银行',
        quoteId: '0.000001',
        marketLabel: '深A',
        showInTaskbar: false,
        isPriority: true,
        showRadarSignals: true,
        position: { quantity: 100, cost: 12, openedToday: false, openedOn: '2026-07-01' }
      }
    ]

    const summary = calculatePortfolioSummary(stocks, [quote()], {})
    expect(summary.positionCount).toBe(2)
    expect(summary.costBasis).toBe(10_000)
    expect(summary.marketValue).toBe(11_000)
    expect(summary.totalProfit).toBe(1_000)
  })
})
