import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createDesktopWidgetSnapshot,
  type DesktopWidgetSnapshot
} from '../../src/lib/desktop-widget'
import type { AppState, StockQuote } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

interface NativeWidgetBridge {
  containerPath: () => string
  reloadTimelines: () => void
}

export class DesktopWidgetRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null
  private snapshot: DesktopWidgetSnapshot | undefined
  private lastReload = 0
  private stopped = false
  private lastError: string | undefined

  private constructor(
    private readonly bridge: NativeWidgetBridge,
    private readonly snapshotPath: string,
    private readonly getState: () => AppState,
    private readonly getQuotes: () => readonly StockQuote[]
  ) {
    try {
      const stored = JSON.parse(readFileSync(snapshotPath, 'utf8')) as DesktopWidgetSnapshot
      if (stored.schemaVersion === 1 && Array.isArray(stored.stocks)) this.snapshot = stored
    } catch {
      // A first launch or an old/corrupt widget cache starts with a fresh snapshot.
    }
  }

  static create(
    resourcesPath: string,
    getState: () => AppState,
    getQuotes: () => readonly StockQuote[]
  ): DesktopWidgetRuntime | null {
    if (process.platform !== 'darwin') return null
    const addonPath = join(resourcesPath, 'macos-widgets', 'jianzhang-widget.node')
    if (!existsSync(addonPath)) return null
    try {
      const bridge = createRequire(join(resourcesPath, 'macos-widgets', 'loader.cjs'))(
        addonPath
      ) as NativeWidgetBridge
      const container = bridge.containerPath()
      if (!container) throw new Error('无法访问小组件共享容器，请检查应用签名及 App Groups 权限')
      return new DesktopWidgetRuntime(bridge, join(container, 'snapshot.json'), getState, getQuotes)
    } catch (reason) {
      console.warn('[desktop-widget]', reason instanceof Error ? reason.message : reason)
      return null
    }
  }

  schedule(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush(true)
    }, 30_000)
    this.timer.unref()
  }

  start(): void {
    this.flush(true)
    this.schedule()
  }

  dispose(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.flush(false)
  }

  private flush(appRunning: boolean): void {
    try {
      this.snapshot = createDesktopWidgetSnapshot(
        this.getState(),
        this.getQuotes(),
        this.snapshot,
        new Date(),
        appRunning
      )
      atomicWriteJsonSync(this.snapshotPath, this.snapshot, false)
      // Request coalesced system reloads; these are not guaranteed refresh intervals.
      if (!appRunning || Date.now() - this.lastReload >= 5 * 60_000) {
        this.bridge.reloadTimelines()
        this.lastReload = Date.now()
      }
      this.lastError = undefined
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (message !== this.lastError) console.warn('[desktop-widget]', message)
      this.lastError = message
    }
    if (!this.stopped) this.schedule()
  }
}
