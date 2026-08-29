import type { FundsFlowResult, KlineBar, StockOrderBook, StockQuote } from '../../../shared/types'
import { calculateIntradayIndicators } from '../main/indicators/intraday'
import { calculateMomentumIndicators } from '../main/indicators/momentum'
import { calculateOrderBookIndicators } from '../main/indicators/order-book'
import { calculateRelativeStrengthIndicators } from '../main/indicators/relative-strength'
import { calculateShortTermTechnicalIndicators } from '../main/indicators/technical'
import { calculateTrendIndicators } from '../main/indicators/trend'
import { calculateVolatilityIndicators } from '../main/indicators/volatility'
import { detectWatchEvents } from '../main/events/detect'
import { reconcileWatchEvents } from '../main/events/lifecycle'
import {
  DEFAULT_MARKET_INSIGHT_SETTINGS,
  MARKET_INSIGHT_MODULE_VERSION,
  MARKET_INSIGHT_RESOURCE_LIMITS
} from '../shared/constants'
import type {
  MarketInsightApi,
  MarketInsightSettings,
  MarketInsightSnapshot,
  MarketInsightStatus,
  WatchEvent
} from '../shared/types'

const DEMO_TIME = '2026-07-20T06:30:00.000Z'
const listeners = new Set<(quoteId: string) => void>()
const snapshots = new Map<string, MarketInsightSnapshot>()
let settings: MarketInsightSettings = {
  ...DEFAULT_MARKET_INSIGHT_SETTINGS,
  watchedQuoteIds: ['1.600519']
}

function quoteSeed(quoteId: string): number {
  return [...quoteId].reduce((total, character) => total + character.charCodeAt(0), 0)
}

function fixedDailyBars(quoteId: string): KlineBar[] {
  const seed = quoteSeed(quoteId)
  const base = 12 + (seed % 80)
  return Array.from({ length: 100 }, (_, index) => {
    const price = base + Math.sin(index / 5 + seed) * 1.8 + index * 0.035
    const open = price - Math.sin(index * 1.7) * 0.28
    const close = price + Math.cos(index * 1.3) * 0.32
    const date = new Date(Date.UTC(2026, 2, 1 + index)).toISOString().slice(0, 10)
    const volume = 80_000 + (index % 13) * 9_000 + (seed % 7) * 1_200
    return {
      time: date,
      open,
      close,
      high: Math.max(open, close) + 0.42,
      low: Math.min(open, close) - 0.38,
      volume,
      amount: close * volume * 100,
      turnoverRate: 0.7 + (index % 11) * 0.08
    }
  })
}

function fixedIntradayBars(quoteId: string): KlineBar[] {
  const seed = quoteSeed(quoteId)
  const base = 12 + (seed % 80) + 3.2
  const minutes = [
    ...Array.from({ length: 121 }, (_, index) => 9 * 60 + 30 + index),
    ...Array.from({ length: 121 }, (_, index) => 13 * 60 + index)
  ]
  return minutes.map((minute, index) => {
    const hour = Math.floor(minute / 60)
    const minutePart = minute % 60
    const close = base + Math.sin(index / 16) * 0.48 + index * 0.004
    const open = close - Math.cos(index / 4) * 0.07
    const volume = 2_100 + (index % 9) * 310 + (index > 225 ? 6_800 : 0)
    return {
      time: `2026-07-20 ${String(hour).padStart(2, '0')}:${String(minutePart).padStart(2, '0')}`,
      open,
      close,
      high: Math.max(open, close) + 0.08,
      low: Math.min(open, close) - 0.07,
      volume,
      amount: close * volume * 100
    }
  })
}

