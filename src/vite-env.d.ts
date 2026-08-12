/// <reference types="vite/client" />

import type { StockDesktopApi } from './shared/types'

declare global {
  const __JIANZHANG_MARKET_INSIGHT_ENABLED__: boolean
  const __JIANZHANG_AI_MODULE_ENABLED__: boolean
  const __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__: boolean
  const __JIANZHANG_GITHUB_OAUTH_CLIENT_ID__: string

  interface Window {
    stockApi?: StockDesktopApi
  }
}

export {}
