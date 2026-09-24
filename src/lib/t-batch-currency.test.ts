import { describe, expect, it } from 'vitest'
import type { TTrade, TTradingBatch } from '../shared/types'
import { calculateTBatchCnyMetrics } from './t-batch-currency'

const batch: TTradingBatch = {
  id: 'batch-1',
  sequence: 1,
  openedAt: '2026-09-01T00:00:00.000Z',
  direction: 'forward',
  buyLevels: [],
  sellLevels: []
}

function trade(
  id: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  fee: number,
  exchangeRate?: number
): TTrade {
  return {
    id,
    side,
    purpose: 't',
    tradedAt: '2026-09-01T00:00:00.000Z',
    price,
    quantity,
    fees: { commission: fee, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    exchangeRate,
    note: ''
  }
}

describe('T batch CNY metrics', () => {
  it('separates forward-T realized and floating return from FX contribution', () => {
    const metrics = calculateTBatchCnyMetrics(
      batch,
      [trade('buy', 'buy', 10, 100, 1, 0.9), trade('sell', 'sell', 12, 40, 1, 0.95)],
      'HK',
      11,
      1
    )
    expect(metrics.realizedProfit).toBe(94.69)
    expect(metrics.floatingProfit).toBe(119.46)
    expect(metrics.totalProfit).toBe(214.15)
    expect(metrics.priceContribution).toBe(124.2)
    expect(metrics.exchangeRateContribution).toBe(89.95)
  })

  it('handles reverse-T short exposure and historical rates', () => {
    const metrics = calculateTBatchCnyMetrics(
      { ...batch, direction: 'reverse' },
      [trade('sell', 'sell', 12, 100, 1, 0.9), trade('buy', 'buy', 10, 40, 1, 0.95)],
      'US',
      11,
      1
    )
    expect(metrics.realizedProfit).toBe(50.69)
    expect(metrics.floatingProfit).toBe(-12.54)
    expect(metrics.totalProfit).toBe(38.15)
    expect(metrics.exchangeRateContribution).toBe(-86.05)
  })

  it('keeps CNY results unknown when an opening trade has no historical rate', () => {
    const metrics = calculateTBatchCnyMetrics(
      batch,
      [trade('buy', 'buy', 10, 100, 1), trade('sell', 'sell', 12, 40, 1, 0.95)],
      'HK',
      11,
      1
    )
    expect(metrics.realizedProfit).toBeNull()
    expect(metrics.floatingProfit).toBeNull()
    expect(metrics.totalProfit).toBeNull()
    expect(metrics.missingHistoricalRate).toBe(true)
  })

  it('uses only the T allocation and its apportioned fees for a split execution', () => {
    const opening = {
      ...trade('buy', 'buy', 10, 100, 10, 1),
      allocations: [
        { purpose: 't' as const, quantity: 40, batchId: batch.id },
        { purpose: 'base' as const, quantity: 60 }
      ]
    }
    const metrics = calculateTBatchCnyMetrics(
      batch,
      [opening, trade('sell', 'sell', 12, 40, 4, 1)],
      'HK',
      null,
      null
    )
    expect(metrics.realizedProfit).toBe(72)
    expect(metrics.totalProfit).toBe(72)
    expect(metrics.exchangeRateContribution).toBe(0)
  })
})
