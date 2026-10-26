import { app, BrowserWindow, Menu, MenuItem, nativeTheme, screen, Tray } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTaskbarVisibleStocks, shouldShowTaskbarTicker } from '../../src/lib/taskbar-visibility'
import type {
  AppState,
  AutoRefreshQuoteScope,
  StockSelectionRequest,
  StockQuote,
  TaskbarLayout,
  TaskbarTooltipAnchor,
  WatchStock
} from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import { createAppIcon } from './tray-icons'
import { MacMenuBar } from './mac-menu-bar'

const TASKBAR_TOOLTIP_WIDTH = 550
const TASKBAR_TOOLTIP_DEFAULT_HEIGHT = 260
// Keep in sync with --floating-window-shadow-padding in TaskbarTicker.css.
const FLOATING_WINDOW_SHADOW_PADDING = 24
const MAIN_WINDOW_TITLEBAR_HEIGHT = 44
const MAIN_WINDOW_THEME_COLORS = {
  light: {
    background: '#f5f5f7',
    titleBar: '#f5f5f7',
    symbols: '#3a3a3c'
  },
  dark: {
    background: '#1c1c1e',
    titleBar: '#252528',
    symbols: '#f5f5f7'
  }
} as const

interface WindowManagerDependencies {
  getState: () => AppState
  getQuotes: () => StockQuote[]
  setMenuBarQuoteId: (quoteId: string) => void
  isQuitting: () => boolean
  refreshQuotes: () => Promise<unknown>
  setAutoRefreshQuotes: (scope: AutoRefreshQuoteScope) => void
  quit: () => void
}

interface MainWindowState {
  visible: boolean
  taskbarMode: boolean
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private taskbarWindow: BrowserWindow | null = null
  private taskbarTooltipWindow: BrowserWindow | null = null
  private trayPopupWindow: BrowserWindow | null = null
  private appTray: Tray | null = null
  private macMenuBar: MacMenuBar | null = null
  private trayPopupShowTimer: NodeJS.Timeout | null = null
  private taskbarLayout: TaskbarLayout = { taskbarHeight: 48, taskbarEdge: 'bottom' }
  private taskbarContentSize: { width: number; height: number } | null = null
  private taskbarTooltipAnchor: TaskbarTooltipAnchor | null = null
  private taskbarTooltipHeight = TASKBAR_TOOLTIP_DEFAULT_HEIGHT + FLOATING_WINDOW_SHADOW_PADDING * 2
  private trayHovered = false
  private disposed = false
  private stockSelectionSequence = 0
  private readonly windowStatePath: string
  private mainWindowVisible: boolean
  private taskbarMode: boolean
  private mainWindowReady = false
  private mainWindowHasBeenShown = false
  private mainWindowSelectionReady = false
  private pendingStockSelection: StockSelectionRequest | null = null

