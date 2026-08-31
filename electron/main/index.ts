import { app, dialog, Notification } from 'electron'
import { join } from 'node:path'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_GROUPS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type KlinePeriod,
  type StockQuote,
  type StockTrackingProfile,
  type WatchStock
} from '../../src/shared/types'
import {
  FUNDS_FLOW_REFRESH_MILLISECONDS,
  INTRADAY_REFRESH_MILLISECONDS
} from '../../src/shared/market-hours'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import { formatStockAlertNotification, type TriggeredStockAlert } from '../../src/lib/stock-alerts'
import {
  formatTFloatingProfitAlertNotification,
  type TriggeredTFloatingProfitAlert
} from '../../src/lib/t-alerts'
import {
  STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS,
  type StockTrackingPriceVolumeDivergence
} from '../../src/lib/stock-tracking-metrics'
import type { AiRuntime } from '../../src/modules/ai/main/register'
import { AiSecrets } from '../../src/modules/ai/main/secrets'
import type { MarketInsightRuntime } from '../../src/modules/market-insight/main/register'
import {
  fetchDailyMarketActiveQuotes,
  fetchFundsFlow,
  fetchKline,
  fetchOrderBook,
  fetchSectorBinding,
  searchStocks,
  setMarketRequestLogger
} from './market'
import { ChipDistributionCache } from './chip-distribution-cache'
import { CompanyReportService } from './company-report-service'
import { CorporateActionService } from './corporate-action-service'
import { CacheMaintenanceService } from './cache-maintenance-service'
import { CompletionNotificationStore } from './completion-notification-store'
import { DailyMarketScanService } from './daily-market-scan-service'
import { DividendFinancingService } from './dividend-financing-service'
import { ExchangeRateRuntime } from './exchange-rate-runtime'
import { FundsFlowHub } from './funds-flow-hub'
import { FundamentalDataService } from './fundamental-data-service'
import { GlobalFundamentalService } from './global-fundamental-service'
import { GitHubSyncService } from './github-sync-service'
import { HistoricalKlineCache } from './historical-kline-cache'
import { registerIpcHandlers } from './ipc-handlers'
import { KlineHub } from './kline-hub'
import { MarketRequestLogger } from './market-request-logger'
import { OrderBookHub } from './order-book-hub'
import { OptionalModuleRuntime } from './optional-module-runtime'
import { PythonTaskQueue } from './python-task-queue'
import { QuoteRuntime } from './quote-runtime'
import { QuoteSnapshotCache } from './quote-snapshot-cache'
import { SectorMarketCache } from './sector-market-cache'
import { SecEdgarClient } from './sec-edgar-client'
import { ShareholderService } from './shareholder-service'
import { StateStore, StateStoreRevisionConflictError } from './state-store'
import { StockTrackingMetricsRuntime } from './stock-tracking-metrics-runtime'
import { TradingCalendarRuntime } from './trading-calendar-runtime'
import { UserDataBackupService } from './user-data-backup-service'
import { ValuationHistoryService } from './valuation-history-service'
import { createAppIcon } from './tray-icons'
import { WindowManager } from './window-manager'

const DEFAULT_WATCHLIST: WatchStock[] = [
  {
    code: '600519',
    name: '贵州茅台',
    quoteId: '1.600519',
    marketLabel: '沪A',
    showInTaskbar: true,
    isPriority: false,
    showRadarSignals: true
  },
  {
    code: '300750',
    name: '宁德时代',
    quoteId: '0.300750',
    marketLabel: '深A',
    showInTaskbar: true,
    isPriority: false,
    showRadarSignals: true
  },
  {
    code: '002594',
    name: '比亚迪',
    quoteId: '0.002594',
    marketLabel: '深A',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true
  },
  {
    code: '600030',
    name: '中信证券',
    quoteId: '1.600030',
    marketLabel: '沪A',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true
  },
  {
    code: '600036',
    name: '招商银行',
    quoteId: '1.600036',
    marketLabel: '沪A',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true
  }
]

