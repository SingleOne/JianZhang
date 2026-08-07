import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyTAlertTriggersToAccounts,
  type TriggeredTFloatingProfitAlert
} from '../../src/lib/t-alerts'
import { applyStockAlertTriggers, type TriggeredStockAlert } from '../../src/lib/stock-alerts'
import { createConfigDocument, parseConfigDocument } from '../../src/shared/config'
import type {
  AppState,
  ChipDistributionCacheEntry,
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportSummary,
  DataSnapshotRuntimeState,
  DailyMarketScanResult,
  DailyMarketScanState,
  DividendFinancingChangeReport,
  DividendFinancingSnapshot,
  DividendFinancingUpdateResult,
  FundamentalChangeReport,
  FundamentalSnapshot,
  FundamentalUpdateResult,
  FundsFlowResult,
  KlinePeriod,
  KlineResult,
  SearchResult,
  SectorIndexResult,
  StockOrderBook,
  StockQuote,
  StockValuationHistory,
  TaskbarLayout,
  TradingCalendarSettings
} from '../../src/shared/types'

interface IpcHandlerDependencies {
  getState: () => AppState
  setState: (state: AppState) => void
  normalizeState: (state: AppState) => AppState
  persistState: () => void
  getQuotes: () => StockQuote[]
  getStartupWarning: () => string | undefined
  getTaskbarLayout: () => TaskbarLayout
  getMainWindow: () => BrowserWindow | null
  searchStocks: (query: string) => Promise<SearchResult[]>
  getDividendFinancingSnapshot: () => DividendFinancingSnapshot | null
  getDividendFinancingState: () => DataSnapshotRuntimeState
  getDividendFinancingChangeReport: () => DividendFinancingChangeReport | null
  runDividendFinancingUpdate: () => Promise<DividendFinancingUpdateResult>
  getFundamentalSnapshot: () => FundamentalSnapshot | null
  getFundamentalState: () => DataSnapshotRuntimeState
  getFundamentalChangeReport: () => FundamentalChangeReport | null
  runFundamentalUpdate: () => Promise<FundamentalUpdateResult>
  getCompanyReports: (code: string, forceRefresh?: boolean) => Promise<CompanyReportLibraryResult>
  generateCompanyReportSummary: (report: CompanyReportItem) => Promise<CompanyReportSummary>
  openCompanyReport: (url: string) => Promise<void>
  getValuationHistory: (quoteId: string) => Promise<StockValuationHistory>
  refreshQuotes: (reason?: string) => Promise<StockQuote[]>
  refreshQuotesAutomatically: (reason: string) => Promise<StockQuote[]>
  restartQuoteSchedule: () => void
  primeSectorBindings: (refreshWhenReady: boolean) => Promise<void>
  getKline: (quoteId: string, period: KlinePeriod, limit?: number) => Promise<KlineResult>
  getDailyMarketScanResult: () => DailyMarketScanResult | null
  getDailyMarketScanState: () => DailyMarketScanState
  runDailyMarketScan: () => Promise<DailyMarketScanResult>
  saveChipDistributionCache: (entry: ChipDistributionCacheEntry) => ChipDistributionCacheEntry
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  getSectorIndex: (quoteId: string) => Promise<SectorIndexResult>
  refreshTradingCalendar: () => Promise<TradingCalendarSettings>
  clearInactiveFiveLevelAlerts: () => boolean
  sendToWindows: (channel: string, payload: unknown) => void
  syncWindowSurfaces: () => void
  showStockAlertNotification: (alert: TriggeredStockAlert) => void
  showTFloatingProfitAlertNotification: (alert: TriggeredTFloatingProfitAlert) => void
  hideMainWindow: () => void
  quit: () => void
}

const CHANNELS = [
  'app:bootstrap',
  'taskbar:layout:get',
  'stocks:search',
  'dividend-financing:get',
  'dividend-financing:state:get',
  'dividend-financing:changes:get',
  'dividend-financing:update',
  'fundamentals:get',
  'fundamentals:state:get',
  'fundamentals:changes:get',
  'fundamentals:update',
  'company-reports:get',
  'company-reports:summary:generate',
  'company-reports:open',
  'valuation-history:get',
  'quotes:refresh',
  'kline:get',
  'daily-market-scan:get',
  'daily-market-scan:state:get',
  'daily-market-scan:run',
  'chip-distribution:cache:save',
  'order-book:get',
  'funds-flow:get',
  'sector-index:get',
  'trading-calendar:refresh',
  'state:save',
  'config:export',
  'config:import',
  'app:hide',
  'app:quit'
] as const