function createSnapshot(quoteId: string): MarketInsightSnapshot {
  const dailyBars = fixedDailyBars(quoteId)
  const intradayBars = fixedIntradayBars(quoteId)
  const latest = intradayBars.at(-1)?.close ?? null
  const quote: StockQuote = {
    quoteId,
    code: quoteId.split('.').at(-1) ?? quoteId,
    name: '演示股票',
    latest,
    change: 0.28,
    changePercent: 1.16,
    open: intradayBars[0].open,
    high: Math.max(...intradayBars.map((bar) => bar.high)),
    low: Math.min(...intradayBars.map((bar) => bar.low)),
    previousClose: intradayBars[0].open,
    volume: intradayBars.reduce((total, bar) => total + bar.volume, 0),
    amount: intradayBars.reduce((total, bar) => total + bar.amount, 0),
    turnoverRate: 1.2,
    sector: { code: 'BK0475', name: '演示行业', quoteId: '90.BK0475', changePercent: 0.42 },
    updatedAt: DEMO_TIME
  }
  const orderBook: StockOrderBook = {
    quoteId,
    name: quote.name,
    latest,
    previousClose: quote.previousClose,
    bids: Array.from({ length: 5 }, (_, index) => ({
      price: (latest ?? 0) - (index + 1) * 0.01,
      volume: 6_500 - index * 550
    })),
    asks: Array.from({ length: 5 }, (_, index) => ({
      price: (latest ?? 0) + (index + 1) * 0.01,
      volume: 3_400 + index * 430
    })),
    updatedAt: DEMO_TIME
  }
  const fundsFlow: FundsFlowResult = {
    quoteId,
    name: quote.name,
    tradingDate: '2026-07-20',
    points: Array.from({ length: 10 }, (_, index) => ({
      time: intradayBars[index * 20]?.time ?? DEMO_TIME,
      main: -800_000 + index * 270_000,
      superLarge: -520_000 + index * 180_000,
      large: -280_000 + index * 90_000,
      medium: 120_000 - index * 20_000,
      small: 200_000 - index * 18_000
    }))
  }
  const intraday = calculateIntradayIndicators(intradayBars, latest, DEMO_TIME)
  const orderBookResult = calculateOrderBookIndicators(orderBook, DEMO_TIME)
  const relative = calculateRelativeStrengthIndicators({ quote, fundsFlow }, DEMO_TIME)
  const distances = [
    {
      id: 'position-cost',
      label: 'T 仓均价',
      side: 'position' as const,
      price: (latest ?? 0) * 0.992,
      distancePercent: 0.81,
      quantity: 1_000,
      isNearest: false
    },
    {
      id: 'buy-1',
      label: 'T1 买入档',
      side: 'buy' as const,
      price: (latest ?? 0) * 0.996,
      distancePercent: 0.4,
      quantity: 100,
      isNearest: true
    },
    {
      id: 'sell-1',
      label: 'T1 卖出档',
      side: 'sell' as const,
      price: (latest ?? 0) * 1.012,
      distancePercent: -1.19,
      quantity: 100,
      isNearest: false
    }
  ]
  const snapshot: MarketInsightSnapshot = {
    version: MARKET_INSIGHT_MODULE_VERSION,
    quoteId,
    generatedAt: DEMO_TIME,
    dataCutoffAt: intradayBars.at(-1)?.time ?? DEMO_TIME,
    dataState: 'live',
    indicators: {
      quoteId,
      quoteTime: DEMO_TIME,
      calculatedAt: DEMO_TIME,
      technical: calculateShortTermTechnicalIndicators(dailyBars, DEMO_TIME),
      intraday: intraday.values,
      trend: calculateTrendIndicators(dailyBars, DEMO_TIME),
      momentum: calculateMomentumIndicators(dailyBars, DEMO_TIME),
      volatility: calculateVolatilityIndicators(dailyBars, DEMO_TIME),
      orderBook: orderBookResult.values,
      relativeStrength: relative.values
    },
    news: [
      {
        id: `${quoteId}:demo-announcement`,
        title: '演示公告：固定新闻条目仅用于浏览器预览',
        source: '见涨演示数据',
        publishedAt: '2026-07-20T05:20:00.000Z',
        url: 'https://example.com/jianzhang-demo/announcement',
        category: 'announcement',
        scope: 'stock',
        relatedQuoteIds: [quoteId],
        fetchedAt: DEMO_TIME
      },
      {
        id: `${quoteId}:demo-exchange-notice`,
        title: '演示交易所通知：全市场通知独立于当前股票公告展示',
        source: '上海证券交易所',
        publishedAt: '2026-07-20T05:00:00.000Z',
        url: 'https://example.com/jianzhang-demo/exchange-notice',
        category: 'announcement',
        scope: 'market',
        relatedQuoteIds: [],
        fetchedAt: DEMO_TIME
      },
      {
        id: `${quoteId}:demo-market`,
        title: '演示市场快讯：原始链接仅作固定 Fixture 展示',
        source: '见涨演示数据',
        publishedAt: '2026-07-20T04:40:00.000Z',
        url: 'https://example.com/jianzhang-demo/market',
        category: 'market',
        scope: 'market',
        relatedQuoteIds: [],
        fetchedAt: DEMO_TIME
      }
    ],
    events: [],
    existingTPlanDistances: distances,
    chartOverlay: {
      vwap: intraday.vwap,
      openingRange15: intraday.openingRange15,
      tPlanLevels: distances
        .filter((item) => item.side !== 'position')
        .map((item) => ({
          id: item.id,
          label: item.label,
          price: item.price,
          side: item.side as 'buy' | 'sell'
        })),
      eventMarkers: []
    }
  }
  const previous = {
    ...snapshot,
    indicators: {
      ...snapshot.indicators,
      intraday: snapshot.indicators.intraday.map((item) =>
        item.id === 'vwap-deviation' ? { ...item, value: -0.2, state: 'down' as const } : item
      )
    }
  }
  const detection = detectWatchEvents(previous, snapshot, settings)
  const events = reconcileWatchEvents(
    [],
    detection.drafts,
    settings.eventCooldownMinutes,
    DEMO_TIME,
    detection.activeContinuousFingerprints
  )
  return {
    ...snapshot,
    events,
    chartOverlay: {
      ...snapshot.chartOverlay,
      eventMarkers: events.map((event) => ({
        time: intradayBars.at(-1)?.time ?? DEMO_TIME,
        title: event.title,
        severity: event.severity
      }))
    }
  }
}

