import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './file-storage'
import {
  applyTAlertTriggersToAccounts,
  type TriggeredTFloatingProfitAlert
} from '../../src/lib/t-alerts'
import { applyStockAlertTriggers, type TriggeredStockAlert } from '../../src/lib/stock-alerts'
import { parseConfigDocument } from '../../src/shared/config'
import {
  JIANZHANG_USER_DATA_BACKUP_FORMAT,
  type JianzhangUserDataBackupDocument
} from '../../src/shared/user-data-backup'
import type {
  AppState,
  AppCompletionNotification,
  CacheCategoryId,
  CacheClearResult,
  CacheSummary,
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
  GitHubDeviceAuthorization,
  GitHubLoginResult,
  GitHubSyncSettings,
  GitHubSyncUploadResult,
  KlinePeriod,
  KlineResult,
  SearchResult,
  SectorIndexResult,
  ShareholderSnapshot,
  StockOrderBook,
  StockQuote,
  StockValuationHistory,
  TaskbarLayout,
  TaskbarTooltipAnchor,
  TradingCalendarSettings,
  UserDataBackupSummary
} from '../../src/shared/types'

interface IpcHandlerDependencies {
  getState: () => AppState
  setState: (state: AppState) => void
  normalizeState: (state: AppState) => AppState
  assertStateRevision: (state: AppState) => void
  persistState: () => void
  getQuotes: () => StockQuote[]
  getStartupWarning: () => string | undefined
  getTaskbarLayout: () => TaskbarLayout
  getTaskbarTooltipQuoteId: () => string | null
  resizeTaskbarTicker: (width: number, height: number) => void
  setTaskbarTooltip: (anchor: TaskbarTooltipAnchor | null) => void
  resizeTaskbarTooltip: (height: number) => void
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
  getShareholderSnapshot: (quoteId: string, forceRefresh?: boolean) => Promise<ShareholderSnapshot>
  getValuationHistory: (quoteId: string) => Promise<StockValuationHistory>
  refreshQuotes: (reason?: string) => Promise<StockQuote[]>
  refreshQuotesAutomatically: (reason: string) => Promise<StockQuote[]>
  refreshStock: (quoteId: string, reason?: string) => Promise<StockQuote[]>
  refreshStocks: (quoteIds: string[], reason?: string) => Promise<StockQuote[]>
  captureStockTrackingMetrics: () => Promise<void>
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
  getCompletionNotifications: () => AppCompletionNotification[]
  saveCompletionNotifications: (
    notifications: AppCompletionNotification[]
  ) => AppCompletionNotification[]
  getCacheSummary: () => Promise<CacheSummary>
  clearCaches: (categoryIds: CacheCategoryId[]) => Promise<CacheClearResult>
  createUserDataBackup: (
    state: AppState,
    applicationVersion: string
  ) => JianzhangUserDataBackupDocument
  prepareUserDataBackup: (value: unknown) => {
    importId: string
    state: AppState
    summary: UserDataBackupSummary
  }
  applyUserDataBackup: (importId: string) => void
  getGitHubSyncSettings: () => GitHubSyncSettings
  startGitHubLogin: () => Promise<GitHubDeviceAuthorization>
  completeGitHubLogin: (loginId: string) => Promise<GitHubLoginResult>
  refreshGitHubGist: () => Promise<GitHubSyncSettings>
  getGitHubSyncPassword: () => string | null
  generateGitHubSyncPassword: () => string
  saveGitHubSyncPassword: (password: string) => Promise<GitHubSyncSettings>
  disconnectGitHub: () => GitHubSyncSettings
  uploadUserDataToGitHub: (
    state: AppState,
    applicationVersion: string,
    overwriteRemote?: boolean
  ) => Promise<GitHubSyncUploadResult>
  downloadUserDataFromGitHub: () => Promise<{
    importId: string
    state: AppState
    summary: UserDataBackupSummary
    githubGistVersion: string
  }>
  confirmGitHubGistRestore: (version: string) => GitHubSyncSettings
  clearInactiveFiveLevelAlerts: () => boolean
  sendToWindows: (channel: string, payload: unknown) => void
  syncWindowSurfaces: () => void
  showStockAlertNotification: (alert: TriggeredStockAlert) => void
  showTFloatingProfitAlertNotification: (alert: TriggeredTFloatingProfitAlert) => void
  hideMainWindow: () => void
  restart: () => void
  quit: () => void
}

