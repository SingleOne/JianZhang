import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loadURL, windowCreated, windowDestroyed, cookiesGet, clearStorageData, fromPartition } =
  vi.hoisted(() => ({
    loadURL: vi.fn(),
    windowCreated: vi.fn(),
    windowDestroyed: vi.fn(),
    cookiesGet: vi.fn(),
    clearStorageData: vi.fn(),
    fromPartition: vi.fn()
  }))

vi.mock('electron', () => ({
  BrowserWindow: class {
    private destroyed = false
    webContents = {
      setWindowOpenHandler: vi.fn(),
      setAudioMuted: vi.fn()
    }
    loadURL = loadURL

    constructor(options: unknown) {
      windowCreated(options)
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    destroy(): void {
      this.destroyed = true
      windowDestroyed()
    }
  },
  session: { fromPartition }
}))

import { EastmoneyHistorySession } from './eastmoney-history-session'

describe('EastmoneyHistorySession', () => {
  let historySession: EastmoneyHistorySession

  beforeEach(() => {
    vi.clearAllMocks()
    loadURL.mockResolvedValue(undefined)
    clearStorageData.mockResolvedValue(undefined)
    cookiesGet.mockResolvedValue([{ name: 'history-session', value: 'fresh' }])
    fromPartition.mockReturnValue({
      cookies: { get: cookiesGet },
      clearStorageData,
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn()
    })
    historySession = new EastmoneyHistorySession()
  })

  afterEach(() => {
    historySession.dispose()
    vi.useRealTimers()
  })

  it('shares a concurrent refresh and waits before using its cookie jar', async () => {
    let finishLoad!: () => void
    loadURL.mockReturnValue(new Promise<void>((resolve) => (finishLoad = resolve)))

    const refresh = historySession.refresh(0)
    const concurrentRefresh = historySession.refresh(0)
    const waitingSession = historySession.getSession()
    await vi.waitFor(() => expect(loadURL).toHaveBeenCalledTimes(1))
    expect(windowDestroyed).not.toHaveBeenCalled()

    finishLoad()
    await expect(refresh).resolves.toBe(true)
    await expect(concurrentRefresh).resolves.toBe(true)
    await waitingSession
    expect(historySession.generation).toBe(1)
    expect(windowCreated).toHaveBeenCalledTimes(1)
    expect(windowCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({ nodeIntegration: false, sandbox: true })
      })
    )
    expect(windowDestroyed).toHaveBeenCalledTimes(1)
    expect(clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] })
  })

  it('reuses a newer generation and limits repeated failed-session refreshes', async () => {
    vi.useFakeTimers()
    await historySession.refresh(0)

    await expect(historySession.refresh(0)).resolves.toBe(true)
    await expect(historySession.refresh(1)).resolves.toBe(false)
    expect(windowCreated).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await expect(historySession.refresh(1)).resolves.toBe(true)
    expect(windowCreated).toHaveBeenCalledTimes(2)
  })

  it('uses cookies matching the primary origin for Node mirror requests', async () => {
    await expect(
      historySession.getCookieHeader('https://push2his.eastmoney.com/api/qt/stock/kline/get')
    ).resolves.toEqual({ Cookie: 'history-session=fresh' })
    expect(cookiesGet).toHaveBeenCalledWith({
      url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
    })
  })

  it('destroys a stalled bootstrap page and releases the refresh after timeout', async () => {
    vi.useFakeTimers()
    loadURL.mockReturnValue(new Promise<void>(() => {}))
    const refresh = historySession.refresh(0)
    const rejected = expect(refresh).rejects.toThrow('东方财富行情会话初始化超时')

    await vi.advanceTimersByTimeAsync(12_000)
    await rejected
    expect(windowDestroyed).toHaveBeenCalledTimes(1)
    expect(historySession.generation).toBe(0)
    await historySession.getSession()
    await expect(historySession.refresh(0)).resolves.toBe(false)
  })

  it('does not create another session or window after app shutdown', async () => {
    historySession.dispose()
    await expect(historySession.getSession()).rejects.toThrow('东方财富行情会话已关闭')
    await expect(historySession.refresh(0)).resolves.toBe(false)
    expect(fromPartition).not.toHaveBeenCalled()
    expect(windowCreated).not.toHaveBeenCalled()
  })
})