const DEFAULT_STATE: AppState = {
  revision: 0,
  watchlist: DEFAULT_WATCHLIST,
  watchlistGroups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group })),
  stockTrackingProfiles: {},
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
  settings: { ...DEFAULT_APP_SETTINGS },
  tTradingAccounts: {},
  corporateActionRecords: {},
  portfolioPerformanceAdjustments: {}
}

let state: AppState = DEFAULT_STATE
let stateStore: StateStore | null = null
let windowManager: WindowManager | null = null
let quoteRuntime: QuoteRuntime | null = null
let stockTrackingMetricsRuntime: StockTrackingMetricsRuntime | null = null
let tradingCalendarRuntime: TradingCalendarRuntime | null = null
let exchangeRateRuntime: ExchangeRateRuntime | null = null
let startupWarning: string | undefined
let isQuitting = false
let marketInsightRuntime: MarketInsightRuntime | null = null
let aiRuntime: AiRuntime | null = null
let aiTAdviceRuntime: { dispose: () => void } | null = null
let chipDistributionCache: ChipDistributionCache | null = null
let fundsFlowHub: FundsFlowHub | null = null
let klineHub: KlineHub | null = null
let disposeIpcHandlers: (() => void) | null = null
let dividendFinancingService: DividendFinancingService | null = null
let fundamentalDataService: FundamentalDataService | null = null
let companyReportService: CompanyReportService | null = null
let corporateActionService: CorporateActionService | null = null
let globalFundamentalService: GlobalFundamentalService | null = null
let valuationHistoryService: ValuationHistoryService | null = null
let shareholderService: ShareholderService | null = null
let dailyMarketScanService: DailyMarketScanService | null = null
let userDataBackupService: UserDataBackupService | null = null
let githubSyncService: GitHubSyncService | null = null
let aiSecrets: AiSecrets | null = null
let completionNotificationStore: CompletionNotificationStore | null = null
let marketRequestLogger: MarketRequestLogger | null = null
let cacheMaintenanceService: CacheMaintenanceService | null = null

const optionalModuleRuntime = new OptionalModuleRuntime(
  {
    marketInsight: __JIANZHANG_MARKET_INSIGHT_ENABLED__,
    ai: __JIANZHANG_AI_MODULE_ENABLED__,
    aiTAdvice: __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__
  },
  (moduleState) => sendToWindows('app:optional-modules:updated', moduleState)
)

