import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_T_TRADING_FEE_SETTINGS, type TTrade, type TTradingBatch } from '../shared/types'
import {
  applyTradeToPosition,
  calculateCostAdjustedProfit,
  calculateTBatchMetrics,
  calculateTradeFees,
  totalTradeFees
} from './t-trading'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function trade(
  id: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  fee = 0,
  purpose: 't' | 'base' = 't'
): TTrade {
  return {
    id,
    side,
    purpose,
    tradedAt: '2026-07-31T01:30:00.000Z',
    price,
    quantity,
    fees: { ...EMPTY_FEES, commission: fee },
    note: ''
  }
}

function batch(direction: 'forward' | 'reverse' = 'forward'): TTradingBatch {
  return {
    id: 'batch-1',
    sequence: 1,
    openedAt: '2026-07-31T01:30:00.000Z',
    direction,
    buyLevels: [],
    sellLevels: []
  }
}

describe('trade fees', () => {
  it('applies exchange fees and sell-side stamp duty', () => {
    const buyFees = calculateTradeFees(10_000, 'buy', DEFAULT_T_TRADING_FEE_SETTINGS, '沪A')
    const sellFees = calculateTradeFees(10_000, 'sell', DEFAULT_T_TRADING_FEE_SETTINGS, '沪A')

    expect(buyFees).toEqual({
      commission: 5.31,
      handling: 0.34,
      regulatory: 0.2,
      transfer: 0.1,
      stampDuty: 0
    })
    expect(sellFees.stampDuty).toBe(5)
    expect(totalTradeFees(sellFees)).toBe(10.95)
  })

  it('keeps the minimum commission bundle for a small trade', () => {
    const fees = calculateTradeFees(1_000, 'buy', DEFAULT_T_TRADING_FEE_SETTINGS, '沪A')
    expect(fees.commission).toBe(4.95)
    expect(totalTradeFees(fees)).toBe(5.01)
  })
})

describe('T batch metrics', () => {
  it('calculates forward-T realized and floating profit', () => {
    const metrics = calculateTBatchMetrics(
      batch(),
      [trade('buy', 'buy', 10, 100, 1), trade('sell', 'sell', 12, 40, 1)],
      11
    )

    expect(metrics.remainingQuantity).toBe(60)
    expect(metrics.remainingCostBasis).toBeCloseTo(600.6)
    expect(metrics.averageCost).toBeCloseTo(10.01)
    expect(metrics.realizedProfit).toBeCloseTo(78.6)
    expect(metrics.floatingProfit).toBeCloseTo(59.4)
  })

  it('calculates reverse-T realized and floating profit', () => {
    const metrics = calculateTBatchMetrics(
      batch('reverse'),
      [trade('sell', 'sell', 12, 100, 1), trade('buy', 'buy', 10, 40, 1)],
      11
    )

    expect(metrics.remainingQuantity).toBe(60)
    expect(metrics.averageCost).toBeCloseTo(11.99)
    expect(metrics.realizedProfit).toBeCloseTo(78.6)
    expect(metrics.floatingProfit).toBeCloseTo(59.4)
  })
})

describe('position cost changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('adds buy fees to the position cost and retains fees after a sale', () => {
    const afterBuy = applyTradeToPosition(
      { quantity: 100, cost: 10, openedToday: false, openedOn: '2026-07-01' },
      trade('buy', 'buy', 12, 100, 2, 'base')
    )
    expect(afterBuy).toMatchObject({ quantity: 200, cost: 11.01 })

    const afterSell = applyTradeToPosition(afterBuy, trade('sell', 'sell', 13, 100, 1, 'base'))
    expect(afterSell?.quantity).toBe(100)
    expect(afterSell?.cost).toBeCloseTo(9.03)
  })

  it('calculates profit represented by a lower adjusted position cost', () => {
    const result = calculateCostAdjustedProfit(
      {
        ...batch(),
        openingPosition: { quantity: 1_000, cost: 10, openedOn: '2026-07-01' }
      },
      [trade('base-buy', 'buy', 8, 100, 1, 'base'), trade('t-trade', 'sell', 12, 100, 1, 't')],
      1_100,
      9.5
    )

    expect(result).toBe(351)
  })
})
