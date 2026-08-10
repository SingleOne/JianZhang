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
  type WatchStock
} from '../../src/shared/types'
import {
  FUNDS_FLOW_REFRESH_MILLISECONDS,
  INTRADAY_REFRESH_MILLISECONDS
} from '../../src/shared/market-hours'
import { formatStockAlertNotification, type TriggeredStockAlert } from '../../src/lib/stock-alerts'
import {
  formatTFloatingProfitAlertNotification,
  type TriggeredTFloatingProfitAlert
} from '../../src/lib/t-alerts'
import type { AiRuntime } from '../../src/modules/ai/main/register'
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
import { DailyMarketScanService } from './daily-market-scan-service'
import { DividendFinancingService } from './dividend-financing-service'
import { FundsFlowHub } from './funds-flow-hub'
import { FundamentalDataService } from './fundamental-data-service'
import { HistoricalKlineCache } from './historical-kline-cache'
import { registerIpcHandlers } from './ipc-handlers'
import { KlineHub } from './kline-hub'
import { MarketRequestLogger } from './market-request-logger'
import { OrderBookHub } from './order-book-hub'
import { PythonTaskQueue } from './python-task-queue'
import { QuoteRuntime } from './quote-runtime'
import { SectorMarketCache } from './sector-market-cache'
import { StateStore } from './state-store'
import { TradingCalendarRuntime } from './trading-calendar-runtime'
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
  watchlist: DEFAULT_WATCHLIST,
  watchlistGroups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group })),
  stockTrackingProfiles: {},
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
  settings: { ...DEFAULT_APP_SETTINGS },
  tTradingAccounts: {}
}

let state: AppState = DEFAULT_STATE
let stateStore: StateStore | null = null
let windowManager: WindowManager | null = null
let quoteRuntime: QuoteRuntime | null = null
let tradingCalendarRuntime: TradingCalendarRuntime | null = null
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
let valuationHistoryService: ValuationHistoryService | null = null
let dailyMarketScanService: DailyMarketScanService | null = null

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
  stateStore.save(state)
}

function sendToWindows(channel: string, payload: unknown): void {
  windowManager?.sendToWindows(channel, payload)
}

function showStockAlertNotification(alert: TriggeredStockAlert): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    ...formatStockAlertNotification(alert),
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  notification.on('click', () => windowManager?.showMainWindow(alert.stock.quoteId))
  notification.show()
}

function showTFloatingProfitAlertNotification(alert: TriggeredTFloatingProfitAlert): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    ...formatTFloatingProfitAlertNotification(alert),
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  notification.on('click', () => windowManager?.showMainWindow(alert.quoteId))
  notification.show()
}

function syncWindowSurfaces(): void {
  windowManager?.sync()
}