  private readonly handleDisplayMetricsChanged = (): void => {
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  private readonly handleDisplayChanged = (): void => {
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  private readonly handleNativeThemeUpdated = (): void => {
    this.syncMainWindowTheme()
  }

  constructor(
    private readonly dependencies: WindowManagerDependencies,
    userDataDirectory: string
  ) {
    this.windowStatePath = join(userDataDirectory, 'window-state.json')
    const windowState = this.loadMainWindowState()
    this.mainWindowVisible = windowState.visible
    this.taskbarMode = windowState.taskbarMode
  }

  create(): void {
    this.syncNativeThemeSource()
    this.syncMacActivationPolicy()
    if (!this.taskbarMode) this.createMainWindow()
    if (process.platform === 'darwin') {
      this.macMenuBar = new MacMenuBar(this.dependencies)
      this.updateTrayMenu()
    } else {
      this.createTray()
    }
    this.syncTaskbarWindow()
    nativeTheme.on('updated', this.handleNativeThemeUpdated)
    screen.on('display-metrics-changed', this.handleDisplayMetricsChanged)
    screen.on('display-added', this.handleDisplayChanged)
    screen.on('display-removed', this.handleDisplayChanged)
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  isTaskbarMode(): boolean {
    return this.taskbarMode
  }

  getTaskbarLayout(): TaskbarLayout {
    return this.taskbarLayout
  }

  getTaskbarTooltipQuoteId(): string | null {
    return this.taskbarTooltipAnchor?.quoteId ?? null
  }

  resizeTaskbarTicker(width: number, height: number): void {
    const nextSize = {
      width: Math.max(1, Math.ceil(width)),
      height: Math.max(1, Math.ceil(height))
    }
    if (
      this.taskbarContentSize?.width === nextSize.width &&
      this.taskbarContentSize.height === nextSize.height
    ) {
      return
    }
    this.taskbarContentSize = nextSize
    this.positionTaskbarWindow()
  }

  setTaskbarTooltip(anchor: TaskbarTooltipAnchor | null): void {
    if (process.platform === 'darwin') return
    this.taskbarTooltipAnchor = anchor
    if (!anchor) {
      if (this.taskbarTooltipWindow && !this.taskbarTooltipWindow.isDestroyed()) {
        this.taskbarTooltipWindow.webContents.send('taskbar:tooltip-stock', null)
        this.taskbarTooltipWindow.hide()
      }
      return
    }

    if (!this.taskbarTooltipWindow || this.taskbarTooltipWindow.isDestroyed()) {
      this.createTaskbarTooltipWindow()
      return
    }

    this.showTaskbarTooltipWindow()
  }

  resizeTaskbarTooltip(height: number): void {
    if (process.platform === 'darwin') return
    const shadowHeight = FLOATING_WINDOW_SHADOW_PADDING * 2
    const display = this.taskbarWindow
      ? screen.getDisplayMatching(this.taskbarWindow.getBounds())
      : screen.getPrimaryDisplay()
    const nextHeight = Math.min(
      display.workArea.height - 16,
      Math.max(200 + shadowHeight, Math.ceil(height))
    )
    if (this.taskbarTooltipHeight === nextHeight) return
    this.taskbarTooltipHeight = nextHeight
    if (this.taskbarTooltipWindow?.isVisible()) this.positionTaskbarTooltipWindow()
  }

  showMainWindow(
    quoteId?: string,
    scrollAlignment?: StockSelectionRequest['scrollAlignment'],
    detailTarget?: StockSelectionRequest['detailTarget']
  ): void {
    if (this.disposed || this.dependencies.isQuitting()) return
    this.macMenuBar?.hidePanel()
    if (quoteId) {
      this.stockSelectionSequence += 1
      this.pendingStockSelection = {
        id: `${Date.now()}-${this.stockSelectionSequence}`,
        quoteId,
        scrollAlignment,
        detailTarget
      }
    }
    this.saveMainWindowState(true, false)
    this.syncMacActivationPolicy()
    this.updateTrayMenu()
    const window = this.getMainWindow()
    if (!window) {
      this.createMainWindow()
      return
    }
    if (!this.mainWindowReady) return
    if (!this.mainWindowHasBeenShown) {
      this.mainWindowHasBeenShown = true
      window.maximize()
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    this.sendPendingStockSelection()
  }

  hideMainWindow(): void {
    const window = this.getMainWindow()
    if (!window) return
    window.hide()
    this.saveMainWindowState(false)
  }

  private setTaskbarMode(enabled: boolean): void {
    if (!enabled) {
      this.showMainWindow()
      return
    }
    this.saveMainWindowState(false, true)
    this.pendingStockSelection = null
    this.getMainWindow()?.destroy()
    this.syncMacActivationPolicy()
    this.updateTrayMenu()
  }

  private sendPendingStockSelection(): void {
    const window = this.getMainWindow()
    if (!window || !this.mainWindowSelectionReady || !this.pendingStockSelection) return
    window.webContents.send('stock:selected', this.pendingStockSelection)
    this.pendingStockSelection = null
  }

  sendToWindows(channel: string, payload: unknown): void {
    this.macMenuBar?.send(channel, payload)
    for (const window of [
      this.mainWindow,
      this.taskbarWindow,
      this.taskbarTooltipWindow,
      this.trayPopupWindow
    ]) {
      if (!window || window.isDestroyed()) continue
      if (window === this.taskbarTooltipWindow && !window.isVisible()) continue
      window.webContents.send(channel, payload)
    }
  }

  sync(): void {
    this.syncMainWindowTheme()
    this.updateTrayMenu()
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  updateTrayMenu(): void {
    if (!this.appTray && !this.macMenuBar) return
    const settings = this.dependencies.getState().settings
    const selectedStocks = this.taskbarVisibleStocks()
    const menu = Menu.buildFromTemplate([
      { label: '打开见涨', click: () => this.showMainWindow() },
      { label: '立即刷新', click: () => void this.dependencies.refreshQuotes() },
      { type: 'separator' },
      {
        label: `${process.platform === 'darwin' ? '仅菜单栏模式' : '任务栏模式'}${this.taskbarMode ? '  ✓' : ''}`,
        click: () => this.setTaskbarMode(!this.taskbarMode)
      },
      {
        label: '自动刷新行情',
        submenu: [
          {
            label: `全部${settings.autoRefreshQuotes && settings.autoRefreshQuoteScope === 'all' ? '  ✓' : ''}`,
            click: () => this.dependencies.setAutoRefreshQuotes('all')
          },
          {
            label: `重点关注${settings.autoRefreshQuotes && settings.autoRefreshQuoteScope === 'priority' ? '  ✓' : ''}`,
            click: () => this.dependencies.setAutoRefreshQuotes('priority')
          }
        ]
      },
      { type: 'separator' },
      { label: '退出', click: this.dependencies.quit }
    ])
    if (this.macMenuBar) {
      const fixedQuoteId = selectedStocks.some((stock) => stock.quoteId === settings.menuBarQuoteId)
        ? settings.menuBarQuoteId
        : selectedStocks[0]?.quoteId
      menu.insert(
        2,
        new MenuItem({
          label: '固定显示股票',
          submenu:
            selectedStocks.length > 0
              ? selectedStocks.map((stock) => ({
                  label: stock.name,
                  type: 'radio' as const,
                  checked: stock.quoteId === fixedQuoteId,
                  click: () => this.dependencies.setMenuBarQuoteId(stock.quoteId)
                }))
              : [{ label: '请先在自选列表中选择展示股票', enabled: false }]
        })
      )
      this.macMenuBar.setMenu(menu)
    } else {
      this.appTray?.setContextMenu(menu)
    }
  }

  syncTaskbarWindow(): void {
    if (process.platform === 'darwin') {
      this.macMenuBar?.sync()
      return
    }
    const state = this.dependencies.getState()
    const shouldShow = shouldShowTaskbarTicker(state.settings.showTaskbarTicker, state.watchlist)

    if (!shouldShow) {
      if (this.taskbarWindow && !this.taskbarWindow.isDestroyed()) this.taskbarWindow.hide()
      this.setTaskbarTooltip(null)
      return
    }

    if (!this.taskbarWindow || this.taskbarWindow.isDestroyed()) {
      this.createTaskbarWindow()
      return
    }

    this.positionTaskbarWindow()
  }

  positionTrayPopupIfVisible(): void {
    this.macMenuBar?.positionPanelIfVisible()
    if (this.trayPopupWindow?.isVisible()) this.positionTrayPopupWindow()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.macMenuBar?.dispose()
    this.macMenuBar = null
    screen.removeListener('display-metrics-changed', this.handleDisplayMetricsChanged)
    screen.removeListener('display-added', this.handleDisplayChanged)
    screen.removeListener('display-removed', this.handleDisplayChanged)
    nativeTheme.removeListener('updated', this.handleNativeThemeUpdated)
    if (this.trayPopupShowTimer) clearTimeout(this.trayPopupShowTimer)
    this.trayPopupShowTimer = null
    this.appTray?.destroy()
    this.appTray = null
    this.trayPopupWindow?.destroy()
    this.trayPopupWindow = null
    this.taskbarTooltipWindow?.destroy()
    this.taskbarTooltipWindow = null
    this.taskbarWindow?.destroy()
    this.taskbarWindow = null
  }

  private taskbarVisibleStocks(): WatchStock[] {
    return getTaskbarVisibleStocks(this.dependencies.getState().watchlist)
  }

  private syncMacActivationPolicy(): void {
    if (process.platform === 'darwin') {
      app.setActivationPolicy(this.taskbarMode ? 'accessory' : 'regular')
    }
  }

  private syncNativeThemeSource(): void {
    const theme = this.dependencies.getState().settings.theme
    if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme
  }

  private mainWindowThemeColors() {
    const preference = this.dependencies.getState().settings.theme
    const dark =
      preference === 'dark' || (preference === 'system' && nativeTheme.shouldUseDarkColors)
    return MAIN_WINDOW_THEME_COLORS[dark ? 'dark' : 'light']
  }

  private syncMainWindowTheme(): void {
    this.syncNativeThemeSource()
    const window = this.getMainWindow()
    if (!window) return
    const colors = this.mainWindowThemeColors()
    window.setBackgroundColor(colors.background)
    if (process.platform !== 'darwin')
      window.setTitleBarOverlay({
        color: colors.titleBar,
        symbolColor: colors.symbols,
        height: MAIN_WINDOW_TITLEBAR_HEIGHT
      })
  }

  closeMenuBarPanel(): void {
    this.macMenuBar?.hidePanel()
  }

  resizeMenuBarPanel(height: number): void {
    this.macMenuBar?.resizePanel(height)
  }

  private loadMainWindowState(): MainWindowState {
    const defaultState: MainWindowState = { visible: true, taskbarMode: false }
    if (!existsSync(this.windowStatePath)) return defaultState
    try {
      const state = JSON.parse(readFileSync(this.windowStatePath, 'utf8')) as {
        visible?: unknown
        taskbarMode?: unknown
      }
      return { visible: state.visible !== false, taskbarMode: state.taskbarMode === true }
    } catch {
      return defaultState
    }
  }

  private saveMainWindowState(visible: boolean, taskbarMode = this.taskbarMode): void {
    if (this.mainWindowVisible === visible && this.taskbarMode === taskbarMode) return
    this.mainWindowVisible = visible
    this.taskbarMode = taskbarMode
    atomicWriteJsonSync(this.windowStatePath, { visible, taskbarMode } satisfies MainWindowState)
  }

  private trayPopupSize(): { width: number; height: number } {
    const selectedCount = this.taskbarVisibleStocks().length
    const columns = selectedCount > 1 ? 2 : 1
    const rows = Math.ceil(selectedCount / columns)
    return {
      width: (columns === 2 ? 638 : 369) + FLOATING_WINDOW_SHADOW_PADDING * 2,
      height: 35 + rows * 78 + FLOATING_WINDOW_SHADOW_PADDING * 2
    }
  }

  private positionTrayPopupWindow(): void {
    if (!this.trayPopupWindow || this.trayPopupWindow.isDestroyed() || !this.appTray) return

    const trayBounds = this.appTray.getBounds()
    const trayCenter = {
      x: trayBounds.x + Math.floor(trayBounds.width / 2),
      y: trayBounds.y + Math.floor(trayBounds.height / 2)
    }
    const display = screen.getDisplayNearestPoint(trayCenter)
    const { width, height: contentHeight } = this.trayPopupSize()
    const margin = 8
    const height = Math.min(contentHeight, display.workArea.height - margin * 2)
    const minX = display.workArea.x + margin
    const maxX = display.workArea.x + display.workArea.width - width - margin
    const x = Math.min(maxX, Math.max(minX, trayCenter.x - Math.floor(width / 2)))
    const workAreaBottom = display.workArea.y + display.workArea.height
    const trayIsBelowWorkArea = trayCenter.y >= workAreaBottom
    const maxY = workAreaBottom - height - margin + FLOATING_WINDOW_SHADOW_PADDING
    const y = trayIsBelowWorkArea
      ? maxY
      : Math.min(
          maxY,
          Math.max(
            display.workArea.y + margin,
            trayBounds.y + trayBounds.height + margin - FLOATING_WINDOW_SHADOW_PADDING
          )
        )

    this.trayPopupWindow.setBounds({ x, y, width, height })
  }

  private hideTrayPopup(): void {
    if (this.trayPopupShowTimer) clearTimeout(this.trayPopupShowTimer)
    this.trayPopupShowTimer = null
    if (this.trayPopupWindow && !this.trayPopupWindow.isDestroyed()) this.trayPopupWindow.hide()
  }

  private showTrayPopup(): void {
    if (!this.trayHovered || this.taskbarVisibleStocks().length === 0) return
    if (!this.trayPopupWindow || this.trayPopupWindow.isDestroyed()) {
      this.createTrayPopupWindow()
      return
    }
    this.positionTrayPopupWindow()
    this.trayPopupWindow.setAlwaysOnTop(true, 'pop-up-menu')
    this.trayPopupWindow.showInactive()
  }

  private setTrayHovered(hovered: boolean): void {
    if (this.trayHovered === hovered) return
    this.trayHovered = hovered
    if (!hovered) {
      this.hideTrayPopup()
      return
    }

    this.trayPopupShowTimer = setTimeout(() => {
      this.trayPopupShowTimer = null
      this.showTrayPopup()
    }, 1000)
  }

  private createTrayPopupWindow(): void {
    if (this.trayPopupWindow && !this.trayPopupWindow.isDestroyed()) return

    const { width, height } = this.trayPopupSize()
    const window = new BrowserWindow({
      width,
      height,
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
    this.trayPopupWindow = window

    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.setIgnoreMouseEvents(true)
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.trayPopupWindow === window) this.trayPopupWindow = null
    })
    window.webContents.on('did-finish-load', () => {
      if (this.trayHovered) this.showTrayPopup()
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=tray`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'tray' } })
    }
  }

  private positionTaskbarWindow(): void {
    if (!this.taskbarWindow || this.taskbarWindow.isDestroyed()) return

    const state = this.dependencies.getState()
    const display = screen.getPrimaryDisplay()
    const displayTop = display.bounds.y
    const workAreaTop = display.workArea.y
    const workAreaBottom = display.workArea.y + display.workArea.height
    const displayBottom = display.bounds.y + display.bounds.height
    const topTaskbarHeight = workAreaTop - displayTop
    const bottomTaskbarHeight = displayBottom - workAreaBottom
    const taskbarEdge = topTaskbarHeight >= 24 ? 'top' : 'bottom'
    const taskbarHeight = taskbarEdge === 'top' ? topTaskbarHeight : bottomTaskbarHeight
    const taskbarY = taskbarEdge === 'top' ? displayTop : workAreaBottom
    const selectedCount = this.taskbarVisibleStocks().length

    if (
      !state.settings.showTaskbarTicker ||
      selectedCount === 0 ||
      taskbarHeight < 24 ||
      !this.taskbarContentSize
    ) {
      this.taskbarWindow.hide()
      this.setTaskbarTooltip(null)
      return
    }

    const availableWidth = Math.max(280, Math.floor(display.bounds.width / 2 - 110))
    const width = Math.min(availableWidth, this.taskbarContentSize.width)
    const height = Math.min(taskbarHeight, this.taskbarContentSize.height)
    const horizontalMargin = 24
    const travelWidth = Math.max(0, display.bounds.width - width - horizontalMargin * 2)
    const positionPercent = Math.min(100, Math.max(0, state.settings.taskbarPositionPercent))
    const x =
      display.bounds.x + horizontalMargin + Math.round((travelWidth * positionPercent) / 100)
    this.taskbarLayout = { taskbarHeight, taskbarEdge }

    this.taskbarWindow.setBounds({
      x,
      y: taskbarY + Math.floor((taskbarHeight - height) / 2),
      width,
      height
    })
    this.taskbarWindow.webContents.send('taskbar:layout', this.taskbarLayout)
    if (
      this.taskbarTooltipWindow &&
      !this.taskbarTooltipWindow.isDestroyed() &&
      this.taskbarTooltipWindow.isVisible()
    ) {
      this.taskbarTooltipWindow.webContents.send('taskbar:layout', this.taskbarLayout)
    }
    this.taskbarWindow.setAlwaysOnTop(true, 'pop-up-menu')
    this.taskbarWindow.showInactive()
    if (this.taskbarTooltipWindow?.isVisible()) {
      this.positionTaskbarTooltipWindow()
      this.taskbarTooltipWindow.setAlwaysOnTop(true, 'pop-up-menu')
      this.taskbarTooltipWindow.moveTop()
    }
  }

  private positionTaskbarTooltipWindow(): void {
    const parent = this.taskbarWindow
    if (
      !this.taskbarTooltipWindow ||
      this.taskbarTooltipWindow.isDestroyed() ||
      !parent ||
      parent.isDestroyed() ||
      !this.taskbarTooltipAnchor
    ) {
      return
    }

    const width = TASKBAR_TOOLTIP_WIDTH + FLOATING_WINDOW_SHADOW_PADDING * 2
    const height = this.taskbarTooltipHeight
    const margin = 8
    const taskbarBounds = parent.getBounds()
    const display = screen.getDisplayMatching(taskbarBounds)
    const anchorCenter =
      taskbarBounds.x + this.taskbarTooltipAnchor.left + this.taskbarTooltipAnchor.width / 2
    const minX = display.workArea.x + margin
    const maxX = display.workArea.x + display.workArea.width - width - margin
    const x = Math.min(maxX, Math.max(minX, Math.round(anchorCenter - width / 2)))
    const y =
      this.taskbarLayout.taskbarEdge === 'top'
        ? Math.min(
            display.workArea.y + display.workArea.height - height - margin,
            taskbarBounds.y + taskbarBounds.height + margin - FLOATING_WINDOW_SHADOW_PADDING
          )
        : Math.max(
            display.workArea.y + margin,
            taskbarBounds.y - height - margin + FLOATING_WINDOW_SHADOW_PADDING
          )

    this.taskbarTooltipWindow.setBounds({ x, y, width, height })
  }

  private showTaskbarTooltipWindow(): void {
    const window = this.taskbarTooltipWindow
    const anchor = this.taskbarTooltipAnchor
    if (!window || window.isDestroyed() || !anchor) return

    this.positionTaskbarTooltipWindow()
    window.webContents.send('taskbar:tooltip-stock', anchor.quoteId)
    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.showInactive()
    window.moveTop()
  }

  private createTaskbarTooltipWindow(): void {
    if (this.taskbarTooltipWindow && !this.taskbarTooltipWindow.isDestroyed()) return

    const window = new BrowserWindow({
      width: TASKBAR_TOOLTIP_WIDTH + FLOATING_WINDOW_SHADOW_PADDING * 2,
      height: this.taskbarTooltipHeight,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      parent: this.taskbarWindow ?? undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    this.taskbarTooltipWindow = window

    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.setIgnoreMouseEvents(true)
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.taskbarTooltipWindow === window) this.taskbarTooltipWindow = null
    })
    window.webContents.on('did-finish-load', () => this.showTaskbarTooltipWindow())

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=taskbar-tooltip`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'taskbar-tooltip' }
      })
    }
  }

  private createTaskbarWindow(): void {
    if (this.taskbarWindow && !this.taskbarWindow.isDestroyed()) return

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
    this.taskbarWindow = window

    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.taskbarWindow === window) {
        this.taskbarWindow = null
        this.taskbarTooltipAnchor = null
      }
    })
    window.webContents.on('did-finish-load', () => this.syncTaskbarWindow())

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=taskbar`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'taskbar' }
      })
    }
  }

  private createMainWindow(): void {
    const colors = this.mainWindowThemeColors()
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const window = new BrowserWindow({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      backgroundColor: colors.background,
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      titleBarOverlay:
        process.platform === 'darwin'
          ? undefined
          : {
              color: colors.titleBar,
              symbolColor: colors.symbols,
              height: MAIN_WINDOW_TITLEBAR_HEIGHT
            },
      icon: createAppIcon(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.mainWindow = window
    this.mainWindowReady = false
    this.mainWindowHasBeenShown = false
    this.mainWindowSelectionReady = false

    window.setMenuBarVisibility(false)
    window.once('ready-to-show', () => {
      this.mainWindowReady = true
      if (this.mainWindowVisible) this.showMainWindow()
    })
    window.webContents.ipc.on('main-window:ready', () => {
      this.mainWindowSelectionReady = true
      this.sendPendingStockSelection()
    })
    window.on('close', (event) => {
      if (!this.dependencies.isQuitting() && this.dependencies.getState().settings.minimizeToTray) {
        event.preventDefault()
        this.hideMainWindow()
      }
    })
    window.on('closed', () => {
      if (this.mainWindow === window) {
        this.mainWindow = null
        this.mainWindowReady = false
        this.mainWindowSelectionReady = false
        this.pendingStockSelection = null
      }
      if (
        process.platform === 'darwin' &&
        !this.dependencies.isQuitting() &&
        !this.taskbarMode &&
        !this.dependencies.getState().settings.minimizeToTray
      ) {
        this.dependencies.quit()
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/main.html`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/main.html'))
    }
  }

  private createTray(): void {
    this.appTray = new Tray(createAppIcon())
    this.appTray.on('click', () => {
      this.setTrayHovered(false)
      this.showMainWindow()
    })
    this.appTray.on('mouse-enter', () => this.setTrayHovered(true))
    this.appTray.on('mouse-move', () => this.setTrayHovered(true))
    this.appTray.on('mouse-leave', () => this.setTrayHovered(false))
    this.updateTrayMenu()
  }
}