const marketDataHub = new (class MarketDataHub {
  private readonly listeners = new Set<(quotes: readonly StockQuote[]) => void>()

  subscribe(listener: (quotes: readonly StockQuote[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(quotes: readonly StockQuote[]): void {
    for (const listener of this.listeners) listener(quotes)
  }
})()
const orderBookHub = new OrderBookHub(fetchOrderBook)
const RETAINED_SYSTEM_NOTIFICATION_LIMIT = 100
const retainedSystemNotifications: Notification[] = []

async function getKline(quoteId: string, period: KlinePeriod, limit?: number, caller = 'kline') {
  return klineHub?.get(quoteId, period, limit, caller) ?? fetchKline(quoteId, period, limit, caller)
}

function getFundsFlow(quoteId: string, caller = 'funds-flow') {
  return fundsFlowHub?.get(quoteId, caller) ?? fetchFundsFlow(quoteId, caller)
}

function getLatestQuotes(): StockQuote[] {
  return quoteRuntime?.getQuotes() ?? []
}

function persistState(): void {
  if (!stateStore) throw new Error('配置存储尚未初始化')
  try {
    stateStore.save(state)
  } catch (reason) {
    if (reason instanceof StateStoreRevisionConflictError) reloadStateFromDiskIfChanged()
    throw reason
  }
}

function reloadStateFromDiskIfChanged(): boolean {
  if (!stateStore) return false
  const previousContent = JSON.stringify(state)
  const loaded = stateStore.load()
  if (loaded.warning) startupWarning = loaded.warning
  if (JSON.stringify(loaded.state) === previousContent) return false
  state = loaded.state
  sendToWindows('state:updated', state)
  windowManager?.updateTrayMenu()
  windowManager?.syncTaskbarWindow()
  return true
}

function sendToWindows(channel: string, payload: unknown): void {
  windowManager?.sendToWindows(channel, payload)
}

function showStockNavigationNotification(notification: Notification, quoteId: string): void {
  retainedSystemNotifications.push(notification)
  if (retainedSystemNotifications.length > RETAINED_SYSTEM_NOTIFICATION_LIMIT) {
    retainedSystemNotifications.shift()
  }

  const releaseNotification = (): void => {
    const index = retainedSystemNotifications.indexOf(notification)
    if (index >= 0) retainedSystemNotifications.splice(index, 1)
  }
  notification.once('click', () => {
    windowManager?.showMainWindow(quoteId, 'sticky-top')
    releaseNotification()
  })
  notification.once('failed', releaseNotification)
  notification.show()
}

function closeRetainedSystemNotifications(): void {
  for (const notification of retainedSystemNotifications) notification.close()
  retainedSystemNotifications.length = 0
}

function showStockAlertNotification(alert: TriggeredStockAlert): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    ...formatStockAlertNotification(alert),
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  showStockNavigationNotification(notification, alert.stock.quoteId)
}

function showTFloatingProfitAlertNotification(alert: TriggeredTFloatingProfitAlert): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    ...formatTFloatingProfitAlertNotification(alert),
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  showStockNavigationNotification(notification, alert.quoteId)
}

function showPriceVolumeDivergenceNotification(
  profile: StockTrackingProfile,
  divergence: StockTrackingPriceVolumeDivergence,
  tradingDate: string
): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: `量价背离提醒 · ${profile.name}`,
    body: `${tradingDate} ${STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS[divergence]}，请打开追踪复盘查看量价趋势。`,
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  showStockNavigationNotification(notification, profile.quoteId)
}

function syncWindowSurfaces(): void {
  windowManager?.sync()
}

async function initializeMarketInsightModule(): Promise<boolean> {
  if (!__JIANZHANG_MARKET_INSIGHT_ENABLED__) return false
  try {
    const { installMarketInsight } = await import('../../src/modules/market-insight/main/register')
    if (isQuitting) return false
    const runtime = installMarketInsight({
      marketDataHub,
      getState: () => state,
      getKline: (quoteId, period, limit) => getKline(quoteId, period, limit, 'market-insight'),
      getOrderBook: (quoteId) =>
        orderBookHub.get(quoteId, {
          maxAgeMilliseconds: 3_000,
          allowStaleOnError: false,
          caller: 'market-insight'
        }),
      getFundsFlow: (quoteId) => getFundsFlow(quoteId, 'market-insight'),
      notifyUpdated: (quoteId) => sendToWindows('insight:updated', quoteId)
    })
    if (isQuitting) {
      runtime.dispose()
      return false
    }
    marketInsightRuntime = runtime
    optionalModuleRuntime.markReady('marketInsight')
    return true
  } catch (reason) {
    if (!isQuitting) optionalModuleRuntime.markFailed('marketInsight', reason)
    return false
  }
}