function cleanupBeforeQuit(): void {
  if (isQuitting) return
  isQuitting = true
  aiTAdviceRuntime?.dispose()
  aiTAdviceRuntime = null
  aiRuntime?.dispose()
  aiRuntime = null
  marketInsightRuntime?.dispose()
  marketInsightRuntime = null
  tradingCalendarRuntime?.dispose()
  tradingCalendarRuntime = null
  quoteRuntime?.dispose()
  quoteRuntime = null
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

    const marketCacheDirectory = join(app.getPath('userData'), 'market-cache')
    valuationHistoryService = new ValuationHistoryService(marketCacheDirectory)
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
    companyReportService = new CompanyReportService(app.getPath('userData'))
    const marketRequestLogger = new MarketRequestLogger(join(app.getPath('userData'), 'logs'))
    setMarketRequestLogger(marketRequestLogger)
    chipDistributionCache = new ChipDistributionCache(marketCacheDirectory)
    fundsFlowHub = new FundsFlowHub(fetchFundsFlow, FUNDS_FLOW_REFRESH_MILLISECONDS)
    const historicalKlineCache = new HistoricalKlineCache(marketCacheDirectory)
    klineHub = new KlineHub(
      fetchKline,
      historicalKlineCache,
      () => state.settings.tradingCalendar.closedDates,
      INTRADAY_REFRESH_MILLISECONDS
    )
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
      marketRequestLogger
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
    disposeIpcHandlers = registerIpcHandlers({
      getState: () => state,
      setState: (nextState) => {
        state = nextState
      },
      normalizeState: (nextState) => {
        if (!stateStore) throw new Error('配置存储尚未初始化')
        return stateStore.normalize(nextState)
      },
      persistState,
      getQuotes: getLatestQuotes,
      getStartupWarning: () => startupWarning,
      getTaskbarLayout: () => windowManager?.getTaskbarLayout() ?? { taskbarHeight: 48 },
      getMainWindow: () => windowManager?.getMainWindow() ?? null,
      searchStocks,
      getDividendFinancingSnapshot: () => dividendFinancingService!.getSnapshot(),
      getDividendFinancingState: () => dividendFinancingService!.getState(),
      getDividendFinancingChangeReport: () => dividendFinancingService!.getChangeReport(),
      runDividendFinancingUpdate: () => dividendFinancingService!.runUpdate(),
      getFundamentalSnapshot: () => fundamentalDataService!.getSnapshot(),
      getFundamentalState: () => fundamentalDataService!.getState(),
      getFundamentalChangeReport: () => fundamentalDataService!.getChangeReport(),
      runFundamentalUpdate: () => fundamentalDataService!.runUpdate(),
      getCompanyReports: (code, forceRefresh) => companyReportService!.get(code, forceRefresh),
      generateCompanyReportSummary: (report) => {
        if (!aiRuntime) throw new Error('当前构建未启用 AI 功能')
        return companyReportService!.generateSummary(report, (request, signal) =>
          aiRuntime!.runStructuredTask(request, signal)
        )
      },
      openCompanyReport: (url) => companyReportService!.open(url),
      getValuationHistory: (quoteId) => valuationHistoryService!.get(quoteId),
      refreshQuotes: (reason) => quoteRuntime!.refreshAll(reason),
      refreshQuotesAutomatically: (reason) => quoteRuntime!.refreshAutomatically(reason),
      refreshStock: (quoteId, reason) => quoteRuntime!.refreshStock(quoteId, reason),
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
      clearInactiveFiveLevelAlerts: () => quoteRuntime!.clearInactiveFiveLevelAlerts(),
      sendToWindows,
      syncWindowSurfaces,
      showStockAlertNotification,
      showTFloatingProfitAlertNotification,
      hideMainWindow: () => windowManager?.hideMainWindow(),
      quit: quitApp
    })

    if (__JIANZHANG_MARKET_INSIGHT_ENABLED__) {
      const { installMarketInsight } =
        await import('../../src/modules/market-insight/main/register')
      marketInsightRuntime = installMarketInsight({
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
    }
    if (__JIANZHANG_AI_MODULE_ENABLED__) {
      const { installAi } = await import('../../src/modules/ai/main/register')
      aiRuntime = installAi({
        getMarketInsightSnapshot: (quoteId) => marketInsightRuntime?.getSnapshot(quoteId) ?? null,
        refreshMarketInsightSnapshot: (quoteId) =>
          marketInsightRuntime?.refreshSnapshot(quoteId) ?? null,
        getChipDistributionCache: (quoteId) => chipDistributionCache?.get(quoteId) ?? null,
        getLatestQuote: (quoteId) =>
          getLatestQuotes().find((quote) => quote.quoteId === quoteId) ?? null,
        getDailyKline: (quoteId, limit) => getKline(quoteId, 'daily', limit, 'ai:long-term'),
        getValuationHistory: (quoteId) => valuationHistoryService!.get(quoteId),
        getFundamentalSnapshot: () => fundamentalDataService?.getSnapshot() ?? null,
        getFundamentalState: () => fundamentalDataService!.getState(),
        getDividendFinancingSnapshot: () => dividendFinancingService?.getSnapshot() ?? null,
        getDividendFinancingState: () => dividendFinancingService!.getState(),
        getCompanyReportSummaries: (code) => companyReportService?.getSummaries(code) ?? []
      })

      if (__JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__) {
        const { installAiTAdvice } = await import('../../src/modules/ai-t-advice/main/register')
        aiTAdviceRuntime = installAiTAdvice({
          refreshMarketInsightSnapshot: (quoteId) =>
            marketInsightRuntime?.refreshSnapshot(quoteId) ?? null,
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
          saveTradingAccount: (quoteId, account) => {
            state = {
              ...state,
              tTradingAccounts: {
                ...state.tTradingAccounts,
                [quoteId]: account
              }
            }
            persistState()
            sendToWindows('state:updated', state)
            windowManager?.updateTrayMenu()
            windowManager?.syncTaskbarWindow()
          },
          runStructuredTask: (request, signal) => aiRuntime!.runStructuredTask(request, signal)
        })
      }
    }

    windowManager = new WindowManager({
      getState: () => state,
      getQuotes: getLatestQuotes,
      isQuitting: () => isQuitting,
      refreshQuotes: () => quoteRuntime!.refreshAll(),
      quit: quitApp
    })
    windowManager.create()
    dividendFinancingService.initializeIfMissing()
    fundamentalDataService.initializeIfMissing()
    quoteRuntime.start()
    tradingCalendarRuntime.start()
    void quoteRuntime.refreshAutomatically('startup')
    void quoteRuntime.primeSectorBindings(true)
  })
}

app.on('before-quit', cleanupBeforeQuit)

app.on('window-all-closed', () => {
  if (!state.settings.minimizeToTray) app.quit()
})
