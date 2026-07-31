import { BrowserWindow, Menu, screen, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { accountHasTriggeredTAlerts } from '../../src/lib/t-alerts'
import { calculatePositionMetrics } from '../../src/lib/portfolio'
import type { AppState, StockQuote, TaskbarLayout, WatchStock } from '../../src/shared/types'
import { createAppIcon } from './tray-icons'

interface WindowManagerDependencies {
  getState: () => AppState
  getQuotes: () => readonly StockQuote[]
  isQuitting: () => boolean
  refreshQuotes: () => Promise<unknown>
  quit: () => void
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

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private taskbarWindow: BrowserWindow | null = null
  private trayPopupWindow: BrowserWindow | null = null
  private appTray: Tray | null = null
  private trayPopupShowTimer: NodeJS.Timeout | null = null
  private taskbarPositionTimer: NodeJS.Timeout | null = null
  private taskbarLayout: TaskbarLayout = { taskbarHeight: 48 }
  private trayHovered = false
  private disposed = false

  private readonly handleDisplayMetricsChanged = (): void => {
    this.syncTaskbarWindow()
    this.positionTrayPopupIfVisible()
  }

  private readonly handleDisplayChanged = (): void => {
    this.syncTaskbarWindow()
  }

  constructor(private readonly dependencies: WindowManagerDependencies) {}

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

  showMainWindow(quoteId?: string): void {
    const window = this.getMainWindow()
    if (!window) return
    window.show()
    if (window.isMinimized()) window.restore()
    window.focus()
    if (quoteId) window.webContents.send('stock:selected', quoteId)
  }

  hideMainWindow(): void {
    this.getMainWindow()?.hide()
  }

  sendToWindows(channel: string, payload: unknown): void {
    for (const window of [this.mainWindow, this.taskbarWindow, this.trayPopupWindow]) {
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
      const todayProfit = calculatePositionMetrics(
        stock.position,
        quote,
        state.tTradingAccounts[stock.quoteId]
      ).todayProfit
      return {
        label: `${stock.name}  ${formatPrice(quote?.latest ?? null)}  ${formatPercent(quote?.changePercent ?? null)}  ${formatProfit(todayProfit)}`,
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
    const shouldShow =
      this.taskbarVisibleStocks().length > 0 &&
      (state.settings.showTaskbarTicker || this.hasActiveTaskbarAlert())

    if (!shouldShow) {
      if (this.taskbarWindow && !this.taskbarWindow.isDestroyed()) this.taskbarWindow.hide()
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
    if (this.taskbarPositionTimer) clearTimeout(this.taskbarPositionTimer)
    this.trayPopupShowTimer = null
    this.taskbarPositionTimer = null
    this.appTray?.destroy()
    this.appTray = null
    this.trayPopupWindow?.destroy()
    this.trayPopupWindow = null
    this.taskbarWindow?.destroy()
    this.taskbarWindow = null
  }

  private taskbarVisibleStocks(): WatchStock[] {
    const state = this.dependencies.getState()
    const quotes = this.dependencies.getQuotes()
    return state.watchlist.filter(
      (stock) =>
        stock.showInTaskbar ||
        accountHasTriggeredTAlerts(state.tTradingAccounts[stock.quoteId]) ||
        (state.tTradingAccounts[stock.quoteId]?.activeBatch &&
          quotes.some(
            (quote) =>
              quote.quoteId === stock.quoteId && Boolean(quote.fiveLevelLargeOrders?.length)
          ))
    )
  }

  private hasActiveTaskbarAlert(): boolean {
    const state = this.dependencies.getState()
    const quotes = this.dependencies.getQuotes()
    return state.watchlist.some(
      (stock) =>
        accountHasTriggeredTAlerts(state.tTradingAccounts[stock.quoteId]) ||
        (state.tTradingAccounts[stock.quoteId]?.activeBatch &&
          quotes.some(
            (quote) =>
              quote.quoteId === stock.quoteId && Boolean(quote.fiveLevelLargeOrders?.length)
          ))
    )
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
    const taskbarTop = display.workArea.y + display.workArea.height
    const displayBottom = display.bounds.y + display.bounds.height
    const taskbarHeight = displayBottom - taskbarTop
    const selectedCount = this.taskbarVisibleStocks().length

    if (
      (!state.settings.showTaskbarTicker && !this.hasActiveTaskbarAlert()) ||
      selectedCount === 0 ||
      taskbarHeight < 24
    ) {
      this.taskbarWindow.hide()
      return
    }

    const columns = Math.ceil(selectedCount / 2)
    const availableWidth = Math.max(280, Math.floor(display.bounds.width / 2 - 110))
    const width = Math.min(availableWidth, Math.max(280, columns * 260))
    const horizontalMargin = 24
    const travelWidth = Math.max(0, display.bounds.width - width - horizontalMargin * 2)
    const positionPercent = Math.min(100, Math.max(0, state.settings.taskbarPositionPercent))
    const x =
      display.bounds.x + horizontalMargin + Math.round((travelWidth * positionPercent) / 100)
    this.taskbarLayout = { taskbarHeight }

    this.taskbarWindow.setBounds({
      x,
      y: taskbarTop,
      width,
      height: taskbarHeight
    })
    this.taskbarWindow.webContents.send('taskbar:layout', this.taskbarLayout)
    this.taskbarWindow.setAlwaysOnTop(true, 'pop-up-menu')
    this.taskbarWindow.showInactive()
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
    window.setIgnoreMouseEvents(true)
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.taskbarWindow === window) this.taskbarWindow = null
    })
    window.webContents.on('did-finish-load', () => {
      this.syncTaskbarWindow()
      this.taskbarPositionTimer = setTimeout(() => {
        this.taskbarPositionTimer = null
        this.positionTaskbarWindow()
      }, 100)
    })

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
      window.maximize()
      window.show()
    })
    window.on('close', (event) => {
      if (!this.dependencies.isQuitting() && this.dependencies.getState().settings.minimizeToTray) {
        event.preventDefault()
        window.hide()
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
