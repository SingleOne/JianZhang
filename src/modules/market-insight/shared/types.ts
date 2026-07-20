import type { KlineBar, TTradingAccount } from '../../../shared/types'

export type IndicatorUnit = 'price' | 'percent' | 'amount' | 'ratio' | 'none'
export type IndicatorState = 'up' | 'down' | 'flat' | 'unknown'
export type MarketInsightDataState = 'live' | 'cached' | 'stale'

export interface IndicatorValue {
  id: string
  label: string
  value: number | null
  unit: IndicatorUnit
  state: IndicatorState
  calculatedAt: string
  sourcePeriod: string
}

export interface IndicatorSnapshot {
  quoteId: string
  quoteTime: string
  calculatedAt: string
  intraday: IndicatorValue[]
  trend: IndicatorValue[]
  momentum: IndicatorValue[]
  volatility: IndicatorValue[]
  orderBook: IndicatorValue[]
  relativeStrength: IndicatorValue[]
}

export type MarketNewsCategory = 'announcement' | 'policy' | 'finance' | 'industry' | 'market'
export type MarketNewsScope = 'stock' | 'sector' | 'market'

export interface MarketNewsItem {
  id: string
  title: string
  source: string
  publishedAt: string
  url: string
  category: MarketNewsCategory
  scope: MarketNewsScope
  relatedQuoteIds: string[]
  fetchedAt: string
}

export type WatchEventType =
  | 'vwap_cross'
  | 'opening_range_break'
  | 'volume_spike'
  | 'intraday_extreme'
  | 'order_book_imbalance_change'
  | 'funds_flow_direction_change'
  | 'relative_strength_change'
  | 'new_announcement'

export interface WatchEvent {
  id: string
  quoteId: string
  type: WatchEventType
  severity: 'info' | 'attention'
  title: string
  facts: string[]
  occurredAt: string
  expiresAt: string
  fingerprint: string
  status: 'active' | 'acknowledged' | 'expired'
  sourceIds: string[]
}

export interface TPlanDistance {
  id: string
  label: string
  side: 'buy' | 'sell' | 'position'
  price: number
  distancePercent: number | null
  quantity: number | null
  isNearest: boolean
}

export interface MarketInsightChartOverlay {
  vwap: number | null
  openingRange15: { high: number | null; low: number | null }
  tPlanLevels: Array<{ id: string; label: string; price: number; side: 'buy' | 'sell' }>
  eventMarkers: Array<{ time: string; title: string; severity: 'info' | 'attention' }>
}

export interface MarketInsightSnapshot {
  version: 1
  quoteId: string
  generatedAt: string
  dataCutoffAt: string
  dataState: MarketInsightDataState
  indicators: IndicatorSnapshot
  news: MarketNewsItem[]
  events: WatchEvent[]
  existingTPlanDistances: TPlanDistance[]
  chartOverlay: MarketInsightChartOverlay
}

export interface MarketInsightSettings {
  enabled: boolean
  watchedQuoteIds: string[]
  showChartOverlay: boolean
  volumeSpikeRatio: number
  eventCooldownMinutes: number
  newsCacheHours: number
  includeOlderNews: boolean
}

export interface MarketInsightStatus {
  enabled: boolean
  watchedQuoteIds: string[]
  newsProviderState: 'unconfigured' | 'ready' | 'demo'
  newsMessage: string
  performance: {
    snapshotCount: number
    eventCount: number
    lastBuildMilliseconds: number | null
  }
  resourceLimits: {
    maxSnapshots: number
    maxEventsPerStock: number
  }
}

export interface MarketInsightApi {
  getStatus: () => Promise<MarketInsightStatus>
  getSettings: () => Promise<MarketInsightSettings>
  saveSettings: (settings: MarketInsightSettings) => Promise<void>
  getSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null>
  refresh: (quoteId: string) => Promise<MarketInsightSnapshot>
  listEvents: (quoteId: string) => Promise<WatchEvent[]>
  acknowledgeEvent: (eventId: string) => Promise<void>
  clearExpiredEvents: (quoteId: string) => Promise<void>
  openSource: (url: string) => Promise<void>
  onUpdated: (listener: (quoteId: string) => void) => () => void
}

export interface MarketInsightSourceData {
  quoteId: string
  quoteTime: string
  intradayBars: KlineBar[]
  dailyBars: KlineBar[]
  account?: TTradingAccount
}
