import { describe, expect, it } from 'vitest'
import type { KlineBar, StockTrackingProfile } from '../shared/types'
import {
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  calculateStockTrackingVolumeRatios,
  mergeStockTrackingMetricSnapshots
} from './stock-tracking-metrics'

function bar(day: number, volume: number): KlineBar {
  return {
    time: `2026-07-${String(day).padStart(2, '0')}`,
    open: 10,
    close: 10,
    high: 10,
    low: 10,
    volume,
    amount: volume * 10
  }
}

function profile(): StockTrackingProfile {
  return {
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    marketLabel: '沪A',
    status: 'tracking',
    tags: [],
    thesis: '',
    startedAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    sources: [],
    entries: [],
    metricSnapshots: []
  }
}

describe('stock tracking metrics', () => {
  it('calculates 5-day, 10-day and 20-day volume ratios from previous trading days', () => {
    const bars = Array.from({ length: 20 }, (_, index) => bar(index + 1, 100))
    bars.push(bar(21, 200), bar(22, 300))

    const snapshots = calculateStockTrackingVolumeRatios(
      bars,
      '2026-07-21T00:00:00.000Z',
      undefined,
      '2026-07-22T08:00:00.000Z'
    )

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].metrics).toEqual({
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[5]]: 2,
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[10]]: 2,
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[20]]: 2
    })
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[5]]).toBeCloseTo(2.5)
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[10]]).toBeCloseTo(30 / 11)
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[20]]).toBeCloseTo(20 / 7)
  })

  it('updates the same date while preserving metrics added by future collectors', () => {
    const current = {
      ...profile(),
      metricSnapshots: [
        {
          tradingDate: '2026-07-21',
          capturedAt: '2026-07-21T08:00:00.000Z',
          metrics: { volumeRatio5d: 1.2, turnoverRate: 3.6 }
        }
      ]
    }
    const merged = mergeStockTrackingMetricSnapshots(current, [
      {
        tradingDate: '2026-07-21',
        capturedAt: '2026-07-21T09:00:00.000Z',
        metrics: { volumeRatio5d: 1.8, volumeRatio10d: 1.5 }
      }
    ])

    expect(merged.metricSnapshots[0]).toEqual({
      tradingDate: '2026-07-21',
      capturedAt: '2026-07-21T09:00:00.000Z',
      metrics: { volumeRatio5d: 1.8, volumeRatio10d: 1.5, turnoverRate: 3.6 }
    })
    expect(
      mergeStockTrackingMetricSnapshots(merged, [
        {
          tradingDate: '2026-07-21',
          capturedAt: '2026-07-21T10:00:00.000Z',
          metrics: { volumeRatio5d: 1.8, volumeRatio10d: 1.5 }
        }
      ])
    ).toBe(merged)
  })
})