function configTimestamp(): string {
  const now = new Date()
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-')
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  return `${date}-${time}`
}

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): () => void {
  ipcMain.handle('app:bootstrap', async () => ({
    state: dependencies.getState(),
    quotes: dependencies.getQuotes(),
    source: 'eastmoney' as const,
    warning: dependencies.getStartupWarning()
  }))
  ipcMain.handle('taskbar:layout:get', () => dependencies.getTaskbarLayout())
  ipcMain.handle('stocks:search', (_event, query: string) => dependencies.searchStocks(query))
  ipcMain.handle('dividend-financing:get', () => dependencies.getDividendFinancingSnapshot())
  ipcMain.handle('dividend-financing:state:get', () => dependencies.getDividendFinancingState())
  ipcMain.handle('dividend-financing:changes:get', () => dependencies.getDividendFinancingChangeReport())
  ipcMain.handle('dividend-financing:update', () => dependencies.runDividendFinancingUpdate())
  ipcMain.handle('fundamentals:get', () => dependencies.getFundamentalSnapshot())
  ipcMain.handle('fundamentals:state:get', () => dependencies.getFundamentalState())
  ipcMain.handle('fundamentals:changes:get', () => dependencies.getFundamentalChangeReport())
  ipcMain.handle('fundamentals:update', () => dependencies.runFundamentalUpdate())
  ipcMain.handle('company-reports:get', (_event, code: string, forceRefresh?: boolean) =>
    dependencies.getCompanyReports(code, forceRefresh)
  )
  ipcMain.handle('company-reports:summary:generate', (_event, report: CompanyReportItem) =>
    dependencies.generateCompanyReportSummary(report)
  )
  ipcMain.handle('company-reports:open', (_event, url: string) => dependencies.openCompanyReport(url))
  ipcMain.handle('valuation-history:get', (_event, quoteId: string) =>
    dependencies.getValuationHistory(quoteId)
  )
  ipcMain.handle('quotes:refresh', () => dependencies.refreshQuotes())
  ipcMain.handle('kline:get', (_event, quoteId: string, period: KlinePeriod, limit?: number) =>
    dependencies.getKline(quoteId, period, limit)
  )
  ipcMain.handle('daily-market-scan:get', () => dependencies.getDailyMarketScanResult())
  ipcMain.handle('daily-market-scan:state:get', () => dependencies.getDailyMarketScanState())
  ipcMain.handle('daily-market-scan:run', () => dependencies.runDailyMarketScan())
  ipcMain.handle('chip-distribution:cache:save', (_event, entry: ChipDistributionCacheEntry) =>
    dependencies.saveChipDistributionCache(entry)
  )
  ipcMain.handle('order-book:get', (_event, quoteId: string) => dependencies.getOrderBook(quoteId))
  ipcMain.handle('funds-flow:get', (_event, quoteId: string) => dependencies.getFundsFlow(quoteId))
  ipcMain.handle('sector-index:get', (_event, quoteId: string) =>
    dependencies.getSectorIndex(quoteId)
  )
  ipcMain.handle('trading-calendar:refresh', () => dependencies.refreshTradingCalendar())
  ipcMain.handle('state:save', async (_event, nextState: AppState) => {
    const currentState = dependencies.getState()
    const normalizedState = dependencies.normalizeState(nextState)
    const refreshSettingsChanged =
      currentState.settings.priorityRefreshSeconds !==
        normalizedState.settings.priorityRefreshSeconds ||
      currentState.settings.regularRefreshSeconds !== normalizedState.settings.regularRefreshSeconds
    const marketIndicesChanged =
      currentState.settings.marketIndexIds.join(',') !==
      normalizedState.settings.marketIndexIds.join(',')
    const startWithWindowsChanged =
      currentState.settings.startWithWindows !== normalizedState.settings.startWithWindows
    const watchedStocksChanged =
      currentState.watchlist.length !== normalizedState.watchlist.length ||
      currentState.watchlist.some(
        (stock) =>
          !normalizedState.watchlist.some((nextStock) => nextStock.quoteId === stock.quoteId)
      )
    const priorityChanged = currentState.watchlist.some(
      (stock) =>
        normalizedState.watchlist.find((nextStock) => nextStock.quoteId === stock.quoteId)
          ?.isPriority !== stock.isPriority
    )
    const tAlertUpdate = applyTAlertTriggersToAccounts(
      normalizedState.tTradingAccounts,
      dependencies.getQuotes()
    )
    const stockAlertUpdate = applyStockAlertTriggers(
      normalizedState.watchlist,
      dependencies.getQuotes(),
      tAlertUpdate.accounts
    )
    const savedState = {
      ...normalizedState,
      watchlist: stockAlertUpdate.watchlist,
      tTradingAccounts: tAlertUpdate.accounts
    }
    dependencies.setState(savedState)
    const fiveLevelAlertsCleared = dependencies.clearInactiveFiveLevelAlerts()
    dependencies.persistState()
    if (startWithWindowsChanged) {
      app.setLoginItemSettings({ openAtLogin: savedState.settings.startWithWindows })
    }
    if (refreshSettingsChanged) dependencies.restartQuoteSchedule()
    dependencies.sendToWindows('state:updated', savedState)
    if (fiveLevelAlertsCleared) {
      dependencies.sendToWindows('quotes:updated', dependencies.getQuotes())
    }
    dependencies.syncWindowSurfaces()
    if (watchedStocksChanged) void dependencies.primeSectorBindings(true)
    if (marketIndicesChanged) void dependencies.refreshQuotes('state-change:indices')
    else if (watchedStocksChanged || priorityChanged) {
      void dependencies.refreshQuotesAutomatically('state-change:watchlist')
    }
    stockAlertUpdate.triggered.forEach(dependencies.showStockAlertNotification)
    tAlertUpdate.triggered.forEach(dependencies.showTFloatingProfitAlertNotification)
    return savedState
  })
  ipcMain.handle('config:export', async (_event, stateToExport: AppState) => {
    const options: SaveDialogOptions = {
      title: '导出见涨配置',
      defaultPath: join(app.getPath('documents'), `见涨-配置-${configTimestamp()}.json`),
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
    }
    const mainWindow = dependencies.getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }

    const document = createConfigDocument(stateToExport, app.getVersion())
    writeFileSync(result.filePath, JSON.stringify(document, null, 2), 'utf8')
    return { canceled: false, filePath: result.filePath }
  })
  ipcMain.handle('config:import', async () => {
    const options: OpenDialogOptions = {
      title: '导入见涨配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
    }
    const mainWindow = dependencies.getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { canceled: true }

    const importedState = parseConfigDocument(JSON.parse(readFileSync(filePath, 'utf8')))
    return { canceled: false, filePath, state: importedState }
  })
  ipcMain.handle('app:hide', () => dependencies.hideMainWindow())
  ipcMain.handle('app:quit', () => dependencies.quit())

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  }
}
