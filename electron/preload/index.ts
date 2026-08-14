import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  DataSnapshotRuntimeState,
  DailyMarketScanState,
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
  getCompanyReports: (code, forceRefresh) =>
    ipcRenderer.invoke('company-reports:get', code, forceRefresh),
  generateCompanyReportSummary: (report) =>
    ipcRenderer.invoke('company-reports:summary:generate', report),
  openCompanyReport: (url) => ipcRenderer.invoke('company-reports:open', url),
  getShareholderSnapshot: (quoteId, forceRefresh) =>
    ipcRenderer.invoke('shareholders:get', quoteId, forceRefresh),
  getValuationHistory: (quoteId) => ipcRenderer.invoke('valuation-history:get', quoteId),
  refreshQuotes: () => ipcRenderer.invoke('quotes:refresh'),
  refreshQuote: (quoteId) => ipcRenderer.invoke('quotes:refresh-one', quoteId),
  refreshQuotesByIds: (quoteIds) => ipcRenderer.invoke('quotes:refresh-by-ids', quoteIds),
  getKline: (quoteId, period, limit) => ipcRenderer.invoke('kline:get', quoteId, period, limit),
  getDailyMarketScanResult: () => ipcRenderer.invoke('daily-market-scan:get'),
  getDailyMarketScanState: () => ipcRenderer.invoke('daily-market-scan:state:get'),
  runDailyMarketScan: () => ipcRenderer.invoke('daily-market-scan:run'),
  saveChipDistributionCache: (entry) => ipcRenderer.invoke('chip-distribution:cache:save', entry),
  getOrderBook: (quoteId) => ipcRenderer.invoke('order-book:get', quoteId),
  getFundsFlow: (quoteId) => ipcRenderer.invoke('funds-flow:get', quoteId),
  getSectorIndex: (quoteId) => ipcRenderer.invoke('sector-index:get', quoteId),
  refreshTradingCalendar: () => ipcRenderer.invoke('trading-calendar:refresh'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  getCompletionNotifications: () => ipcRenderer.invoke('completion-notifications:get'),
  saveCompletionNotifications: (notifications) =>
    ipcRenderer.invoke('completion-notifications:save', notifications),
  exportConfig: (state) => ipcRenderer.invoke('config:export', state),
  importConfig: () => ipcRenderer.invoke('config:import'),
  applyConfigImport: (importId) => ipcRenderer.invoke('config:import:apply', importId),
  getGitHubSyncSettings: () => ipcRenderer.invoke('github-sync:settings:get'),
  startGitHubLogin: () => ipcRenderer.invoke('github-sync:login:start'),
  completeGitHubLogin: (loginId) => ipcRenderer.invoke('github-sync:login:complete', loginId),
  listGitHubRepositories: () => ipcRenderer.invoke('github-sync:repositories:list'),
  selectGitHubRepository: (fullName) =>
    ipcRenderer.invoke('github-sync:repository:select', fullName),
  disconnectGitHub: () => ipcRenderer.invoke('github-sync:disconnect'),
  uploadUserDataToGitHub: (state) => ipcRenderer.invoke('github-sync:upload', state),
  downloadUserDataFromGitHub: () => ipcRenderer.invoke('github-sync:download'),
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
    subscribe<DataSnapshotRuntimeState>('fundamentals:state-updated', callback),
  onDailyMarketScanProgress: (callback) =>
    subscribe<DailyMarketScanState>('daily-market-scan:progress', callback)
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
