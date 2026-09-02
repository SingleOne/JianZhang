import { describe, expect, it } from 'vitest'
import {
  addTrackingSourceTags,
  addStockTrackingEntry,
  createStockTrackingSource,
  startStockTracking,
  stopStockTracking,
  trackingProfileSourceTags
} from './stock-tracking'
import type { WatchStock } from '../shared/types'

const stock: WatchStock = {
  code: '600000',
  name: '浦发银行',
  quoteId: '1.600000',
  marketLabel: '沪A',
  showInTaskbar: false,
  isPriority: false,
  showRadarSignals: true
}

describe('stock tracking', () => {
  it('keeps multiple sources and preserves history after stopping and restarting', () => {
    const startedAt = '2026-08-08T07:10:00.000Z'
    const dailySource = createStockTrackingSource(
      'dailyScan',
      {
        tradingDate: '2026-08-08',
        signals: ['volumeSurge', 'breakout20d'],
        startPrice: 10
      },
      startedAt
    )
    let profile = startStockTracking(undefined, stock, dailySource, undefined, startedAt)
    profile = addStockTrackingEntry(
      profile,
      'note',
      '关注突破后的承接',
      undefined,
      '2026-08-09T02:00:00.000Z'
    )
    profile = startStockTracking(
      profile,
      stock,
      createStockTrackingSource(
        'dividendFinancing',
        {
          snapshotDate: '2026-08-09',
          dividendRank: 20,
          dividendRatio: 180
        },
        '2026-08-09T08:00:00.000Z'
      ),
      undefined,
      '2026-08-09T08:00:00.000Z'
    )

    const stopped = stopStockTracking(
      profile,
      'expected',
      '走势符合预期，阶段复盘完成',
      undefined,
      '2026-08-10T08:00:00.000Z'
    )
    expect(stopped.status).toBe('stopped')
    expect(stopped.sources.map((source) => source.type)).toEqual(['dividendFinancing', 'dailyScan'])
    expect(stopped.tags).toEqual(['放量异动', '20 日新高', '分红'])
    expect(stopped.entries.some((entry) => entry.content === '关注突破后的承接')).toBe(true)
    expect(stopped.conclusion?.summary).toContain('阶段复盘完成')

    const restarted = startStockTracking(
      stopped,
      stock,
      createStockTrackingSource('manual', undefined, '2026-08-11T08:00:00.000Z'),
      undefined,
      '2026-08-11T08:00:00.000Z'
    )
    expect(restarted.status).toBe('tracking')
    expect(restarted.conclusion).toBeUndefined()
    expect(restarted.entries.some((entry) => entry.content.includes('重新开始追踪'))).toBe(true)
    expect(restarted.entries.some((entry) => entry.content.includes('阶段复盘完成'))).toBe(true)
  })

  it('does not duplicate the same source snapshot', () => {
    const source = createStockTrackingSource(
      'dailyScan',
      {
        tradingDate: '2026-08-08',
        signals: ['volumeSurge']
      },
      '2026-08-08T08:00:00.000Z'
    )
    const profile = startStockTracking(undefined, stock, source, undefined, source.recordedAt)
    const repeated = startStockTracking(
      profile,
      stock,
      createStockTrackingSource(
        'dailyScan',
        {
          tradingDate: '2026-08-08',
          signals: ['volumeSurge']
        },
        '2026-08-08T09:00:00.000Z'
      ),
      undefined,
      '2026-08-08T09:00:00.000Z'
    )

    expect(repeated.sources).toHaveLength(1)
  })

  it('collects explicit source tags and can restore all available source tags', () => {
    const profile = startStockTracking(
      undefined,
      stock,
      createStockTrackingSource('fundamentalScreening', {
        snapshotDate: '2026-08-11',
        tags: ['持续高ROE通过', '现金利润质量通过', '行业杠杆水平未通过']
      }),
      undefined,
      '2026-08-11T08:00:00.000Z'
    )
    const withoutTags = { ...profile, tags: [] }

    expect(trackingProfileSourceTags(withoutTags)).toEqual([
      '持续高ROE通过',
      '现金利润质量通过',
      '行业杠杆水平未通过'
    ])
    expect(addTrackingSourceTags(withoutTags, '2026-08-11T09:00:00.000Z').tags).toEqual(
      trackingProfileSourceTags(withoutTags)
    )
  })

  it('turns technical scan signals into tracking source tags', () => {
    const profile = startStockTracking(
      undefined,
      stock,
      createStockTrackingSource('dailyScan', {
        tradingDate: '2026-08-12',
        signals: ['longUpperShadow', 'bollingerNarrowing']
      }),
      undefined,
      '2026-08-12T08:00:00.000Z'
    )

    expect(profile.tags).toEqual(['长上影线', '布林带收窄'])
  })
})
