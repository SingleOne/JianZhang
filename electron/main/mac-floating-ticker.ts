import { BrowserWindow, screen } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState, FloatingTickerPreferences } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

interface FloatingTickerPosition {
  displayId: number
  offsetX: number
  offsetY: number
}

interface MacFloatingTickerDependencies {
  getState: () => AppState
  updateFloatingTickerPreferences: (preferences: Partial<FloatingTickerPreferences>) => void
}

export class MacFloatingTicker {
  private window: BrowserWindow | null = null
  private ready = false
  private showing = false
  private disposed = false
  private height = 180
  private alwaysOnTop: boolean | null = null
  private allWorkspaces = false
  private position: FloatingTickerPosition | null
  private saveTimer: NodeJS.Timeout | null = null
  private readonly positionPath: string

  constructor(
    private readonly dependencies: MacFloatingTickerDependencies,
    userDataDirectory: string
  ) {
    this.positionPath = join(userDataDirectory, 'floating-ticker-window.json')
    this.position = this.loadPosition()
  }

  sync(): void {
    if (this.disposed) return
    const settings = this.dependencies.getState().settings
    if (!settings.showFloatingTicker) {
      this.window?.hide()
      this.showing = false
      return
    }
    if (!this.window) this.createWindow()
    const window = this.window!
    if (this.alwaysOnTop !== settings.floatingTickerAlwaysOnTop) {
      this.alwaysOnTop = settings.floatingTickerAlwaysOnTop
      window.setAlwaysOnTop(this.alwaysOnTop, 'floating')
    }
    if (this.allWorkspaces !== settings.floatingTickerAllWorkspaces) {
      this.allWorkspaces = settings.floatingTickerAllWorkspaces
      window.setVisibleOnAllWorkspaces(this.allWorkspaces, { visibleOnFullScreen: false })
    }
    if (this.ready && !this.showing) {
      this.restorePosition()
      window.showInactive()
      this.showing = true
    }
  }

  send(channel: string, payload: unknown): void {
    this.window?.webContents.send(channel, payload)
    if (channel === 'state:updated') this.sync()
  }

  resize(height: number): void {
    const nextHeight = Math.max(120, Math.min(640, Math.ceil(height)))
    if (this.height === nextHeight) return
    this.height = nextHeight
    this.restorePosition()
  }

  resetPosition(): void {
    this.position = null
    this.restorePosition()
    this.rememberPosition()
  }

  restorePosition(): void {
    if (!this.window) return
    const display = this.position
      ? (screen.getAllDisplays().find((item) => item.id === this.position!.displayId) ??
        screen.getPrimaryDisplay())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { workArea } = display
    const margin = 8
    const width = Math.min(380, workArea.width - margin * 2)
    const height = Math.min(this.height, workArea.height - margin * 2)
    const x =
      workArea.x +
      Math.max(
        margin,
        Math.min(
          this.position?.offsetX ?? workArea.width - width - 24,
          workArea.width - width - margin
        )
      )
    const y =
      workArea.y +
      Math.max(margin, Math.min(this.position?.offsetY ?? 64, workArea.height - height - margin))
    this.window.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
    this.rememberPosition()
  }

  dispose(): void {
    this.disposed = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.position) atomicWriteJsonSync(this.positionPath, this.position)
    this.window?.destroy()
    this.window = null
  }

  private rememberPosition(): void {
    if (!this.window || this.disposed) return
    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    this.position = {
      displayId: display.id,
      offsetX: bounds.x - display.workArea.x,
      offsetY: bounds.y - display.workArea.y
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      atomicWriteJsonSync(this.positionPath, this.position)
    }, 200)
  }

  private loadPosition(): FloatingTickerPosition | null {
    if (!existsSync(this.positionPath)) return null
    try {
      const saved = JSON.parse(
        readFileSync(this.positionPath, 'utf8')
      ) as FloatingTickerPosition | null
      return saved &&
        Number.isFinite(saved.displayId) &&
        Number.isFinite(saved.offsetX) &&
        Number.isFinite(saved.offsetY)
        ? saved
        : null
    } catch {
      return null
    }
  }

  private createWindow(): void {
    const window = new BrowserWindow({
      width: 380,
      height: this.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      movable: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    this.window = window
    this.ready = false
    this.showing = false
    this.alwaysOnTop = null
    this.allWorkspaces = false
    this.restorePosition()
    window.on('moved', () => this.rememberPosition())
    window.on('close', (event) => {
      if (this.disposed) return
      event.preventDefault()
      this.dependencies.updateFloatingTickerPreferences({ showFloatingTicker: false })
    })
    window.on('closed', () => {
      this.window = null
      this.ready = false
      this.showing = false
    })
    window.once('ready-to-show', () => {
      this.ready = true
      this.sync()
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=floating-ticker`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'floating-ticker' }
      })
    }
  }
}
