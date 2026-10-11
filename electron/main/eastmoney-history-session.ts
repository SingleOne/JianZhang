import { BrowserWindow, session, type Session } from 'electron'
import { BROWSER_USER_AGENT } from './http-user-agent'

const HISTORY_SESSION_PARTITION = 'jianzhang-eastmoney-history'
const SESSION_PAGE_URL = 'https://quote.eastmoney.com/sh600000.html'
const SESSION_REFRESH_INTERVAL = 60_000
const SESSION_LOAD_TIMEOUT = 12_000

export class EastmoneyHistorySession {
  private browserSession: Session | null = null
  private bootstrapWindow: BrowserWindow | null = null
  private refreshPromise: Promise<boolean> | null = null
  private lastRefreshAt = -Infinity
  private sessionGeneration = 0
  private disposed = false

  get generation(): number {
    return this.sessionGeneration
  }

  async getSession(): Promise<Session> {
    await this.refreshPromise
    if (this.disposed) throw new Error('东方财富行情会话已关闭')
    return this.getOrCreateSession()
  }

  async getCookieHeader(url: string): Promise<Record<string, string>> {
    const browserSession = await this.getSession()
    const cookies = await browserSession.cookies.get({ url })
    const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
    return cookie ? { Cookie: cookie } : {}
  }

  async refresh(expectedGeneration: number): Promise<boolean> {
    if (this.disposed) return false
    if (this.refreshPromise) return this.refreshPromise
    if (expectedGeneration !== this.sessionGeneration) return true
    if (Date.now() - this.lastRefreshAt < SESSION_REFRESH_INTERVAL) return false

    this.lastRefreshAt = Date.now()
    this.refreshPromise = this.loadSessionPage()
      .then(() => {
        this.sessionGeneration += 1
        return true
      })
      .finally(() => {
        this.refreshPromise = null
      })
    return this.refreshPromise
  }

  dispose(): void {
    this.disposed = true
    if (this.bootstrapWindow && !this.bootstrapWindow.isDestroyed()) {
      this.bootstrapWindow.destroy()
    }
  }

  private getOrCreateSession(): Session {
    if (!this.browserSession) {
      this.browserSession = session.fromPartition(HISTORY_SESSION_PARTITION)
      this.browserSession.setUserAgent(BROWSER_USER_AGENT)
      this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false)
      )
      this.browserSession.setPermissionCheckHandler(() => false)
      this.browserSession.on('will-download', (event) => event.preventDefault())
    }
    return this.browserSession
  }

  private async loadSessionPage(): Promise<void> {
    const browserSession = this.getOrCreateSession()
    await browserSession.clearStorageData({ storages: ['cookies'] })
    if (this.disposed) throw new Error('东方财富行情会话已关闭')

    // Execute the quote site's scripts so its own browser session can obtain valid cookies.
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    this.bootstrapWindow = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.setAudioMuted(true)

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        window.loadURL(SESSION_PAGE_URL, { userAgent: BROWSER_USER_AGENT }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('东方财富行情会话初始化超时')),
            SESSION_LOAD_TIMEOUT
          )
        })
      ])
      const cookies = await browserSession.cookies.get({
        url: 'https://push2his.eastmoney.com/'
      })
      if (cookies.length === 0) throw new Error('东方财富网页未返回有效的行情会话 Cookie')
    } finally {
      clearTimeout(timeout)
      if (!window.isDestroyed()) window.destroy()
      this.bootstrapWindow = null
    }
  }
}

export const eastmoneyHistorySession = new EastmoneyHistorySession()
