import { DEFAULT_MARKET_INSIGHT_SETTINGS } from './constants'
import type { MarketInsightSettings } from './types'

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function normalizeMarketInsightSettings(input: Partial<MarketInsightSettings> | undefined): MarketInsightSettings {
  const watchedQuoteIds = Array.isArray(input?.watchedQuoteIds)
    ? [...new Set(input.watchedQuoteIds.filter((quoteId): quoteId is string => typeof quoteId === 'string' && quoteId.length > 0))]
    : []
  return {
    enabled: input?.enabled !== false,
    watchedQuoteIds,
    showChartOverlay: input?.showChartOverlay !== false,
    volumeSpikeRatio: positiveNumber(input?.volumeSpikeRatio, DEFAULT_MARKET_INSIGHT_SETTINGS.volumeSpikeRatio),
    eventCooldownMinutes: positiveNumber(input?.eventCooldownMinutes, DEFAULT_MARKET_INSIGHT_SETTINGS.eventCooldownMinutes),
    newsCacheHours: positiveNumber(input?.newsCacheHours, DEFAULT_MARKET_INSIGHT_SETTINGS.newsCacheHours),
    includeOlderNews: input?.includeOlderNews === true
  }
}