async function initializeAiModule(marketInsightReady: Promise<boolean>): Promise<boolean> {
  if (!__JIANZHANG_AI_MODULE_ENABLED__) return false
  try {
    const { installAi } = await import('../../src/modules/ai/main/register')
    if (isQuitting) return false
    const runtime = installAi({
      getMarketInsightSnapshot: async (quoteId) => {
        await marketInsightReady
        return marketInsightRuntime?.getSnapshot(quoteId) ?? null
      },
      refreshMarketInsightSnapshot: async (quoteId) => {
        await marketInsightReady
        return marketInsightRuntime?.refreshSnapshot(quoteId) ?? null
      },
      getChipDistributionCache: (quoteId) => chipDistributionCache?.get(quoteId) ?? null,
      getLatestQuote: (quoteId) =>
        getLatestQuotes().find((quote) => quote.quoteId === quoteId) ?? null,
      getDailyKline: (quoteId, limit) => getKline(quoteId, 'daily', limit, 'ai:long-term'),
      getValuationHistory: (quoteId) => valuationHistoryService!.get(quoteId),
      getFundamentalSnapshot: () => fundamentalDataService!.getSnapshot(),
      getFundamentalState: () => fundamentalDataService!.getState(),
      getDividendFinancingSnapshot: () => dividendFinancingService!.getSnapshot(),
      getDividendFinancingState: () => dividendFinancingService!.getState(),
      getCompanyReportSummaries: (code) => companyReportService?.getSummaries(code) ?? []
    })
    if (isQuitting) {
      runtime.dispose()
      return false
    }
    aiRuntime = runtime
    optionalModuleRuntime.markReady('ai')
    return true
  } catch (reason) {
    if (!isQuitting) optionalModuleRuntime.markFailed('ai', reason)
    return false
  }
}

async function initializeAiTAdviceModule(
  aiReady: Promise<boolean>,
  marketInsightReady: Promise<boolean>
): Promise<void> {
  if (!__JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__) return
  try {
    const [module, aiAvailable] = await Promise.all([
      import('../../src/modules/ai-t-advice/main/register'),
      aiReady
    ])
    if (!aiAvailable) throw new Error('AI 模块初始化失败，做 T 参考不可用')
    if (isQuitting) return
    const runtime = module.installAiTAdvice({
      refreshMarketInsightSnapshot: async (quoteId) => {
        await marketInsightReady
        return marketInsightRuntime?.refreshSnapshot(quoteId) ?? null
      },
      getChipDistributionCache: (quoteId) => chipDistributionCache?.get(quoteId) ?? null,
      getTradingContext: (quoteId) => {
        const stock = state.watchlist.find((item) => item.quoteId === quoteId)
        if (!stock) return null
        return {
          stock,
          quote: getLatestQuotes().find((item) => item.quoteId === quoteId),
          position: stock.position,
          account: state.tTradingAccounts[quoteId]
        }
      },
      runStructuredTask: (request, signal) => aiRuntime!.runStructuredTask(request, signal)
    })
    if (isQuitting) {
      runtime.dispose()
      return
    }
    aiTAdviceRuntime = runtime
    optionalModuleRuntime.markReady('aiTAdvice')
  } catch (reason) {
    if (!isQuitting) optionalModuleRuntime.markFailed('aiTAdvice', reason)
  }
}

function initializeOptionalModules(): void {
  const marketInsightReady = initializeMarketInsightModule()
  const aiReady = initializeAiModule(marketInsightReady)
  void initializeAiTAdviceModule(aiReady, marketInsightReady)
}

function cleanupBeforeQuit(): void {
  if (isQuitting) return
  isQuitting = true
  closeRetainedSystemNotifications()
  optionalModuleRuntime.dispose()
  aiTAdviceRuntime?.dispose()
  aiTAdviceRuntime = null
  aiRuntime?.dispose()
  aiRuntime = null
  marketInsightRuntime?.dispose()
  marketInsightRuntime = null
  tradingCalendarRuntime?.dispose()
  tradingCalendarRuntime = null
  exchangeRateRuntime?.dispose()
  exchangeRateRuntime = null
  quoteRuntime?.dispose()
  quoteRuntime = null
  stockTrackingMetricsRuntime?.dispose()
  stockTrackingMetricsRuntime = null
  marketRequestLogger?.dispose()
  marketRequestLogger = null
  cacheMaintenanceService = null
  disposeIpcHandlers?.()
  disposeIpcHandlers = null
  windowManager?.dispose()
  windowManager = null
}

