import { marketInsightDemoApi } from './demo'

export const marketInsightApi = window.marketInsightApi ?? marketInsightDemoApi
export const isDesktopMarketInsightRuntime = Boolean(window.marketInsightApi)
