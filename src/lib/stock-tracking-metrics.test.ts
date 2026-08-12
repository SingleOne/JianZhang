import { describe, expect, it } from 'vitest'
import type { KlineBar, StockTrackingProfile } from '../shared/types'
import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_AVERAGE_METRICS,
  STOCK_TRACKING_PRICE_RETURN_METRICS,
  STOCK_TRACKING_VOLUME_AVERAGE_METRICS,
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  calculateRealtimeVolumeRatio,
  calculateStockTrackingDailyMetrics,
  mergeStockTrackingMetricSnapshots,
  stockTrackingPriceVolumeDivergence,
  stockTrackingPriceVolumeState
} from './stock-tracking-metrics'

function bar(day: number, volume: number, close = 10): KlineBar {
  return {
    time: `2026-07-${String(day).padStart(2, '0')}`,
    open: close,
    close,
    high: close,
    low: close,
    volume,
    amount: volume * close
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
  it('calculates price, volume, moving averages, returns and volume ratios together', () => {
    const bars = Array.from({ length: 20 }, (_, index) => bar(index + 1, 100))
    bars.push(bar(21, 200, 11), bar(22, 300, 12))

    const snapshots = calculateStockTrackingDailyMetrics(
      bars,
      '2026-07-21T00:00:00.000Z',
      undefined,
      '2026-07-22T08:00:00.000Z'
    )

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].metrics).toMatchObject({
      [STOCK_TRACKING_BASE_METRICS.close]: 11,
      [STOCK_TRACKING_BASE_METRICS.volume]: 200,
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[5]]: 2,
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[10]]: 2,
      [STOCK_TRACKING_VOLUME_RATIO_METRICS[20]]: 2,
      [STOCK_TRACKING_PRICE_AVERAGE_METRICS[5]]: 10.2,
      [STOCK_TRACKING_VOLUME_AVERAGE_METRICS[5]]: 120
    })
    expect(snapshots[0].metrics[STOCK_TRACKING_BASE_METRICS.changePercent]).toBeCloseTo(10)
    expect(snapshots[0].metrics[STOCK_TRACKING_PRICE_RETURN_METRICS[5]]).toBeCloseTo(10)
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[5]]).toBeCloseTo(2.5)
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[10]]).toBeCloseTo(30 / 11)
    expect(snapshots[1].metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[20]]).toBeCloseTo(20 / 7)
    expect(stockTrackingPriceVolumeState(snapshots[1])).toBe('volumeSurgePriceRise')
  })

  it('detects three consecutive sessions of price-volume divergence', () => {
    const risingPrice = [
      bar(1, 140, 10),
      bar(2, 130, 11),
      bar(3, 120, 12),
      bar(4, 110, 13),
      bar(5, 100, 14)
    ]
    const fallingPrice = [bar(1, 100, 13), bar(2, 110, 12), bar(3, 120, 11), bar(4, 130, 10)]

    const risingSnapshots = calculateStockTrackingDailyMetrics(
      risingPrice,
      '2026-07-04T00:00:00.000Z'
    )
    const fallingSnapshot = calculateStockTrackingDailyMetrics(
      fallingPrice,
      '2026-07-04T00:00:00.000Z'
    ).at(-1)

    expect(stockTrackingPriceVolumeDivergence(risingSnapshots[0])).toBe('priceRiseVolumeFall')
    expect(stockTrackingPriceVolumeDivergence(risingSnapshots[1])).toBeNull()
    expect(stockTrackingPriceVolumeDivergence(fallingSnapshot)).toBe('priceFallVolumeRise')
  })

  it('distinguishes expanded-volume moves above 5 percent from ordinary moves', () => {
    const snapshot = (changePercent: number) => ({
      tradingDate: '2026-07-21',
      capturedAt: '2026-07-21T08:00:00.000Z',
      metrics: { changePercent, volumeRatio5d: 1.2 }
    })

    expect(stockTrackingPriceVolumeState(snapshot(5.01))).toBe('volumeSurgePriceRise')
    expect(stockTrackingPriceVolumeState(snapshot(-5.01))).toBe('volumeSurgePriceFall')
    expect(stockTrackingPriceVolumeState(snapshot(5))).toBe('volumeRisePriceRise')
    expect(stockTrackingPriceVolumeState(snapshot(-5))).toBe('volumeRisePriceFall')
  })

  it('calculates realtime volume ratio by trading progress and excludes current daily bar', () => {
    const dailyBars = [
      bar(14, 2400),
      bar(15, 2400),
      bar(16, 2400),
      bar(17, 2400),
      bar(18, 2400),
      bar(21, 24_000)
    ]
    const intradayBars = [
      { ...bar(21, 10), time: '2026-07-21 09:30' },
      { ...bar(21, 590), time: '2026-07-21 10:29' },
      { ...bar(21, 610), time: '2026-07-21 13:00' }
    ]

    const points = calculateRealtimeVolumeRatio(intradayBars, dailyBars, '2026-07-21')

    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ ratio: 1, cumulativeVolume: 10, expectedVolume: 10 })
    expect(points[1]).toMatchObject({ ratio: 1, cumulativeVolume: 600, expectedVolume: 600 })
    expect(points[2]).toMatchObject({ ratio: 1, cumulativeVolume: 1210, expectedVolume: 1210 })
  })

  it('includes auction volume and uses clock progress for sparse five-minute data', () => {
    const dailyBars = Array.from({ length: 5 }, (_, index) => bar(index + 1, 2400))
    const auctionPoints = calculateRealtimeVolumeRatio(
      [
        { ...bar(21, 20), time: '2026-07-21 09:25' },
        { ...bar(21, 0), time: '2026-07-21 09:30' }
      ],
      dailyBars,
      '2026-07-21'
    )
    const sparsePoints = calculateRealtimeVolumeRatio(
      [
        { ...bar(21, 60), time: '2026-07-21 09:35' },
        { ...bar(21, 100), time: '2026-07-21 09:45' }
      ],
      dailyBars,
      '2026-07-21'
    )

    expect(auctionPoints.map((point) => point.ratio)).toEqual([2, 2])
    expect(sparsePoints.map((point) => point.ratio)).toEqual([1, 1])
    expect(calculateRealtimeVolumeRatio([], dailyBars.slice(1), '2026-07-21')).toEqual([])
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
