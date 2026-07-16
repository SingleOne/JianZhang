import { app, BrowserWindow, ipcMain, Menu, screen, Tray } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  normalizeWatchlistColumnOrder,
  type AppState,
  type StockQuote,
  type WatchStock
} from '../../src/shared/types'
import { fetchKline, fetchQuotes, searchStocks } from './market'
import { createAppIcon } from './tray-icons'

const DEFAULT_WATCHLIST: WatchStock[] = [
  { code: '600519', name: '贵州茅台', quoteId: '1.600519', marketLabel: '沪A', showInTaskbar: true },
  { code: '300750', name: '宁德时代', quoteId: '0.300750', marketLabel: '深A', showInTaskbar: true },
  { code: '002594', name: '比亚迪', quoteId: '0.002594', marketLabel: '深A', showInTaskbar: false },
  { code: '600030', name: '中信证券', quoteId: '1.600030', marketLabel: '沪A', showInTaskbar: false },
  { code: '600036', name: '招商银行', quoteId: '1.600036', marketLabel: '沪A', showInTaskbar: false }
]

const DEFAULT_STATE: AppState = {
  watchlist: DEFAULT_WATCHLIST,
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  settings: {
    refreshSeconds: 5,
    startWithWindows: false,
    minimizeToTray: true,
    showTaskbarTicker: true,
    taskbarPositionPercent: 0
  }
}

let mainWindow: BrowserWindow | null = null
let taskbarWindow: BrowserWindow | null = null
let appTray: Tray | null = null
let state: AppState = DEFAULT_STATE
let latestQuotes: StockQuote[] = []
let refreshTimer: NodeJS.Timeout | null = null
let refreshInFlight = false
let isQuitting = false

function statePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadState(): AppState {
  try {
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as AppState
    return {
      watchlist: saved.watchlist ?? DEFAULT_WATCHLIST,
      settings: { ...DEFAULT_STATE.settings, ...saved.settings },
      columnOrder: normalizeWatchlistColumnOrder(saved.columnOrder)
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function persistState(): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const window of [mainWindow, taskbarWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function formatPrice(value: number | null): string {
  if (value === null) return '--'
  return value >= 100 ? value.toFixed(2) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function formatPercent(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function showMainWindow(quoteId?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.restore()
  mainWindow.focus()
  if (quoteId) {
    mainWindow.webContents.send('stock:selected', quoteId)
  }
}

function cleanupBeforeQuit(): void {
  isQuitting = true
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  appTray?.destroy()
  appTray = null
  taskbarWindow?.destroy()
  taskbarWindow = null
}

function quitApp(): void {
  cleanupBeforeQuit()
  app.quit()
}

function updateAppTrayMenu(): void {
  if (!appTray) return

  const selectedItems = state.watchlist
    .filter((stock) => stock.showInTaskbar)
    .map((stock) => {
      const quote = latestQuotes.find((item) => item.quoteId === stock.quoteId)
      return {
        label: `${stock.name}  ${formatPrice(quote?.latest ?? null)}  ${formatPercent(quote?.changePercent ?? null)}`,
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

function positionTaskbarWindow(): void {
  if (!taskbarWindow || taskbarWindow.isDestroyed()) return

  const display = screen.getPrimaryDisplay()
  const taskbarTop = display.workArea.y + display.workArea.height
  const displayBottom = display.bounds.y + display.bounds.height
  const taskbarHeight = displayBottom - taskbarTop
  const selectedCount = state.watchlist.filter((stock) => stock.showInTaskbar).length

  if (!state.settings.showTaskbarTicker || selectedCount === 0 || taskbarHeight < 24) {
    taskbarWindow.hide()
    return
  }

  const columns = Math.ceil(selectedCount / 2)
  const availableWidth = Math.max(280, Math.floor(display.bounds.width / 2 - 110))
  const width = Math.min(availableWidth, Math.max(280, columns * 230))
  const horizontalMargin = 24
  const travelWidth = Math.max(0, display.bounds.width - width - horizontalMargin * 2)
  const positionPercent = Math.min(100, Math.max(0, state.settings.taskbarPositionPercent))

  taskbarWindow.setBounds({
    x: display.bounds.x + horizontalMargin + Math.round(travelWidth * positionPercent / 100),
    y: taskbarTop,
    width,
    height: taskbarHeight
  })
  taskbarWindow.setAlwaysOnTop(true, 'pop-up-menu')
  taskbarWindow.showInactive()
}

function createTaskbarWindow(): void {
  if (taskbarWindow && !taskbarWindow.isDestroyed()) return

  const window = new BrowserWindow({
    width: 280,
    height: 48,
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
  window.webContents.on('did-finish-load', syncTaskbarWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=taskbar`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'taskbar' } })
  }
}

function syncTaskbarWindow(): void {
  const shouldShow = state.settings.showTaskbarTicker
    && state.watchlist.some((stock) => stock.showInTaskbar)

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

async function refreshAll(): Promise<StockQuote[]> {
  if (refreshInFlight) return latestQuotes
  refreshInFlight = true

  try {
    latestQuotes = await fetchQuotes(state.watchlist)
    sendToWindows('quotes:updated', latestQuotes)
    updateAppTrayMenu()
    syncTaskbarWindow()
    return latestQuotes
  } catch (error) {
    const message = error instanceof Error ? error.message : '行情刷新失败'
    sendToWindows('data:error', message)
    return latestQuotes
  } finally {
    refreshInFlight = false
  }
}

function restartRefreshTimer(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = setInterval(() => void refreshAll(), state.settings.refreshSeconds * 1000)
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
  mainWindow.on('ready-to-show', () => mainWindow?.show())
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

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async () => ({ state, quotes: latestQuotes, source: 'eastmoney' as const }))
  ipcMain.handle('stocks:search', (_event, query: string) => searchStocks(query))
  ipcMain.handle('quotes:refresh', () => refreshAll())
  ipcMain.handle('kline:get', (_event, quoteId: string) => fetchKline(quoteId))
  ipcMain.handle('state:save', async (_event, nextState: AppState) => {
    const refreshSecondsChanged = state.settings.refreshSeconds !== nextState.settings.refreshSeconds
    const startWithWindowsChanged = state.settings.startWithWindows !== nextState.settings.startWithWindows
    const watchedStocksChanged = state.watchlist.length !== nextState.watchlist.length
      || state.watchlist.some((stock) => !nextState.watchlist.some((nextStock) => nextStock.quoteId === stock.quoteId))
    state = nextState
    persistState()
    if (startWithWindowsChanged) {
      app.setLoginItemSettings({ openAtLogin: state.settings.startWithWindows })
    }
    if (refreshSecondsChanged) restartRefreshTimer()
    sendToWindows('state:updated', state)
    updateAppTrayMenu()
    syncTaskbarWindow()
    if (watchedStocksChanged) void refreshAll()
    return state
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
    void refreshAll()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.jianzhang.stock')
    state = loadState()
    registerIpc()
    createWindow()
    syncTaskbarWindow()

    appTray = new Tray(createAppIcon())
    appTray.setToolTip('见涨 · 实时股票行情')
    appTray.on('click', () => showMainWindow())
    updateAppTrayMenu()
    screen.on('display-metrics-changed', syncTaskbarWindow)
    screen.on('display-added', syncTaskbarWindow)
    screen.on('display-removed', syncTaskbarWindow)
    restartRefreshTimer()
    void refreshAll()
  })
}

app.on('before-quit', () => {
  cleanupBeforeQuit()
})

app.on('window-all-closed', () => {
  if (!state.settings.minimizeToTray) app.quit()
})
