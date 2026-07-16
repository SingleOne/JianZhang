/// <reference types="vite/client" />

import type { StockDesktopApi } from './shared/types'

declare global {
  interface Window {
    stockApi?: StockDesktopApi
  }
}

export {}
