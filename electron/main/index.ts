import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  Tray,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  getMarketIndexStocks,
  hasLegacyTTradingData,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeTradingCalendarSettings,
  normalizeTTradingAccounts,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  normalizeWatchlistColumnOrder,
  type AppState,
  type ChipDistributionCacheEntry,
  type KlinePeriod,
  type StockQuote,
  type TaskbarLayout,
  type TradingCalendarSettings,
  type WatchStock
} from '../../src/shared/types'
import { createConfigDocument, parseConfigDocument } from '../../src/shared/config'
import {
  FUNDS_FLOW_REFRESH_MILLISECONDS,
  INTRADAY_REFRESH_MILLISECONDS,
  isBeijingAutoRefreshTime
} from '../../src/shared/market-hours'
import {
  accountHasTriggeredTAlerts,
  applyTAlertTriggersToAccounts
} from '../../src/lib/t-alerts'
import { calculatePositionMetrics } from '../../src/lib/portfolio'
import { detectFiveLevelLargeOrders } from '../../src/lib/order-book-alerts'
import {
  applyStockAlertTriggers,
  formatStockAlertNotification,
  type TriggeredStockAlert
} from '../../src/lib/stock-alerts'
import type { AiRuntime } from '../../src/modules/ai/main/register'
import type { MarketInsightRuntime } from '../../src/modules/market-insight/main/register'
import {
  fetchFundsFlow,
  fetchKline,
  fetchOrderBook,
  fetchQuotes,
  fetchSectorBinding,
  setMarketRequestLogger,
  searchStocks
} from './market'
import { OrderBookHub } from './order-book-hub'
import { ChipDistributionCache } from './chip-distribution-cache'
import { HistoricalKlineCache } from './historical-kline-cache'
import { FundsFlowHub } from './funds-flow-hub'
import { IntradayKlineHub } from './intraday-kline-hub'
import { MarketRequestLogger } from './market-request-logger'
import {
  QuoteRefreshCoordinator,
  type QuoteRefreshBatch
} from './quote-refresh-coordinator'
import { SectorMarketCache } from './sector-market-cache'
import { fetchSseTradingCalendar } from './trading-calendar'
import { createAppIcon } from './tray-icons'

const DEFAULT_WATCHLIST: WatchStock[] = [
  { code: '600519', name: '贵州茅台', quoteId: '1.600519', marketLabel: '沪A', showInTaskbar: true, isPriority: false, showRadarSignals: true },
  { code: '300750', name: '宁德时代', quoteId: '0.300750', marketLabel: '深A', showInTaskbar: true, isPriority: false, showRadarSignals: true },
  { code: '002594', name: '比亚迪', quoteId: '0.002594', marketLabel: '深A', showInTaskbar: false, isPriority: false, showRadarSignals: true },
  { code: '600030', name: '中信证券', quoteId: '1.600030', marketLabel: '沪A', showInTaskbar: false, isPriority: false, showRadarSignals: true },
  { code: '600036', name: '招商银行', quoteId: '1.600036', marketLabel: '沪A', showInTaskbar: false, isPriority: false, showRadarSignals: true }
]

const DEFAULT_STATE: AppState = {
  watchlist: DEFAULT_WATCHLIST,
  watchlistGroups: [],
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
  settings: { ...DEFAULT_APP_SETTINGS },
  tTradingAccounts: {}
}

let mainWindow: BrowserWindow | null = null
let taskbarWindow: BrowserWindow | null = null
let trayPopupWindow: BrowserWindow | null = null
let appTray: Tray | null = null
let state: AppState = DEFAULT_STATE
let latestQuotes: StockQuote[] = []
let tradingCalendarCheckTimer: NodeJS.Timeout | null = null
let trayPopupShowTimer: NodeJS.Timeout | null = null
let tradingCalendarRefresh: Promise<TradingCalendarSettings> | null = null
let taskbarLayout: TaskbarLayout = { taskbarHeight: 48 }
let trayHovered = false
let fiveLevelRefreshCursor = 0
let isQuitting = false
let marketInsightRuntime: MarketInsightRuntime | null = null
let aiRuntime: AiRuntime | null = null
let aiTAdviceRuntime: { dispose: () => void } | null = null
let chipDistributionCache: ChipDistributionCache | null = null
let fundsFlowHub: FundsFlowHub | null = null
let historicalKlineCache: HistoricalKlineCache | null = null
let intradayKlineHub: IntradayKlineHub | null = null
let marketRequestLogger: MarketRequestLogger | null = null
let sectorMarketCache: SectorMarketCache | null = null
let quoteRefreshCoordinator: QuoteRefreshCoordinator<StockQuote[]> | null = null
let sectorBindingPrime: Promise<void> | null = null
let lastSectorBindingPrimeAt = 0

type HistoricalKlinePeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

function isHistoricalKlinePeriod(period: KlinePeriod): period is HistoricalKlinePeriod {
  return period === 'daily' || period === 'weekly' || period === 'monthly'
}

function defaultKlineLimit(period: KlinePeriod): number {
  return period === 'weekly' ? 104 : period === 'monthly' ? 60 : 120
}

async function getKline(quoteId: string, period: KlinePeriod, limit?: number, caller = 'kline') {
  if (period === 'intraday' && intradayKlineHub) {
    return intradayKlineHub.get(quoteId, caller)
  }
  if (!historicalKlineCache || !isHistoricalKlinePeriod(period)) {
    return fetchKline(quoteId, period, limit, caller)
  }

  const requestedLimit = Math.max(1, Math.round(limit ?? defaultKlineLimit(period)))
  const cached = historicalKlineCache.get(
    quoteId,
    period,
    requestedLimit,
    state.settings.tradingCalendar.closedDates
  )
  if (cached) return cached

  const fallback = historicalKlineCache.getFallback(quoteId, period)
  try {
    const result = await fetchKline(quoteId, period, requestedLimit, caller)
    if (historicalKlineCache.shouldKeepFallback(period, result)) return fallback ?? result
    return historicalKlineCache.save(quoteId, period, requestedLimit, result)
  } catch (reason) {
    if (fallback) return fallback
    throw reason
  }
}

function getFundsFlow(quoteId: string, caller = 'funds-flow') {
  return fundsFlowHub?.get(quoteId, caller) ?? fetchFundsFlow(quoteId, caller)
}

class MarketDataHub {
  private readonly listeners = new Set<(quotes: readonly StockQuote[]) => void>()