function quitApp(): void {
  cleanupBeforeQuit()
  app.quit()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    try {
      reloadStateFromDiskIfChanged()
    } catch (reason) {
      sendToWindows('data:error', reason instanceof Error ? reason.message : '重新加载最新配置失败')
    }
    windowManager?.showMainWindow()
    windowManager?.syncTaskbarWindow()
    void quoteRuntime?.refreshAutomatically('second-instance')
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.jianzhang.stock')
    stateStore = new StateStore(app.getPath('userData'), DEFAULT_STATE)
    try {
      const loaded = stateStore.load()
      state = loaded.state
      startupWarning = loaded.warning
    } catch (reason) {
      dialog.showErrorBox(
        '见涨配置读取失败',
        reason instanceof Error ? reason.message : '无法读取本地配置'
      )
      app.quit()
      return
    }

    userDataBackupService = new UserDataBackupService(app.getPath('userData'))
    cacheMaintenanceService = new CacheMaintenanceService(app.getPath('userData'))
    completionNotificationStore = new CompletionNotificationStore(app.getPath('userData'))
    githubSyncService = new GitHubSyncService(
      app.getPath('userData'),
      __JIANZHANG_GITHUB_OAUTH_CLIENT_ID__,
      () => userDataBackupService!.getLocalDataUpdatedAt()
    )
    aiSecrets = new AiSecrets(join(app.getPath('userData'), 'modules', 'ai'))

    const marketCacheDirectory = join(app.getPath('userData'), 'market-cache')
    const quoteSnapshotCache = new QuoteSnapshotCache(app.getPath('userData'))
    valuationHistoryService = new ValuationHistoryService(marketCacheDirectory)
    shareholderService = new ShareholderService(marketCacheDirectory)
    const pythonTaskQueue = new PythonTaskQueue((message) => {
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Python 环境不可用',
        message,
        buttons: ['知道了']
      })
    })
    dividendFinancingService = new DividendFinancingService(
      app.getPath('userData'),
      pythonTaskQueue,
      (progress) => sendToWindows('dividend-financing:update-progress', progress),
      (snapshotState) => sendToWindows('dividend-financing:state-updated', snapshotState)
    )
    fundamentalDataService = new FundamentalDataService(
      app.getPath('userData'),
      pythonTaskQueue,
      (progress) => sendToWindows('fundamentals:update-progress', progress),
      (snapshotState) => sendToWindows('fundamentals:state-updated', snapshotState)
    )
    const secEdgarClient = new SecEdgarClient()
    companyReportService = new CompanyReportService(app.getPath('userData'), secEdgarClient)
    corporateActionService = new CorporateActionService(app.getPath('userData'), secEdgarClient)
    globalFundamentalService = new GlobalFundamentalService(
      app.getPath('userData'),
      companyReportService,
      secEdgarClient
    )
    marketRequestLogger = new MarketRequestLogger(join(app.getPath('userData'), 'logs'))
    setMarketRequestLogger(marketRequestLogger)
    chipDistributionCache = new ChipDistributionCache(marketCacheDirectory)
    fundsFlowHub = new FundsFlowHub(fetchFundsFlow, FUNDS_FLOW_REFRESH_MILLISECONDS)
    const historicalKlineCache = new HistoricalKlineCache(marketCacheDirectory)
    klineHub = new KlineHub(
      fetchKline,
      historicalKlineCache,
      (quoteId) => state.settings.tradingCalendar.markets[marketFromQuoteId(quoteId)],
      INTRADAY_REFRESH_MILLISECONDS
    )
    stockTrackingMetricsRuntime = new StockTrackingMetricsRuntime({
      getState: () => state,
      setState: (nextState) => {
        state = nextState
      },
      persistState,
      sendStateUpdated: (nextState) => sendToWindows('state:updated', nextState),
      getDailyKline: (quoteId, limit) => getKline(quoteId, 'daily', limit, 'tracking:price-volume'),
      notifyPriceVolumeDivergence: showPriceVolumeDivergenceNotification
    })
    dailyMarketScanService = new DailyMarketScanService({
      userDataDirectory: app.getPath('userData'),
      historicalKlineCache,
      getClosedDates: () => state.settings.tradingCalendar.closedDates,
      fetchActiveQuotes: fetchDailyMarketActiveQuotes,
      fetchKline,
      notifyState: (scanState) => sendToWindows('daily-market-scan:progress', scanState)
    })
    const sectorMarketCache = new SectorMarketCache(marketCacheDirectory, (quoteId) =>
      fetchSectorBinding(quoteId, 'sector-binding-cache')
    )
    quoteRuntime = new QuoteRuntime({
      getState: () => state,
      setState: (nextState) => {
        state = nextState
      },
      persistState,
      sendToWindows,
      updateWindowSurfaces: () => {
        windowManager?.updateTrayMenu()
        windowManager?.syncTaskbarWindow()
      },
      publishQuotes: (quotes) => marketDataHub.publish(quotes),
      showStockAlertNotification,
      showTFloatingProfitAlertNotification,
      orderBookHub,
      sectorMarketCache,
      marketRequestLogger,
      initialQuotes: quoteSnapshotCache.load(),
      scheduleQuoteSnapshot: (quotes) => quoteSnapshotCache.scheduleSave(quotes),
      disposeQuoteSnapshotCache: () => quoteSnapshotCache.dispose()
    })
    tradingCalendarRuntime = new TradingCalendarRuntime({
      getState: () => state,
      saveState: (nextState) => {
        state = nextState
        persistState()
        sendToWindows('state:updated', state)
      },
      marketRequestLogger
    })
    exchangeRateRuntime = new ExchangeRateRuntime({
      getState: () => state,
      saveState: (nextState) => {
        state = nextState
        persistState()
        sendToWindows('state:updated', state)
      },
      marketRequestLogger
    })
    disposeIpcHandlers = registerIpcHandlers({
      getState: () => state,
      setState: (nextState) => {
        state = nextState
      },
      normalizeState: (nextState) => {
        if (!stateStore) throw new Error('配置存储尚未初始化')
        return stateStore.normalize(nextState)
      },
      assertStateRevision: (nextState) => {
        if (!stateStore) throw new Error('配置存储尚未初始化')
        stateStore.assertRevision(nextState)
      },
      persistState,
      getQuotes: getLatestQuotes,
      getStartupWarning: () => startupWarning,
      getOptionalModulesState: () => optionalModuleRuntime.getState(),
      waitForOptionalModule: (moduleId) => optionalModuleRuntime.waitUntilReady(moduleId),
      getTaskbarLayout: () =>
        windowManager?.getTaskbarLayout() ?? { taskbarHeight: 48, taskbarEdge: 'bottom' },
      getTaskbarTooltipQuoteId: () => windowManager?.getTaskbarTooltipQuoteId() ?? null,
      resizeTaskbarTicker: (width, height) => windowManager?.resizeTaskbarTicker(width, height),
      setTaskbarTooltip: (anchor) => windowManager?.setTaskbarTooltip(anchor),
      resizeTaskbarTooltip: (height) => windowManager?.resizeTaskbarTooltip(height),
      getMainWindow: () => windowManager?.getMainWindow() ?? null,
      searchStocks,
      getDividendFinancingOverview: (codes) => dividendFinancingService!.getOverview(codes),
      getDividendFinancingSnapshot: () => dividendFinancingService!.getSnapshot(),
      getDividendFinancingState: () => dividendFinancingService!.getState(),
      getDividendFinancingChangeReport: () => dividendFinancingService!.getChangeReport(),
      runDividendFinancingUpdate: () => dividendFinancingService!.runUpdate(),
      getFundamentalOverview: (codes) => fundamentalDataService!.getOverview(codes),
      getFundamentalSnapshot: () => fundamentalDataService!.getSnapshot(),
      getFundamentalState: () => fundamentalDataService!.getState(),
      getFundamentalChangeReport: () => fundamentalDataService!.getChangeReport(),
      runFundamentalUpdate: () => fundamentalDataService!.runUpdate(),
      getCompanyReports: (quoteId, forceRefresh) =>
        companyReportService!.get(quoteId, forceRefresh),
      getGlobalFundamentals: (quoteId, forceRefresh) =>
        globalFundamentalService!.get(quoteId, forceRefresh),
      generateCompanyReportSummary: async (report) => {
        await optionalModuleRuntime.waitUntilReady('ai')
        if (!aiRuntime) throw new Error('AI 功能初始化失败')
        return companyReportService!.generateSummary(report, (request, signal) =>
          aiRuntime!.runStructuredTask(request, signal)
        )
      },
      openCompanyReport: (url) => companyReportService!.open(url),
      listCorporateActions: (quoteId, forceRefresh) =>
        corporateActionService!.get(quoteId, forceRefresh),
      previewCorporateAction: (request) => corporateActionService!.preview(request),
      ignoreCorporateAction: (candidate) => corporateActionService!.ignore(candidate),
      reverseCorporateAction: (candidate, account) =>
        corporateActionService!.reverse(candidate, account),
      createManualCorporateAction: (request, account) =>
        corporateActionService!.createManual(request, account),
      openCorporateAction: (url) => corporateActionService!.open(url),
      listPortfolioLedger: (account) => account.ledger.entries,
      getShareholderSnapshot: (quoteId, forceRefresh) =>
        shareholderService!.get(quoteId, forceRefresh),
      getValuationHistory: (quoteId) => valuationHistoryService!.get(quoteId),
      refreshQuotes: (reason) => quoteRuntime!.refreshAll(reason),
      refreshQuotesAutomatically: (reason) => quoteRuntime!.refreshAutomatically(reason),
      refreshStock: (quoteId, reason) => quoteRuntime!.refreshStock(quoteId, reason),
      refreshStocks: (quoteIds, reason) => quoteRuntime!.refreshStocks(quoteIds, reason),
      captureStockTrackingMetrics: () => stockTrackingMetricsRuntime!.capture(),
      restartQuoteSchedule: () => quoteRuntime!.restartSchedule(),
      primeSectorBindings: (refreshWhenReady) =>
        quoteRuntime!.primeSectorBindings(refreshWhenReady),
      getKline: (quoteId, period, limit) =>
        getKline(quoteId, period, limit, `detail:kline:${period}`),
      getDailyMarketScanResult: () => dailyMarketScanService!.getResult(),
      getDailyMarketScanState: () => dailyMarketScanService!.getState(),
      runDailyMarketScan: () => dailyMarketScanService!.run(),
      saveChipDistributionCache: (entry) => {
        if (!chipDistributionCache) throw new Error('筹码分布缓存尚未初始化')
        return chipDistributionCache.save(entry)
      },
      getOrderBook: (quoteId) =>
        orderBookHub.get(quoteId, {
          maxAgeMilliseconds: 3_000,
          allowStaleOnError: true,
          caller: 'detail:order-book'
        }),
      getFundsFlow: (quoteId) => getFundsFlow(quoteId, 'detail:funds-flow'),
      getSectorIndex: (quoteId) =>
        quoteRuntime!.getSectorIndex(quoteId, (sectorQuoteId) =>
          getKline(sectorQuoteId, 'intraday', undefined, 'detail:sector')
        ),
      refreshTradingCalendar: () => tradingCalendarRuntime!.refresh(),
      refreshExchangeRates: () => exchangeRateRuntime!.refresh(),
      getCompletionNotifications: () => completionNotificationStore!.load(),
      saveCompletionNotifications: (notifications) =>
        completionNotificationStore!.save(notifications),
      getCacheSummary: () => cacheMaintenanceService!.getSummary(),
      clearCaches: async (categoryIds) => {
        const result = await cacheMaintenanceService!.clear(categoryIds)
        setTimeout(() => {
          app.relaunch()
          quitApp()
        }, 300)
        return result
      },
      createUserDataBackup: (stateToExport, applicationVersion) =>
        userDataBackupService!.create(stateToExport, applicationVersion, aiSecrets!.exportAll()),
      prepareUserDataBackup: (value) => userDataBackupService!.prepare(value),
      applyUserDataBackup: (importId) =>
        userDataBackupService!.apply(importId, {
          currentState: structuredClone(state),
          currentApiKeys: aiSecrets!.exportAll(),
          replaceState: (nextState) => {
            if (!stateStore) throw new Error('配置存储尚未初始化')
            state = stateStore.saveImported(nextState)
            return state
          },
          replaceAiApiKeys: (apiKeys) => aiSecrets!.replaceAll(apiKeys)
        }),
      getGitHubSyncSettings: () => githubSyncService!.getSettings(),
      startGitHubLogin: () => githubSyncService!.startLogin(),
      completeGitHubLogin: (loginId) => githubSyncService!.completeLogin(loginId),
      refreshGitHubGist: () => githubSyncService!.refreshGist(),
      getGitHubSyncPassword: () => githubSyncService!.getSyncPassword(),
      generateGitHubSyncPassword: () => githubSyncService!.generateSyncPassword(),
      saveGitHubSyncPassword: (password) => githubSyncService!.saveSyncPassword(password),
      disconnectGitHub: () => githubSyncService!.disconnect(),
      uploadUserDataToGitHub: async (stateToExport, applicationVersion, overwriteRemote) => {
        const document = userDataBackupService!.create(
          stateStore!.normalize(stateToExport),
          applicationVersion,
          aiSecrets!.exportAll()
        )
        return githubSyncService!.upload(
          JSON.stringify(document, null, 2),
          Object.keys(document.aiApiKeys).length,
          overwriteRemote
        )
      },
      downloadUserDataFromGitHub: async () => {
        const download = await githubSyncService!.download()
        return {
          ...userDataBackupService!.prepare(JSON.parse(download.content)),
          githubGistVersion: download.version
        }
      },
      confirmGitHubGistRestore: (version) => githubSyncService!.confirmRestore(version),
      clearInactiveFiveLevelAlerts: () => quoteRuntime!.clearInactiveFiveLevelAlerts(),
      sendToWindows,
      syncWindowSurfaces,
      showStockAlertNotification,
      showTFloatingProfitAlertNotification,
      hideMainWindow: () => windowManager?.hideMainWindow(),
      restart: () => {
        app.relaunch()
        quitApp()
      },
      quit: quitApp
    })

    windowManager = new WindowManager(
      {
        getState: () => state,
        getQuotes: getLatestQuotes,
        isQuitting: () => isQuitting,
        refreshQuotes: () => quoteRuntime!.refreshAll(),
        quit: quitApp
      },
      app.getPath('userData')
    )
    windowManager.create()
    initializeOptionalModules()
    dividendFinancingService.initializeIfMissing()
    fundamentalDataService.initializeIfMissing()
    quoteRuntime.start()
    stockTrackingMetricsRuntime.start()
    tradingCalendarRuntime.start()
    exchangeRateRuntime.start()
    void quoteRuntime.refreshAutomatically('startup')
    void quoteRuntime.primeSectorBindings(true)
    setTimeout(() => {
      void corporateActionService?.refreshWatchlist(state.watchlist.map((stock) => stock.quoteId))
    }, 15_000)
  })
}

app.on('before-quit', cleanupBeforeQuit)

app.on('window-all-closed', () => {
  if (!state.settings.minimizeToTray) app.quit()
})
