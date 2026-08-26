import { BrowserWindow, Menu, screen, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculatePositionMetrics } from '../../src/lib/portfolio'
import { formatMoneyProfit, formatPercent, formatPrice } from '../../src/lib/format'
import { getTaskbarVisibleStocks, shouldShowTaskbarTicker } from '../../src/lib/taskbar-visibility'
import type {
  AppState,
  StockSelectionRequest,
  StockQuote,
  TaskbarLayout,
  TaskbarTooltipAnchor,
  WatchStock
} from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import { createAppIcon } from './tray-icons'

const TASKBAR_TOOLTIP_WIDTH = 380
const TASKBAR_TOOLTIP_DEFAULT_HEIGHT = 260

interface WindowManagerDependencies {
  getState: () => AppState
  getQuotes: () => readonly StockQuote[]
  isQuitting: () => boolean
  refreshQuotes: () => Promise<unknown>
  quit: () => void
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private taskbarWindow: BrowserWindow | null = null
  private taskbarTooltipWindow: BrowserWindow | null = null
  private trayPopupWindow: BrowserWindow | null = null
  private appTray: Tray | null = null
  private trayPopupShowTimer: NodeJS.Timeout | null = null
  private taskbarLayout: TaskbarLayout = { taskbarHeight: 48, taskbarEdge: 'bottom' }
  private taskbarContentSize: { width: number; height: number } | null = null
  private taskbarTooltipAnchor: TaskbarTooltipAnchor | null = null
  private taskbarTooltipHeight = TASKBAR_TOOLTIP_DEFAULT_HEIGHT
  private trayHovered = false
  private disposed = false
  private stockSelectionSequence = 0
  private readonly windowStatePath: string
  private mainWindowVisible: boolean
  private mainWindowHasBeenShown = false