  subscribe(listener: (quotes: readonly StockQuote[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(quotes: readonly StockQuote[]): void {
    for (const listener of this.listeners) listener(quotes)
  }
}

const marketDataHub = new MarketDataHub()
const orderBookHub = new OrderBookHub(fetchOrderBook)

function statePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function legacyTradingBackupPath(): string {
  return join(app.getPath('userData'), 'settings.pre-unified-trades.json')
}

function loadState(): AppState {
  try {
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as AppState
    const hasLegacyTrades = hasLegacyTTradingData(saved.tTradingAccounts)
    const loadedState: AppState = {
      watchlist: normalizeWatchlist(saved.watchlist ?? DEFAULT_WATCHLIST),
      watchlistGroups: normalizeWatchlistGroups(saved.watchlistGroups),
      settings: normalizeAppSettings(saved.settings),
      columnOrder: migrateWatchlistColumnOrder(saved.columnOrder, saved.columnOrderVersion),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(saved.tTradingAccounts)
    }
    const tradingAccountsMigrated = JSON.stringify(saved.tTradingAccounts ?? {})
      !== JSON.stringify(loadedState.tTradingAccounts)
    if (hasLegacyTrades && !existsSync(legacyTradingBackupPath())) {
      writeFileSync(legacyTradingBackupPath(), JSON.stringify(saved, null, 2), 'utf8')
    }
    if (saved.columnOrderVersion !== WATCHLIST_COLUMN_ORDER_VERSION || tradingAccountsMigrated) {
      writeFileSync(statePath(), JSON.stringify(loadedState, null, 2), 'utf8')
    }
    return loadedState
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function persistState(): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

function configTimestamp(): string {
  const now = new Date()
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-')
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  return `${date}-${time}`
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const window of [mainWindow, taskbarWindow, trayPopupWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function showStockAlertNotification(alert: TriggeredStockAlert): void {
  if (!Notification.isSupported()) return
  const content = formatStockAlertNotification(alert)
  const notification = new Notification({
    ...content,
    icon: createAppIcon(),
    timeoutType: 'default'
  })
  notification.on('click', () => showMainWindow(alert.stock.quoteId))
  notification.show()
}

function formatPrice(value: number | null): string {
  if (value === null) return '--'
  return value >= 100 ? value.toFixed(2) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function formatPercent(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatProfit(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function showMainWindow(quoteId?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  if (quoteId) {
    mainWindow.webContents.send('stock:selected', quoteId)
  }
}

function cleanupBeforeQuit(): void {
  isQuitting = true
  aiTAdviceRuntime?.dispose()
  aiTAdviceRuntime = null
  aiRuntime?.dispose()
  aiRuntime = null
  marketInsightRuntime?.dispose()
  marketInsightRuntime = null
  quoteRefreshCoordinator?.dispose()
  quoteRefreshCoordinator = null
  if (tradingCalendarCheckTimer) clearInterval(tradingCalendarCheckTimer)
  if (trayPopupShowTimer) clearTimeout(trayPopupShowTimer)
  tradingCalendarCheckTimer = null
  trayPopupShowTimer = null
  appTray?.destroy()
  appTray = null
  trayPopupWindow?.destroy()
  trayPopupWindow = null
  taskbarWindow?.destroy()
  taskbarWindow = null
}

function quitApp(): void {
  cleanupBeforeQuit()
  app.quit()
}

function updateAppTrayMenu(): void {
  if (!appTray) return

  const selectedItems = taskbarVisibleStocks()
    .map((stock) => {
      const quote = latestQuotes.find((item) => item.quoteId === stock.quoteId)
      const todayProfit = calculatePositionMetrics(
        stock.position,
        quote,
        state.tTradingAccounts[stock.quoteId]
      ).todayProfit
      return {
        label: `${stock.name}  ${formatPrice(quote?.latest ?? null)}  ${formatPercent(quote?.changePercent ?? null)}  ${formatProfit(todayProfit)}`,
        click: () => showMainWindow(stock.quoteId)
      }
    })

  appTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开见涨', click: () => showMainWindow() },
      { label: '立即刷新', click: () => void refreshAll() },
      { type: 'separator' },
      ...(selectedItems.length > 0 ? selectedItems : [{ label: '尚未选择任务栏股票', enabled: false }]),
      { type: 'separator' },
      { label: '退出', click: quitApp }
    ])
  )
}

function taskbarVisibleStocks(): WatchStock[] {
  return state.watchlist.filter((stock) => (
    stock.showInTaskbar
    || accountHasTriggeredTAlerts(state.tTradingAccounts[stock.quoteId])
    || (state.tTradingAccounts[stock.quoteId]?.activeBatch && latestQuotes.some((quote) => (
      quote.quoteId === stock.quoteId && Boolean(quote.fiveLevelLargeOrders?.length)
    )))
  ))
}

function hasActiveTaskbarAlert(): boolean {
  return state.watchlist.some((stock) => (
    accountHasTriggeredTAlerts(state.tTradingAccounts[stock.quoteId])
    || (state.tTradingAccounts[stock.quoteId]?.activeBatch && latestQuotes.some((quote) => (
      quote.quoteId === stock.quoteId && Boolean(quote.fiveLevelLargeOrders?.length)
    )))
  ))
}

function trayPopupSize(): { width: number; height: number } {
  const selectedCount = taskbarVisibleStocks().length
  const columns = selectedCount > 1 ? 2 : 1
  const rows = Math.ceil(selectedCount / columns)
  return {
    width: columns === 2 ? 638 : 369,
    height: 35 + rows * 78
  }
}

function positionTrayPopupWindow(): void {
  if (!trayPopupWindow || trayPopupWindow.isDestroyed() || !appTray) return

  const trayBounds = appTray.getBounds()
  const trayCenter = {
    x: trayBounds.x + Math.floor(trayBounds.width / 2),
    y: trayBounds.y + Math.floor(trayBounds.height / 2)
  }
  const display = screen.getDisplayNearestPoint(trayCenter)
  const { width, height: contentHeight } = trayPopupSize()
  const margin = 8
  const height = Math.min(contentHeight, display.workArea.height - margin * 2)
  const minX = display.workArea.x + margin
  const maxX = display.workArea.x + display.workArea.width - width - margin
  const x = Math.min(maxX, Math.max(minX, trayCenter.x - Math.floor(width / 2)))
  const workAreaBottom = display.workArea.y + display.workArea.height
  const trayIsBelowWorkArea = trayCenter.y >= workAreaBottom
  const y = trayIsBelowWorkArea
    ? workAreaBottom - height - margin
    : Math.min(
        workAreaBottom - height - margin,
        Math.max(display.workArea.y + margin, trayBounds.y + trayBounds.height + margin)
      )

  trayPopupWindow.setBounds({ x, y, width, height })
}

function hideTrayPopup(): void {
  if (trayPopupShowTimer) clearTimeout(trayPopupShowTimer)
  trayPopupShowTimer = null
  if (trayPopupWindow && !trayPopupWindow.isDestroyed()) trayPopupWindow.hide()
}

function showTrayPopup(): void {
  if (!trayHovered || taskbarVisibleStocks().length === 0) return
  if (!trayPopupWindow || trayPopupWindow.isDestroyed()) {
    createTrayPopupWindow()
    return
  }
  positionTrayPopupWindow()
  trayPopupWindow.setAlwaysOnTop(true, 'pop-up-menu')
  trayPopupWindow.showInactive()
}

function setTrayHovered(hovered: boolean): void {
  if (trayHovered === hovered) return
  trayHovered = hovered
  if (!hovered) {
    hideTrayPopup()
    return
  }

  trayPopupShowTimer = setTimeout(() => {
    trayPopupShowTimer = null
    showTrayPopup()
  }, 1000)
}

function createTrayPopupWindow(): void {
  if (trayPopupWindow && !trayPopupWindow.isDestroyed()) return

  const window = new BrowserWindow({
    width: 369,
    height: 113,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  trayPopupWindow = window

  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.setIgnoreMouseEvents(true)
  window.setMenuBarVisibility(false)
  window.on('closed', () => {
    if (trayPopupWindow === window) trayPopupWindow = null
  })
  window.webContents.on('did-finish-load', () => {
    if (trayHovered) showTrayPopup()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=tray`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'tray' } })
  }
}

function positionTaskbarWindow(): void {
  if (!taskbarWindow || taskbarWindow.isDestroyed()) return

  const display = screen.getPrimaryDisplay()
  const taskbarTop = display.workArea.y + display.workArea.height
  const displayBottom = display.bounds.y + display.bounds.height
  const taskbarHeight = displayBottom - taskbarTop
  const selectedCount = taskbarVisibleStocks().length

  if ((!state.settings.showTaskbarTicker && !hasActiveTaskbarAlert()) || selectedCount === 0 || taskbarHeight < 24) {
    taskbarWindow.hide()
    return
  }

  const columns = Math.ceil(selectedCount / 2)
  const availableWidth = Math.max(280, Math.floor(display.bounds.width / 2 - 110))
  const width = Math.min(availableWidth, Math.max(280, columns * 260))
  const horizontalMargin = 24
  const travelWidth = Math.max(0, display.bounds.width - width - horizontalMargin * 2)
  const positionPercent = Math.min(100, Math.max(0, state.settings.taskbarPositionPercent))
  const x = display.bounds.x + horizontalMargin + Math.round(travelWidth * positionPercent / 100)
  taskbarLayout = { taskbarHeight }

  taskbarWindow.setBounds({
    x,
    y: taskbarTop,
    width,
    height: taskbarHeight
  })
  taskbarWindow.webContents.send('taskbar:layout', taskbarLayout)
  taskbarWindow.setAlwaysOnTop(true, 'pop-up-menu')
  taskbarWindow.showInactive()
}

function createTaskbarWindow(): void {
  if (taskbarWindow && !taskbarWindow.isDestroyed()) return

  const window = new BrowserWindow({
    width: 280,
    height: 158,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  taskbarWindow = window

  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.setIgnoreMouseEvents(true)
  window.setMenuBarVisibility(false)
  window.on('closed', () => {
    if (taskbarWindow === window) taskbarWindow = null
  })
  window.webContents.on('did-finish-load', () => {
    syncTaskbarWindow()
    setTimeout(positionTaskbarWindow, 100)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=taskbar`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'taskbar' } })
  }
}

function syncTaskbarWindow(): void {
  const shouldShow = taskbarVisibleStocks().length > 0
    && (state.settings.showTaskbarTicker || hasActiveTaskbarAlert())

  if (!shouldShow) {
    if (taskbarWindow && !taskbarWindow.isDestroyed()) taskbarWindow.hide()
    return
  }

  if (!taskbarWindow || taskbarWindow.isDestroyed()) {
    createTaskbarWindow()
    return
  }

  positionTaskbarWindow()
}

function mergeQuotes(refreshedQuotes: StockQuote[]): void {
  const quoteMap = new Map(latestQuotes.map((quote) => [quote.quoteId, quote]))
  for (const quote of refreshedQuotes) {
    const previous = quoteMap.get(quote.quoteId)
    quoteMap.set(quote.quoteId, {
      ...quote,
      sector: quote.sector ?? previous?.sector,
      fiveLevelLargeOrders: quote.fiveLevelLargeOrders ?? previous?.fiveLevelLargeOrders
    })
  }
  const displayedStocks = [...state.watchlist, ...getMarketIndexStocks(state.settings.marketIndexIds)]
  latestQuotes = displayedStocks.flatMap((stock) => {
    const quote = quoteMap.get(stock.quoteId)
    return quote ? [quote] : []
  })
  clearFiveLevelLargeOrdersFromInactiveTStocks()
}

function clearFiveLevelLargeOrdersFromInactiveTStocks(): boolean {
  const activeTQuoteIds = new Set(
    Object.values(state.tTradingAccounts)
      .filter((account) => Boolean(account.activeBatch))
      .map((account) => account.quoteId)
  )
  let changed = false
  latestQuotes = latestQuotes.map((quote) => {
    if (activeTQuoteIds.has(quote.quoteId) || quote.fiveLevelLargeOrders === undefined) return quote
    changed = true
    return { ...quote, fiveLevelLargeOrders: undefined }
  })
  return changed
}

async function refreshFiveLevelLargeOrders(stocks: WatchStock[]): Promise<void> {
  const tTradingStocks = stocks.filter((stock) => Boolean(state.tTradingAccounts[stock.quoteId]?.activeBatch))
  if (tTradingStocks.length === 0) return
  const stock = tTradingStocks[fiveLevelRefreshCursor % tTradingStocks.length]
  fiveLevelRefreshCursor = (fiveLevelRefreshCursor + 1) % tTradingStocks.length
  try {
    const orderBook = await orderBookHub.get(stock.quoteId, {
      maxAgeMilliseconds: 3_000,
      allowStaleOnError: false,
      caller: 't-position-large-orders'
    })
    const alerts = detectFiveLevelLargeOrders(orderBook)
    latestQuotes = latestQuotes.map((quote) => (
      quote.quoteId === stock.quoteId
        ? { ...quote, fiveLevelLargeOrders: alerts }
        : quote
    ))
    sendToWindows('quotes:updated', latestQuotes)
    updateAppTrayMenu()
    syncTaskbarWindow()
  } catch {}
}

function uniqueStocks(stocks: readonly WatchStock[]): WatchStock[] {
  return [...new Map(stocks.map((stock) => [stock.quoteId, stock])).values()]
}

function applyCachedSectorQuotes(): void {
  if (!sectorMarketCache) return
  const stockQuoteIds = new Set(state.watchlist.map((stock) => stock.quoteId))
  latestQuotes = latestQuotes.map((quote) => {
    if (!stockQuoteIds.has(quote.quoteId)) return quote
    const sector = sectorMarketCache!.sectorQuote(quote.quoteId)
    return sector ? { ...quote, sector } : quote
  })
}

async function executeQuoteRefresh(batch: QuoteRefreshBatch): Promise<StockQuote[]> {
  const refreshAllStocks = batch.scopes.has('all')
  const refreshPriority = refreshAllStocks || batch.scopes.has('priority')
  const refreshRegular = refreshAllStocks || batch.scopes.has('regular')
  const stocks = state.watchlist.filter((stock) => (
    stock.isPriority ? refreshPriority : refreshRegular
  ))
  const marketIndices = refreshRegular
    ? getMarketIndexStocks(state.settings.marketIndexIds)
    : []
  const dueSectorStocks = sectorMarketCache?.dueBoardStocks(stocks) ?? []
  const requestedSectorStocks = [...batch.sectorQuoteIds].flatMap((quoteId) => {
    const stock = sectorMarketCache?.boardStockByQuoteId(quoteId)
    return stock ? [stock] : []
  })
  const sectorStocks = uniqueStocks([...dueSectorStocks, ...requestedSectorStocks])
  const requestedStocks = uniqueStocks([...stocks, ...marketIndices, ...sectorStocks])
  if (requestedStocks.length === 0) return latestQuotes

  const startedAt = Date.now()
  const reasons = [...batch.reasons]
  try {
    const result = await fetchQuotes(
      requestedStocks,
      state.watchlist.filter((stock) => stock.showRadarSignals),
      `quote-cycle:${reasons.join('+')}`
    )
    const sectorQuoteIds = new Set(sectorStocks.map((stock) => stock.quoteId))
    sectorMarketCache?.saveQuotes(result.quotes.filter((quote) => sectorQuoteIds.has(quote.quoteId)))
    const displayedQuoteIds = new Set([...stocks, ...marketIndices].map((stock) => stock.quoteId))
    mergeQuotes(result.quotes.filter((quote) => displayedQuoteIds.has(quote.quoteId)))
    applyCachedSectorQuotes()
    marketDataHub.publish(latestQuotes)
    const tAlertUpdate = applyTAlertTriggersToAccounts(state.tTradingAccounts, latestQuotes)
    const stockAlertUpdate = applyStockAlertTriggers(
      state.watchlist,
      latestQuotes,
      tAlertUpdate.accounts
    )
    if (tAlertUpdate.changed || stockAlertUpdate.changed) {
      state = {
        ...state,
        watchlist: stockAlertUpdate.watchlist,
        tTradingAccounts: tAlertUpdate.accounts
      }
      persistState()
      sendToWindows('state:updated', state)
    }
    stockAlertUpdate.triggered.forEach(showStockAlertNotification)
    sendToWindows('quotes:updated', latestQuotes)
    updateAppTrayMenu()
    syncTaskbarWindow()
    if (stocks.length > 0) void refreshFiveLevelLargeOrders(stocks)
    marketRequestLogger?.logQuoteCycle({
      reasons,
      stockCount: stocks.length,
      indexCount: marketIndices.length,
      sectorCount: sectorStocks.length,
      requestedCount: requestedStocks.length,
      returnedCount: result.quotes.length,
      durationMs: Date.now() - startedAt,
      source: result.source,
      fallbackUsed: result.source !== 'eastmoney-primary'
    })
    if (Date.now() - lastSectorBindingPrimeAt >= 60_000) void primeSectorBindings(true)
    return latestQuotes
  } catch (error) {
    const message = error instanceof Error ? error.message : '行情刷新失败'
    marketRequestLogger?.logQuoteCycle({
      reasons,
      stockCount: stocks.length,
      indexCount: marketIndices.length,
      sectorCount: sectorStocks.length,
      requestedCount: requestedStocks.length,
      returnedCount: 0,
      durationMs: Date.now() - startedAt,
      error: message
    })
    sendToWindows('data:error', message)
    return latestQuotes
  }
}

function refreshAll(reason = 'manual'): Promise<StockQuote[]> {
  return quoteRefreshCoordinator?.request({ scope: 'all', reason }) ?? Promise.resolve(latestQuotes)
}

function isMainMarketAutoRefreshTime(): boolean {
  return isBeijingAutoRefreshTime(new Date(), state.settings.tradingCalendar.closedDates)
}

function refreshAllAutomatically(reason = 'automatic'): Promise<StockQuote[]> {
  return isMainMarketAutoRefreshTime() ? refreshAll(reason) : Promise.resolve(latestQuotes)
}

function primeSectorBindings(refreshWhenReady: boolean): Promise<void> {
  if (!sectorMarketCache) return Promise.resolve()
  if (sectorBindingPrime) return sectorBindingPrime
  lastSectorBindingPrimeAt = Date.now()
  sectorBindingPrime = sectorMarketCache.prime(state.watchlist)
    .then((changed) => {
      if (!changed || !refreshWhenReady || !isMainMarketAutoRefreshTime()) return
      const sectorQuoteIds = sectorMarketCache!.dueBoardStocks(state.watchlist).map((stock) => stock.quoteId)
      if (sectorQuoteIds.length > 0) {
        void quoteRefreshCoordinator?.request({ reason: 'sector-binding', sectorQuoteIds })
      }
    })
    .finally(() => {
      sectorBindingPrime = null
    })
  return sectorBindingPrime
}

function saveTradingCalendar(calendar: TradingCalendarSettings): TradingCalendarSettings {
  state = {
    ...state,
    settings: {
      ...state.settings,
      tradingCalendar: normalizeTradingCalendarSettings(calendar)
    }
  }
  persistState()
  sendToWindows('state:updated', state)
  return state.settings.tradingCalendar
}

function refreshTradingCalendar(): Promise<TradingCalendarSettings> {
  if (tradingCalendarRefresh) return tradingCalendarRefresh

  const year = new Date().getFullYear()
  const attemptedAt = new Date().toISOString()
  const request = () => fetchSseTradingCalendar(year)
  tradingCalendarRefresh = (marketRequestLogger
    ? marketRequestLogger.track({
        dataType: 'trading-calendar',
        caller: 'trading-calendar',
        source: 'sse',
        requestedCount: 1
      }, request, (result) => result.closedDates.length)
    : request())
    .then((result) => {
      const current = state.settings.tradingCalendar
      const closedDates = [
        ...current.closedDates.filter((date) => !date.startsWith(`${result.year}-`)),
        ...result.closedDates
      ].sort()
      return saveTradingCalendar({
        ...current,
        closedDates,
        coveredThroughYear: Math.max(current.coveredThroughYear, result.year),
        lastRefreshedAt: new Date().toISOString(),
        lastCheckedYear: result.year,
        lastAttemptedAt: attemptedAt,
        lastError: null
      })
    })
    .catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : '交易日历刷新失败'
      saveTradingCalendar({
        ...state.settings.tradingCalendar,
        lastCheckedYear: year,
        lastAttemptedAt: attemptedAt,
        lastError: message
      })
      throw new Error(message)
    })
    .finally(() => {
      tradingCalendarRefresh = null
    })
  return tradingCalendarRefresh
}

function refreshTradingCalendarAutomatically(): Promise<TradingCalendarSettings> {
  const year = new Date().getFullYear()
  if (state.settings.tradingCalendar.lastCheckedYear === year) {
    return Promise.resolve(state.settings.tradingCalendar)
  }
  return refreshTradingCalendar()
}

function restartRefreshTimers(): void {
  quoteRefreshCoordinator?.restartSchedule()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#334155',
      height: 44
    },
    icon: createAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })
  mainWindow.on('close', (event) => {
    if (!isQuitting && state.settings.minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function getSectorIndex(stockQuoteId: string) {
  if (!sectorMarketCache || !quoteRefreshCoordinator) throw new Error('板块行情缓存尚未初始化')
  const binding = await sectorMarketCache.ensureBinding(stockQuoteId)
  const cachedQuote = sectorMarketCache.getFreshQuote(binding.boardQuoteId)
  const quotePromise = cachedQuote
    ? Promise.resolve(cachedQuote)
    : quoteRefreshCoordinator.request({
        reason: 'detail:sector',
        sectorQuoteIds: [binding.boardQuoteId]
      }).then(() => sectorMarketCache!.getFreshQuote(binding.boardQuoteId))
  const trendPromise = getKline(
    binding.boardQuoteId,
    'intraday',
    undefined,
    'detail:sector'
  )
  const [quote, trend] = await Promise.all([quotePromise, trendPromise])
  if (!quote) throw new Error('行情服务未返回板块指数数据')
  return {
    stockQuoteId,
    boardCode: binding.boardCode,
    boardName: binding.boardName,
    boardQuoteId: binding.boardQuoteId,
    quote,
    trend
  }
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async () => ({ state, quotes: latestQuotes, source: 'eastmoney' as const }))
  ipcMain.handle('taskbar:layout:get', () => taskbarLayout)
  ipcMain.handle('stocks:search', (_event, query: string) => searchStocks(query))
  ipcMain.handle('quotes:refresh', () => refreshAll('manual'))
  ipcMain.handle('kline:get', (_event, quoteId: string, period: KlinePeriod, limit?: number) => (
    getKline(quoteId, period, limit, `detail:kline:${period}`)
  ))
  ipcMain.handle('chip-distribution:cache:save', (_event, entry: ChipDistributionCacheEntry) => {
    if (!chipDistributionCache) throw new Error('筹码分布缓存尚未初始化')
    return chipDistributionCache.save(entry)
  })
  ipcMain.handle('order-book:get', (_event, quoteId: string) => orderBookHub.get(quoteId, {
    maxAgeMilliseconds: 3_000,
    allowStaleOnError: true,
    caller: 'detail:order-book'
  }))
  ipcMain.handle('funds-flow:get', (_event, quoteId: string) => getFundsFlow(quoteId, 'detail:funds-flow'))
  ipcMain.handle('sector-index:get', (_event, quoteId: string) => getSectorIndex(quoteId))
  ipcMain.handle('trading-calendar:refresh', () => refreshTradingCalendar())
  ipcMain.handle('state:save', async (_event, nextState: AppState) => {
    const normalizedState: AppState = {
      ...nextState,
      watchlist: normalizeWatchlist(nextState.watchlist),
      watchlistGroups: normalizeWatchlistGroups(nextState.watchlistGroups),
      settings: normalizeAppSettings(nextState.settings),
      columnOrder: normalizeWatchlistColumnOrder(nextState.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(nextState.tTradingAccounts)
    }
    const refreshSettingsChanged = state.settings.priorityRefreshSeconds !== normalizedState.settings.priorityRefreshSeconds
      || state.settings.regularRefreshSeconds !== normalizedState.settings.regularRefreshSeconds
    const marketIndicesChanged = state.settings.marketIndexIds.join(',') !== normalizedState.settings.marketIndexIds.join(',')
    const startWithWindowsChanged = state.settings.startWithWindows !== normalizedState.settings.startWithWindows
    const watchedStocksChanged = state.watchlist.length !== normalizedState.watchlist.length
      || state.watchlist.some((stock) => !normalizedState.watchlist.some((nextStock) => nextStock.quoteId === stock.quoteId))
    const priorityChanged = state.watchlist.some((stock) => (
      normalizedState.watchlist.find((nextStock) => nextStock.quoteId === stock.quoteId)?.isPriority !== stock.isPriority
    ))
    const stockAlertUpdate = applyStockAlertTriggers(
      normalizedState.watchlist,
      latestQuotes,
      normalizedState.tTradingAccounts
    )
    state = { ...normalizedState, watchlist: stockAlertUpdate.watchlist }
    const fiveLevelAlertsCleared = clearFiveLevelLargeOrdersFromInactiveTStocks()
    persistState()
    if (startWithWindowsChanged) {
      app.setLoginItemSettings({ openAtLogin: state.settings.startWithWindows })
    }
    if (refreshSettingsChanged) restartRefreshTimers()
    sendToWindows('state:updated', state)
    if (fiveLevelAlertsCleared) sendToWindows('quotes:updated', latestQuotes)
    updateAppTrayMenu()
    syncTaskbarWindow()
    if (trayPopupWindow?.isVisible()) positionTrayPopupWindow()
    if (watchedStocksChanged) void primeSectorBindings(true)
    if (marketIndicesChanged) void refreshAll('state-change:indices')
    else if (watchedStocksChanged || priorityChanged) void refreshAllAutomatically('state-change:watchlist')
    stockAlertUpdate.triggered.forEach(showStockAlertNotification)
    return state
  })
  ipcMain.handle('config:export', async (_event, stateToExport: AppState) => {
    const options: SaveDialogOptions = {
      title: '导出见涨配置',
      defaultPath: join(app.getPath('documents'), `见涨-配置-${configTimestamp()}.json`),
      filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
    }
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
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { canceled: true }

    const importedState = parseConfigDocument(JSON.parse(readFileSync(filePath, 'utf8')))
    return { canceled: false, filePath, state: importedState }
  })
  ipcMain.handle('app:hide', () => mainWindow?.hide())
  ipcMain.handle('app:quit', quitApp)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
    syncTaskbarWindow()
    void refreshAllAutomatically('second-instance')
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.jianzhang.stock')
    state = loadState()
    const marketCacheDirectory = join(app.getPath('userData'), 'market-cache')
    marketRequestLogger = new MarketRequestLogger(join(app.getPath('userData'), 'logs'))
    setMarketRequestLogger(marketRequestLogger)
    chipDistributionCache = new ChipDistributionCache(marketCacheDirectory)
    fundsFlowHub = new FundsFlowHub(
      fetchFundsFlow,
      FUNDS_FLOW_REFRESH_MILLISECONDS
    )
    historicalKlineCache = new HistoricalKlineCache(marketCacheDirectory)
    intradayKlineHub = new IntradayKlineHub(
      (quoteId, caller) => fetchKline(quoteId, 'intraday', undefined, caller),
      INTRADAY_REFRESH_MILLISECONDS
    )
    sectorMarketCache = new SectorMarketCache(
      marketCacheDirectory,
      (quoteId) => fetchSectorBinding(quoteId, 'sector-binding-cache')
    )
    quoteRefreshCoordinator = new QuoteRefreshCoordinator<StockQuote[]>({
      getPriorityIntervalMilliseconds: () => state.settings.priorityRefreshSeconds * 1000,
      getRegularIntervalMilliseconds: () => state.settings.regularRefreshSeconds * 1000,
      canAutoRefresh: isMainMarketAutoRefreshTime,
      run: executeQuoteRefresh
    })
    registerIpc()
    if (__JIANZHANG_MARKET_INSIGHT_ENABLED__) {
      const { installMarketInsight } = await import('../../src/modules/market-insight/main/register')
      marketInsightRuntime = installMarketInsight({
        marketDataHub,
        getState: () => state,
        getKline: (quoteId, period, limit) => getKline(quoteId, period, limit, 'market-insight'),
        getOrderBook: (quoteId) => orderBookHub.get(quoteId, {
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
        refreshMarketInsightSnapshot: (quoteId) => marketInsightRuntime?.refreshSnapshot(quoteId) ?? null,
        getChipDistributionCache: (quoteId) => chipDistributionCache?.get(quoteId) ?? null
      })

      if (__JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__) {
        const { installAiTAdvice } = await import('../../src/modules/ai-t-advice/main/register')
        aiTAdviceRuntime = installAiTAdvice({
          refreshMarketInsightSnapshot: (quoteId) => marketInsightRuntime?.refreshSnapshot(quoteId) ?? null,
          getChipDistributionCache: (quoteId) => chipDistributionCache?.get(quoteId) ?? null,
          getTradingContext: (quoteId) => {
            const stock = state.watchlist.find((item) => item.quoteId === quoteId)
            if (!stock) return null
            return {
              stock,
              quote: latestQuotes.find((item) => item.quoteId === quoteId),
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
            updateAppTrayMenu()
            syncTaskbarWindow()
          },
          runStructuredTask: (request, signal) => aiRuntime!.runStructuredTask(request, signal)
        })
      }
    }
    createWindow()
    syncTaskbarWindow()

    appTray = new Tray(createAppIcon())
    appTray.on('click', () => {
      setTrayHovered(false)
      showMainWindow()
    })
    appTray.on('mouse-enter', () => setTrayHovered(true))
    appTray.on('mouse-move', () => setTrayHovered(true))
    appTray.on('mouse-leave', () => setTrayHovered(false))
    updateAppTrayMenu()
    screen.on('display-metrics-changed', () => {
      syncTaskbarWindow()
      if (trayPopupWindow?.isVisible()) positionTrayPopupWindow()
    })
    screen.on('display-added', syncTaskbarWindow)
    screen.on('display-removed', syncTaskbarWindow)
    quoteRefreshCoordinator.start()
    tradingCalendarCheckTimer = setInterval(
      () => void refreshTradingCalendarAutomatically().catch(() => undefined),
      6 * 60 * 60 * 1000
    )
    void refreshAllAutomatically('startup')
    void primeSectorBindings(true)
    void refreshTradingCalendarAutomatically().catch(() => undefined)
  })
}

app.on('before-quit', () => {
  cleanupBeforeQuit()
})

app.on('window-all-closed', () => {
  if (!state.settings.minimizeToTray) app.quit()
})
