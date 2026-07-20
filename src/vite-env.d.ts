/// <reference types="vite/client" />

import type { StockDesktopApi } from './shared/types'
import type { MarketInsightApi } from './modules/market-insight/shared/types'

declare global {
  const __JIANZHANG_MARKET_INSIGHT_ENABLED__: boolean

  interface Window {
    stockApi?: StockDesktopApi
    marketInsightApi?: MarketInsightApi
  }
}

export {}
