import { describe, expect, it } from 'vitest'
import type { KlineBar, StockTrackingProfile } from '../shared/types'
import { calculateStockTrackingPerformance } from './stock-tracking-performance'

function bar(time: string, close: number, high: number, low: number): KlineBar {
  return { time, open: close, close, high, low, volume: 1, amount: 1 }
}

function profile(startPrice?: number): StockTrackingProfile {
  return {
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    marketLabel: '沪A',
    status: 'tracking',
    tags: [],
    thesis: '',
    startedAt: '2026-01-02T01:30:00.000Z',
    updatedAt: '2026-01-02T01:30:00.000Z',
    sources: [
      {
        id: 'source-1',
        type: 'manual',
        recordedAt: '2026-01-02T01:30:00.000Z',
        detail: startPrice === undefined ? undefined : { startPrice }
      }
    ],
    entries: [],
    metricSnapshots: []
  }
}

describe('stock tracking performance', () => {
  it('calculates return, maximum gain and drawdown over the tracking interval', () => {
    const performance = calculateStockTrackingPerformance(profile(10), undefined, [
      bar('2026-01-01', 90, 100, 80),
      bar('2026-01-02', 11, 12, 9.5),
      bar('2026-01-03', 14, 15, 12),
      bar('2026-01-04', 13, 14, 10)
    ])

    expect(performance.trackingReturn).toBeCloseTo(30)
    expect(performance.maximumGain).toBeCloseTo(50)
    expect(performance.maximumDrawdown).toBeCloseTo(-33.333333)
  })

  it('uses the first tracked close when an old profile has no captured start price', () => {
    const performance = calculateStockTrackingPerformance(profile(), undefined, [
      bar('2026-01-02', 8, 8.5, 7.5),
      bar('2026-01-03', 10, 11, 9)
    ])

    expect(performance.trackingReturn).toBeCloseTo(25)
    expect(performance.maximumGain).toBeCloseTo(37.5)
    expect(performance.maximumDrawdown).toBeCloseTo(-18.181818)
  })
})
