import { BrowserWindow, nativeTheme, screen, Tray, type Menu } from 'electron'
import { join } from 'node:path'
import type { AppState, StockQuote } from '../../src/shared/types'
import { getMenuBarPresentation } from '../../src/lib/menu-bar'
import { getTaskbarVisibleStocks } from '../../src/lib/taskbar-visibility'
import { createMenuBarIcon } from './tray-icons'
import { MenuBarTitleAnimator } from './menu-bar-title-animator'

interface MacMenuBarDependencies {
  getState: () => AppState
  getQuotes: () => StockQuote[]
}

export class MacMenuBar {
  private readonly tray = new Tray(createMenuBarIcon())
  private readonly titleAnimator = new MenuBarTitleAnimator(this.tray, () =>
    this.positionPanelIfVisible()
  )
  private panel: BrowserWindow | null = null
  private menu: Menu | null = null
  private openRequested = false
  private panelReady = false
  private panelHeight = 240
  private selectionKey = ''
  private rotationStartedAt = Date.now()
  private presentationKey = ''
  private lastHiddenAt = 0
  private readonly timer: NodeJS.Timeout
  private readonly handleThemeUpdated = () => {
    this.presentationKey = ''
    this.sync()
  }

  constructor(private readonly dependencies: MacMenuBarDependencies) {
    this.tray.setIgnoreDoubleClickEvents(true)
    this.tray.on('click', () => {
      // Clicking the status item blurs the panel before this event arrives.
      if (this.openRequested || Date.now() - this.lastHiddenAt < 200) this.hidePanel()
      else this.showPanel()
    })
    this.tray.on('right-click', () => {
      this.hidePanel()
      if (this.menu) this.tray.popUpContextMenu(this.menu)
    })
    this.timer = setInterval(() => this.sync(), 5_000)
    nativeTheme.on('updated', this.handleThemeUpdated)
    this.sync()
  }

  setMenu(menu: Menu): void {
    // Keep the left click available for our panel; open the menu explicitly on right click.
    this.menu = menu
  }

  sync(): void {
    const state = this.dependencies.getState()
    const stocks = getTaskbarVisibleStocks(state.watchlist)
    const key = JSON.stringify([
      stocks.map((stock) => stock.quoteId),
      state.settings.menuBarQuoteId,
      state.settings.menuBarRotationSeconds,
      state.settings.menuBarDisplayMode,
      state.settings.showTaskbarTicker
    ])
    const selectionChanged = this.selectionKey !== key
    if (selectionChanged) {
      this.selectionKey = key
      this.rotationStartedAt = Date.now()
    }
    const seconds = state.settings.menuBarRotationSeconds
    const rotationIndex =
      seconds > 0 ? Math.floor((Date.now() - this.rotationStartedAt) / (seconds * 1000)) : 0
    const presentation = getMenuBarPresentation(state, this.dependencies.getQuotes(), rotationIndex)
    const nextKey = JSON.stringify(presentation)
    if (selectionChanged || nextKey !== this.presentationKey) {
      this.presentationKey = nextKey
      this.titleAnimator.update(presentation, seconds > 0, selectionChanged)
      this.tray.setToolTip(presentation.tooltip)
      this.positionPanelIfVisible()
    }
  }

  send(channel: string, payload: unknown): void {
    if (this.panel && !this.panel.isDestroyed()) this.panel.webContents.send(channel, payload)
    if (channel === 'quotes:updated' || channel === 'state:updated') this.sync()
  }

  hidePanel(): void {
    this.openRequested = false
    if (this.panel?.isVisible()) {
      this.lastHiddenAt = Date.now()
      this.panel.hide()
    }
  }

  resizePanel(height: number): void {
    const zoomFactor = this.panel?.webContents.getZoomFactor() ?? 1
    this.panelHeight = Math.max(1, Math.min(720, Math.ceil(height * zoomFactor)))
    this.positionPanelIfVisible()
  }

  positionPanelIfVisible(): void {
    if (this.panel?.isVisible()) this.positionPanel()
  }

  dispose(): void {
    clearInterval(this.timer)
    nativeTheme.removeListener('updated', this.handleThemeUpdated)
    this.titleAnimator.dispose()
    this.openRequested = false
    this.panel?.destroy()
    this.panel = null
    this.tray.destroy()
  }

  private positionPanel(): void {
    if (!this.panel) return
    const bounds = this.tray.getBounds()
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2)
    }
    const { workArea } = screen.getDisplayNearestPoint(center)
    const margin = 8
    const width = Math.min(560, workArea.width - margin * 2)
    const height = Math.min(this.panelHeight, workArea.height - margin * 2)
    const x = Math.max(
      workArea.x + margin,
      Math.min(center.x - width / 2, workArea.x + workArea.width - width - margin)
    )
    const y = Math.max(
      workArea.y + margin,
      Math.min(bounds.y + bounds.height + margin, workArea.y + workArea.height - height - margin)
    )
    const nextBounds = { x: Math.round(x), y: Math.round(y), width, height }
    const previousBounds = this.panel.getBounds()
    if (
      previousBounds.x !== nextBounds.x ||
      previousBounds.y !== nextBounds.y ||
      previousBounds.width !== width ||
      previousBounds.height !== height
    ) {
      this.panel.setBounds(nextBounds)
    }
  }

  private showPanel(): void {
    this.openRequested = true
    if (!this.panel) this.createPanel()
    if (!this.panelReady || !this.panel) return
    this.positionPanel()
    this.panel.show()
    this.panel.focus()
  }

  private createPanel(): void {
    const panel = new BrowserWindow({
      width: 560,
      height: this.panelHeight,
      show: false,
      frame: false,
      type: 'panel',
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'popover',
      visualEffectState: 'active',
      roundedCorners: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.panel = panel
    this.panelReady = false
    panel.setAlwaysOnTop(true, 'pop-up-menu')
    // WindowManager owns the app's Dock visibility; this panel must not hide the app.
    panel.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    panel.on('blur', () => this.hidePanel())
    panel.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') {
        event.preventDefault()
        this.hidePanel()
      }
    })
    panel.on('closed', () => {
      this.panel = null
      this.panelReady = false
      this.openRequested = false
    })
    panel.webContents.on('did-finish-load', () => {
      this.panelReady = true
      if (this.openRequested) this.showPanel()
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void panel.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=menu-bar`)
    } else {
      void panel.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'menu-bar' }
      })
    }
  }
}