export const marketInsightDemoApi: MarketInsightApi = {
  async getStatus(): Promise<MarketInsightStatus> {
    return {
      enabled: settings.enabled,
      watchedQuoteIds: settings.watchedQuoteIds,
      newsProviderState: 'demo',
      newsMessage: '浏览器预览正在使用固定 K 线、新闻与事件 Fixture。',
      performance: {
        snapshotCount: snapshots.size,
        eventCount: [...snapshots.values()].reduce(
          (total, snapshot) => total + snapshot.events.length,
          0
        ),
        lastBuildMilliseconds: 0
      },
      resourceLimits: {
        maxSnapshots: MARKET_INSIGHT_RESOURCE_LIMITS.maxSnapshots,
        maxEventsPerStock: MARKET_INSIGHT_RESOURCE_LIMITS.maxEventsPerStock
      }
    }
  },
  async getSettings() {
    return settings
  },
  async saveSettings(nextSettings) {
    settings = { ...nextSettings, watchedQuoteIds: [...new Set(nextSettings.watchedQuoteIds)] }
  },
  async getSnapshot(quoteId) {
    return snapshots.get(quoteId) ?? null
  },
  async refresh(quoteId) {
    const snapshot = createSnapshot(quoteId)
    snapshots.set(quoteId, snapshot)
    for (const listener of listeners) listener(quoteId)
    return snapshot
  },
  async listEvents(quoteId) {
    return snapshots.get(quoteId)?.events ?? []
  },
  async acknowledgeEvent(eventId) {
    for (const [quoteId, snapshot] of snapshots) {
      const events: WatchEvent[] = snapshot.events.map((event) =>
        event.id === eventId && event.status === 'active'
          ? { ...event, status: 'acknowledged' }
          : event
      )
      snapshots.set(quoteId, { ...snapshot, events })
      if (events.some((event) => event.id === eventId))
        for (const listener of listeners) listener(quoteId)
    }
  },
  async clearExpiredEvents(quoteId) {
    const snapshot = snapshots.get(quoteId)
    if (!snapshot) return
    snapshots.set(quoteId, {
      ...snapshot,
      events: snapshot.events.filter((event) => event.status !== 'expired')
    })
  },
  async openSource(url) {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  onUpdated(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
