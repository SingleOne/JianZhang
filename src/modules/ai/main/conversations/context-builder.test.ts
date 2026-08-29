import { describe, expect, it } from 'vitest'
import type {
  MarketInsightSnapshot,
  IndicatorValue,
  WatchEvent
} from '../../../market-insight/shared/types'
import type { ChipDistributionCacheEntry } from '../../../../shared/types'
import { compactShortTermSnapshot } from './context-builder'

function indicator(id: string, label: string, value: number): IndicatorValue {
  return {
    id,
    label,
    value,
    unit: 'percent',
    state: 'up',
    calculatedAt: '2026-08-07T14:30:00+08:00',
    sourcePeriod: '日 K'
  }
}

function event(type: WatchEvent['type'], title: string): WatchEvent {
  return {
    id: title,
    quoteId: '1.600000',
    type,
    severity: 'info',
    title,
    facts: [`${title}事实`],
    occurredAt: '2026-08-07T14:30:00+08:00',
    expiresAt: '2026-08-08T14:30:00+08:00',
    fingerprint: title,
    status: 'active',
    sourceIds: []
  }
}

const chipDistribution: ChipDistributionCacheEntry = {
  quoteId: '1.600000',
  name: '测试公司',
  calculatedAt: '2026-08-07T15:10:00+08:00',
  startDate: '2026-01-01',
  endDate: '2026-08-07',
  barCount: 140,
  cumulativeTurnover: 220,
  currentPrice: 12.3,
  averageCost: 11.8,
  profitPercent: 62,
  cost70: { low: 10.5, high: 12.6, concentration: 17.8 },
  cost90: { low: 9.8, high: 13.2, concentration: 28.8 },
  buckets: [{ price: 11.8, percent: 10 }]
}

function snapshot(): MarketInsightSnapshot {
  return {
    version: 2,
    quoteId: '1.600000',
    generatedAt: '2026-08-07T14:30:00+08:00',
    dataCutoffAt: '2026-08-07T14:30:00+08:00',
    dataState: 'live',
    sourceStates: [
      { id: 'intraday', label: '分时', state: 'live', dataCutoffAt: '2026-08-07T14:30:00+08:00' },
      { id: 'daily', label: '日线', state: 'cached', dataCutoffAt: '2026-08-07' },
      { id: 'orderBook', label: '盘口', state: 'live', dataCutoffAt: '2026-08-07T14:30:00+08:00' },
      { id: 'fundsFlow', label: '资金流', state: 'live', dataCutoffAt: '2026-08-07T14:30:00+08:00' }
    ],
    indicators: {
      quoteId: '1.600000',
      quoteTime: '2026-08-07T14:30:00+08:00',
      calculatedAt: '2026-08-07T14:30:00+08:00',
      technical: [indicator('technical', '日 K 技术指标', 1)],
      intraday: [indicator('intraday', '分时 VWAP 偏离', 2)],
      trend: [indicator('trend', '日 K 趋势指标', 3)],
      momentum: [indicator('momentum', '日 K 动量指标', 4)],
      volatility: [indicator('volatility', '日 K 波动指标', 5)],
      orderBook: [indicator('order-book', '盘口失衡', 6)],
      relativeStrength: [indicator('relative-strength', '即时相对强弱', 7)]
    },
    news: [
      {
        id: 'news-1',
        title: '公司公告摘要',
        source: '交易所',
        publishedAt: '2026-08-07T12:00:00+08:00',
        url: 'https://example.com/announcement',
        category: 'announcement',
        scope: 'stock',
        relatedQuoteIds: ['1.600000'],
        fetchedAt: '2026-08-07T14:00:00+08:00'
      }
    ],
    events: [event('new_announcement', '新增公告'), event('vwap_cross', '盘中穿越 VWAP')],
    existingTPlanDistances: [
      {
        id: 'plan-1',
        label: '做 T 买入档',
        side: 'buy',
        price: 12,
        distancePercent: -2.4,
        quantity: 100,
        isNearest: true
      }
    ],
    chartOverlay: {
      vwap: 12.1,
      openingRange15: { high: 12.4, low: 11.9 },
      tPlanLevels: [{ id: 'plan-1', label: '做 T 买入档', price: 12, side: 'buy' }],
      eventMarkers: []
    }
  }
}

describe('compactShortTermSnapshot', () => {
  it('keeps daily indicators, announcements and chip distribution while excluding instant trading data', () => {
    const compact = compactShortTermSnapshot(snapshot(), chipDistribution)

    expect(compact.indicators.map((item) => item.group)).toEqual([
      'technical',
      'trend',
      'momentum',
      'volatility'
    ])
    expect(compact.indicators.map((item) => item.name)).not.toContain('分时 VWAP 偏离')
    expect(compact.indicators.map((item) => item.name)).not.toContain('盘口失衡')
    expect(compact.indicators.map((item) => item.name)).not.toContain('即时相对强弱')
    expect(compact.events.map((item) => item.title)).toEqual(['新增公告'])
    expect(compact.chipDistribution).toEqual(chipDistribution)
    expect(compact.dataCutoffAt).toBe('2026-08-07')
    expect(compact.dataState).toBe('cached')
  })

  it('keeps the cache identity stable when only intraday data changes', () => {
    const original = snapshot()
    const refreshed: MarketInsightSnapshot = {
      ...original,
      generatedAt: '2026-08-07T14:31:00+08:00',
      dataCutoffAt: '2026-08-07T14:31:00+08:00',
      indicators: {
        ...original.indicators,
        quoteTime: '2026-08-07T14:31:00+08:00',
        calculatedAt: '2026-08-07T14:31:00+08:00',
        intraday: [indicator('intraday', '分时 VWAP 偏离', 9)],
        orderBook: [indicator('order-book', '盘口失衡', 10)],
        relativeStrength: [indicator('relative-strength', '即时相对强弱', 11)]
      },
      events: [
        event('new_announcement', '新增公告'),
        event('opening_range_break', '盘中突破开盘区间')
      ],
      chartOverlay: {
        ...original.chartOverlay,
        vwap: 12.2,
        openingRange15: { high: 12.5, low: 12 }
      }
    }

    expect(compactShortTermSnapshot(refreshed, chipDistribution).snapshotId).toBe(
      compactShortTermSnapshot(original, chipDistribution).snapshotId
    )
  })
})
