import type { MarketInsightApi } from '../shared/types'

declare global {
  interface Window {
    marketInsightApi?: MarketInsightApi
  }
}

export type { MarketInsightApi } from '../shared/types'
