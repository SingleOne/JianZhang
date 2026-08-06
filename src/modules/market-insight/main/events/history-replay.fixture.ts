import { DEFAULT_MARKET_INSIGHT_SETTINGS } from '../../shared/constants'
import type { IndicatorValue, MarketInsightSnapshot } from '../../shared/types'
import { replayMarketInsightHistory } from './history-replay'

function indicator(id: string, value: number, generatedAt: string): IndicatorValue {
  return {
    id,
    label: id,
    value,
    unit: 'percent',
    state: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
    calculatedAt: generatedAt,
    sourcePeriod: 'fixture'
  }
}

function snapshot(generatedAt: string, vwapDeviation: number): MarketInsightSnapshot {
  const values = [
    indicator('vwap-deviation', vwapDeviation, generatedAt),
    indicator('volume-ratio-5m', 1, generatedAt),
    indicator('intraday-position', 50, generatedAt),
    indicator('opening-range-15-high', 10.2, generatedAt),
    indicator('opening-range-15-low', 9.8, generatedAt)
  ]
  return {
    version: 2,
    quoteId: '1.600000',
    generatedAt,
    dataCutoffAt: generatedAt,
    dataState: 'live',
    indicators: {
      quoteId: '1.600000',
      quoteTime: generatedAt,
      calculatedAt: generatedAt,
      technical: [],
      intraday: values,
      trend: [],
      momentum: [],
      volatility: [],
      orderBook: [],
      relativeStrength: []
    },
    news: [],
    events: [],
    existingTPlanDistances: [],
    chartOverlay: {
      vwap: 10,
      openingRange15: { high: 10.2, low: 9.8 },
      tPlanLevels: [],
      eventMarkers: []
    }
  }
}

export const FIXED_MARKET_INSIGHT_REPLAY = [
  snapshot('2026-07-20T01:31:00.000Z', -0.1),
  snapshot('2026-07-20T01:32:00.000Z', 0.2),
  snapshot('2026-07-20T01:33:00.000Z', 0.3),
  snapshot('2026-07-20T01:34:00.000Z', -0.1),
  snapshot('2026-07-20T01:35:00.000Z', 0.1)
] as const

export const FIXED_MARKET_INSIGHT_REPLAY_EVENTS = replayMarketInsightHistory(
  FIXED_MARKET_INSIGHT_REPLAY,
  DEFAULT_MARKET_INSIGHT_SETTINGS
)