  private readonly handleDisplayMetricsChanged = (): void => {
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  private readonly handleDisplayChanged = (): void => {
    this.syncTaskbarWindow()
  }

  constructor(
    private readonly dependencies: WindowManagerDependencies,
    userDataDirectory: string
  ) {
    this.windowStatePath = join(userDataDirectory, 'window-state.json')
    this.mainWindowVisible = this.loadMainWindowVisible()
  }

  create(): void {
    this.createMainWindow()
    this.syncTaskbarWindow()
    this.createTray()
    screen.on('display-metrics-changed', this.handleDisplayMetricsChanged)
    screen.on('display-added', this.handleDisplayChanged)
    screen.on('display-removed', this.handleDisplayChanged)
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
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
    this.taskbarTooltipAnchor = anchor
    if (!anchor) {
      if (this.taskbarTooltipWindow && !this.taskbarTooltipWindow.isDestroyed()) {
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
    const nextHeight = Math.min(560, Math.max(200, Math.ceil(height)))
    if (this.taskbarTooltipHeight === nextHeight) return
    this.taskbarTooltipHeight = nextHeight
    if (this.taskbarTooltipWindow?.isVisible()) this.positionTaskbarTooltipWindow()
  }

  showMainWindow(
    quoteId?: string,
    scrollAlignment?: StockSelectionRequest['scrollAlignment']
  ): void {
    const window = this.getMainWindow()
    if (!window) return
    if (!this.mainWindowHasBeenShown) {
      this.mainWindowHasBeenShown = true
      window.maximize()
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    this.saveMainWindowVisible(true)
    if (quoteId) {
      this.stockSelectionSequence += 1
      window.webContents.send('stock:selected', {
        id: `${Date.now()}-${this.stockSelectionSequence}`,
        quoteId,
        scrollAlignment
      } satisfies StockSelectionRequest)
    }
  }

  hideMainWindow(): void {
    const window = this.getMainWindow()
    if (!window) return
    window.hide()
    this.saveMainWindowVisible(false)
  }

  sendToWindows(channel: string, payload: unknown): void {
    for (const window of [
      this.mainWindow,
      this.taskbarWindow,
      this.taskbarTooltipWindow,
      this.trayPopupWindow
    ]) {
      if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  sync(): void {
    this.updateTrayMenu()
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  updateTrayMenu(): void {
    if (!this.appTray) return
    const state = this.dependencies.getState()
    const quotes = this.dependencies.getQuotes()
    const selectedItems: MenuItemConstructorOptions[] = this.taskbarVisibleStocks().map((stock) => {
      const quote = quotes.find((item) => item.quoteId === stock.quoteId)
      const metrics = calculatePositionMetrics(
        stock.position,
        quote,
        state.tTradingAccounts[stock.quoteId],
        state.settings.exchangeRates
      )
      return {
        label: `${stock.name}  ${formatPrice(quote?.latest ?? null)}  ${formatPercent(quote?.changePercent ?? null)}  ${formatMoneyProfit(metrics.todayProfit, metrics.currency)}`,
        click: () => this.showMainWindow(stock.quoteId)
      }
    })

    this.appTray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开见涨', click: () => this.showMainWindow() },
        { label: '立即刷新', click: () => void this.dependencies.refreshQuotes() },
        { type: 'separator' },
        ...(selectedItems.length > 0
          ? selectedItems
          : [{ label: '尚未选择任务栏股票', enabled: false }]),
        { type: 'separator' },
        { label: '退出', click: this.dependencies.quit }
      ])
    )
  }

  syncTaskbarWindow(): void {
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
    if (this.trayPopupWindow?.isVisible()) this.positionTrayPopupWindow()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    screen.removeListener('display-metrics-changed', this.handleDisplayMetricsChanged)
    screen.removeListener('display-added', this.handleDisplayChanged)
    screen.removeListener('display-removed', this.handleDisplayChanged)
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

  private loadMainWindowVisible(): boolean {
    if (!existsSync(this.windowStatePath)) return true
    try {
      const state = JSON.parse(readFileSync(this.windowStatePath, 'utf8')) as { visible?: unknown }
      return state.visible !== false
    } catch {
      return true
    }
  }

  private saveMainWindowVisible(visible: boolean): void {
    if (this.mainWindowVisible === visible) return
    this.mainWindowVisible = visible
    atomicWriteJsonSync(this.windowStatePath, { visible })
  }

  private trayPopupSize(): { width: number; height: number } {
    const selectedCount = this.taskbarVisibleStocks().length
    const columns = selectedCount > 1 ? 2 : 1
    const rows = Math.ceil(selectedCount / columns)
    return {
      width: columns === 2 ? 638 : 369,
      height: 35 + rows * 78
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
    const y = trayIsBelowWorkArea
      ? workAreaBottom - height - margin
      : Math.min(
          workAreaBottom - height - margin,
          Math.max(display.workArea.y + margin, trayBounds.y + trayBounds.height + margin)
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
    if (this.taskbarTooltipWindow && !this.taskbarTooltipWindow.isDestroyed()) {
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
    if (
      !this.taskbarTooltipWindow ||
      this.taskbarTooltipWindow.isDestroyed() ||
      !this.taskbarWindow ||
      this.taskbarWindow.isDestroyed() ||
      !this.taskbarTooltipAnchor
    ) {
      return
    }

    const width = TASKBAR_TOOLTIP_WIDTH
    const height = this.taskbarTooltipHeight
    const margin = 8
    const taskbarBounds = this.taskbarWindow.getBounds()
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
            taskbarBounds.y + taskbarBounds.height + margin
          )
        : Math.max(display.workArea.y + margin, taskbarBounds.y - height - margin)

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
      width: TASKBAR_TOOLTIP_WIDTH,
      height: TASKBAR_TOOLTIP_DEFAULT_HEIGHT,
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
    const window = new BrowserWindow({
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
    this.mainWindow = window

    window.setMenuBarVisibility(false)
    window.on('ready-to-show', () => {
      if (this.mainWindowVisible) this.showMainWindow()
    })
    window.on('close', (event) => {
      if (!this.dependencies.isQuitting() && this.dependencies.getState().settings.minimizeToTray) {
        event.preventDefault()
        this.hideMainWindow()
      }
    })
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
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