const CHANNELS = [
  'app:bootstrap',
  'taskbar:layout:get',
  'taskbar:ticker:resize',
  'taskbar:tooltip:get',
  'taskbar:tooltip:set',
  'taskbar:tooltip:resize',
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
  'shareholders:get',
  'valuation-history:get',
  'quotes:refresh',
  'quotes:refresh-one',
  'quotes:refresh-by-ids',
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
  'completion-notifications:get',
  'completion-notifications:save',
  'cache:summary',
  'cache:clear',
  'config:export',
  'config:import',
  'config:import:apply',
  'github-sync:settings:get',
  'github-sync:login:start',
  'github-sync:login:complete',
  'github-sync:gist:refresh',
  'github-sync:password:get',
  'github-sync:password:generate',
  'github-sync:password:save',
  'github-sync:disconnect',
  'github-sync:upload',
  'github-sync:download',
  'github-sync:gist:restore-confirm',
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
  ipcMain.handle('taskbar:ticker:resize', (_event, width: number, height: number) =>
    dependencies.resizeTaskbarTicker(width, height)
  )
  ipcMain.handle('taskbar:tooltip:get', () => dependencies.getTaskbarTooltipQuoteId())
  ipcMain.handle('taskbar:tooltip:set', (_event, anchor: TaskbarTooltipAnchor | null) =>
    dependencies.setTaskbarTooltip(anchor)
  )
  ipcMain.handle('taskbar:tooltip:resize', (_event, height: number) =>
    dependencies.resizeTaskbarTooltip(height)
  )
  ipcMain.handle('stocks:search', (_event, query: string) => dependencies.searchStocks(query))
  ipcMain.handle('dividend-financing:get', () => dependencies.getDividendFinancingSnapshot())
  ipcMain.handle('dividend-financing:state:get', () => dependencies.getDividendFinancingState())
  ipcMain.handle('dividend-financing:changes:get', () =>
    dependencies.getDividendFinancingChangeReport()
  )
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
  ipcMain.handle('company-reports:open', (_event, url: string) =>
    dependencies.openCompanyReport(url)
  )
  ipcMain.handle('shareholders:get', (_event, quoteId: string, forceRefresh?: boolean) =>
    dependencies.getShareholderSnapshot(quoteId, forceRefresh)
  )
  ipcMain.handle('valuation-history:get', (_event, quoteId: string) =>
    dependencies.getValuationHistory(quoteId)
  )
  ipcMain.handle('quotes:refresh', () => dependencies.refreshQuotes())
  ipcMain.handle('quotes:refresh-one', (_event, quoteId: string) =>
    dependencies.refreshStock(quoteId)
  )
  ipcMain.handle('quotes:refresh-by-ids', (_event, quoteIds: string[]) =>
    dependencies.refreshStocks(quoteIds, 'tracking-review')
  )
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
    dependencies.assertStateRevision(nextState)
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
    void dependencies.captureStockTrackingMetrics()
    if (watchedStocksChanged) void dependencies.primeSectorBindings(true)
    if (marketIndicesChanged) void dependencies.refreshQuotes('state-change:indices')
    else if (priorityChanged) {
      void dependencies.refreshQuotesAutomatically('state-change:watchlist')
    }
    stockAlertUpdate.triggered.forEach(dependencies.showStockAlertNotification)
    tAlertUpdate.triggered.forEach(dependencies.showTFloatingProfitAlertNotification)
    return savedState
  })
  ipcMain.handle('completion-notifications:get', () => dependencies.getCompletionNotifications())
  ipcMain.handle(
    'completion-notifications:save',
    (_event, notifications: AppCompletionNotification[]) =>
      dependencies.saveCompletionNotifications(notifications)
  )
  ipcMain.handle('cache:summary', () => dependencies.getCacheSummary())
  ipcMain.handle('cache:clear', (_event, categoryIds: CacheCategoryId[]) =>
    dependencies.clearCaches(categoryIds)
  )
  ipcMain.handle('config:export', async (_event, _stateToExport: AppState) => {
    const options: SaveDialogOptions = {
      title: '导出见涨用户数据',
      defaultPath: join(app.getPath('documents'), `见涨-用户数据-${configTimestamp()}.json`),
      filters: [{ name: '见涨用户数据备份', extensions: ['json'] }]
    }
    const mainWindow = dependencies.getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }

    const document = dependencies.createUserDataBackup(
      dependencies.normalizeState(dependencies.getState()),
      app.getVersion()
    )
    atomicWriteFileSync(result.filePath, JSON.stringify(document, null, 2))
    return {
      canceled: false,
      filePath: result.filePath,
      fileCount: document.files.length,
      apiKeyCount: Object.keys(document.aiApiKeys).length
    }
  })
  ipcMain.handle('config:import', async () => {
    const options: OpenDialogOptions = {
      title: '导入见涨用户数据',
      properties: ['openFile'],
      filters: [{ name: '见涨用户数据或旧版配置', extensions: ['json'] }]
    }
    const mainWindow = dependencies.getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { canceled: true }

    const value = JSON.parse(readFileSync(filePath, 'utf8')) as { format?: unknown }
    if (value?.format === JIANZHANG_USER_DATA_BACKUP_FORMAT) {
      const prepared = dependencies.prepareUserDataBackup(value)
      return {
        canceled: false,
        filePath,
        state: prepared.state,
        importId: prepared.importId,
        backupSummary: prepared.summary
      }
    }
    return { canceled: false, filePath, state: parseConfigDocument(value) }
  })
  ipcMain.handle('config:import:apply', (_event, importId: string) => {
    dependencies.applyUserDataBackup(importId)
    setTimeout(dependencies.restart, 300)
  })
  ipcMain.handle('github-sync:settings:get', () => dependencies.getGitHubSyncSettings())
  ipcMain.handle('github-sync:login:start', () => dependencies.startGitHubLogin())
  ipcMain.handle('github-sync:login:complete', (_event, loginId: string) =>
    dependencies.completeGitHubLogin(loginId)
  )
  ipcMain.handle('github-sync:gist:refresh', () => dependencies.refreshGitHubGist())
  ipcMain.handle('github-sync:password:get', () => dependencies.getGitHubSyncPassword())
  ipcMain.handle('github-sync:password:generate', () => dependencies.generateGitHubSyncPassword())
  ipcMain.handle('github-sync:password:save', (_event, password: string) =>
    dependencies.saveGitHubSyncPassword(password)
  )
  ipcMain.handle('github-sync:disconnect', () => dependencies.disconnectGitHub())
  ipcMain.handle(
    'github-sync:upload',
    (_event, _stateToExport: AppState, overwriteRemote?: boolean) =>
      dependencies.uploadUserDataToGitHub(
        dependencies.normalizeState(dependencies.getState()),
        app.getVersion(),
        overwriteRemote
      )
  )
  ipcMain.handle('github-sync:download', async () => {
    const prepared = await dependencies.downloadUserDataFromGitHub()
    return {
      canceled: false,
      state: prepared.state,
      importId: prepared.importId,
      backupSummary: prepared.summary,
      githubGistVersion: prepared.githubGistVersion
    }
  })
  ipcMain.handle('github-sync:gist:restore-confirm', (_event, version: string) =>
    dependencies.confirmGitHubGistRestore(version)
  )
  ipcMain.handle('app:hide', () => dependencies.hideMainWindow())
  ipcMain.handle('app:quit', () => dependencies.quit())

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  }
}
