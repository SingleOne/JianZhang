import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  DataSnapshotRuntimeState,
  DividendFinancingUpdateProgress,
  FundamentalUpdateProgress,
  StockDesktopApi,
  StockQuote,
  TaskbarLayout
} from '../../src/shared/types'
import { installMarketInsightPreload } from '../../src/modules/market-insight/preload/register'
import { installAiPreload } from '../../src/modules/ai/preload/register'
import { installAiTAdvicePreload } from '../../src/modules/ai-t-advice/preload/register'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StockDesktopApi = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  getTaskbarLayout: () => ipcRenderer.invoke('taskbar:layout:get'),
  searchStocks: (query) => ipcRenderer.invoke('stocks:search', query),
  getDividendFinancingSnapshot: () => ipcRenderer.invoke('dividend-financing:get'),
  getDividendFinancingState: () => ipcRenderer.invoke('dividend-financing:state:get'),
  getDividendFinancingChangeReport: () => ipcRenderer.invoke('dividend-financing:changes:get'),
  runDividendFinancingUpdate: () => ipcRenderer.invoke('dividend-financing:update'),
  getFundamentalSnapshot: () => ipcRenderer.invoke('fundamentals:get'),
  getFundamentalState: () => ipcRenderer.invoke('fundamentals:state:get'),
  getFundamentalChangeReport: () => ipcRenderer.invoke('fundamentals:changes:get'),
  runFundamentalUpdate: () => ipcRenderer.invoke('fundamentals:update'),
  getValuationHistory: (quoteId) => ipcRenderer.invoke('valuation-history:get', quoteId),
  refreshQuotes: () => ipcRenderer.invoke('quotes:refresh'),
  getKline: (quoteId, period, limit) => ipcRenderer.invoke('kline:get', quoteId, period, limit),
  saveChipDistributionCache: (entry) => ipcRenderer.invoke('chip-distribution:cache:save', entry),
  getOrderBook: (quoteId) => ipcRenderer.invoke('order-book:get', quoteId),
  getFundsFlow: (quoteId) => ipcRenderer.invoke('funds-flow:get', quoteId),
  getSectorIndex: (quoteId) => ipcRenderer.invoke('sector-index:get', quoteId),
  refreshTradingCalendar: () => ipcRenderer.invoke('trading-calendar:refresh'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  exportConfig: (state) => ipcRenderer.invoke('config:export', state),
  importConfig: () => ipcRenderer.invoke('config:import'),
  hideWindow: () => ipcRenderer.invoke('app:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onQuotesUpdated: (callback) => subscribe<StockQuote[]>('quotes:updated', callback),
  onStateUpdated: (callback) => subscribe<AppState>('state:updated', callback),
  onTaskbarLayout: (callback) => subscribe<TaskbarLayout>('taskbar:layout', callback),
  onSelectStock: (callback) => subscribe<string>('stock:selected', callback),
  onDataError: (callback) => subscribe<string>('data:error', callback),
  onDividendFinancingUpdateProgress: (callback) =>
    subscribe<DividendFinancingUpdateProgress>('dividend-financing:update-progress', callback),
  onDividendFinancingStateUpdated: (callback) =>
    subscribe<DataSnapshotRuntimeState>('dividend-financing:state-updated', callback),
  onFundamentalUpdateProgress: (callback) =>
    subscribe<FundamentalUpdateProgress>('fundamentals:update-progress', callback),
  onFundamentalStateUpdated: (callback) =>
    subscribe<DataSnapshotRuntimeState>('fundamentals:state-updated', callback)
}

contextBridge.exposeInMainWorld('stockApi', api)

if (__JIANZHANG_MARKET_INSIGHT_ENABLED__) {
  installMarketInsightPreload()
}

if (__JIANZHANG_AI_MODULE_ENABLED__) {
  installAiPreload()

  if (__JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__) {
    installAiTAdvicePreload()
  }
}
