import type { MarketInsightSettings } from './types'
import { INTRADAY_REFRESH_MILLISECONDS } from '../../../shared/market-hours'

export const MARKET_INSIGHT_MODULE_VERSION = 1

export const MARKET_INSIGHT_IPC = {
  statusGet: 'insight:status:get',
  settingsGet: 'insight:settings:get',
  settingsSave: 'insight:settings:save',
  snapshotGet: 'insight:snapshot:get',
  refresh: 'insight:refresh',
  eventsList: 'insight:events:list',
  eventAcknowledge: 'insight:event:acknowledge',
  eventsClearExpired: 'insight:events:clear-expired',
  sourceOpen: 'insight:source:open',
  updated: 'insight:updated'
} as const

export const DEFAULT_MARKET_INSIGHT_SETTINGS: MarketInsightSettings = {
  enabled: true,
  watchedQuoteIds: [],
  showChartOverlay: true,
  volumeSpikeRatio: 2.3,
  eventCooldownMinutes: 30,
  newsCacheHours: 12,
  includeOlderNews: false
}

export const MARKET_INSIGHT_REFRESH_INTERVALS = {
  intraday: INTRADAY_REFRESH_MILLISECONDS,
  daily: 15 * 60_000,
  orderBook: 30_000,
  fundsFlow: 2 * 60_000,
  sector: 2 * 60_000,
  news: 15 * 60_000
} as const

export const MARKET_INSIGHT_RESOURCE_LIMITS = {
  maxSnapshots: 200,
  maxEventsPerStock: 200,
  maxCacheFiles: 1_200,
  cacheRetentionMilliseconds: 30 * 24 * 60 * 60_000
} as const
