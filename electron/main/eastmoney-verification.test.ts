import type { EventEmitter } from 'node:events'
import type { Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { created, fetch, inspect } = vi.hoisted(() => ({
  created: vi.fn(),
  fetch: vi.fn(),
  inspect: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      private destroyed = false
      webContents = Object.assign(new EventEmitter(), {
        mainFrame: { executeJavaScript: inspect },
        setWindowOpenHandler: vi.fn(),
        setAudioMuted: vi.fn()
      })
      loadURL = vi.fn(async () => {})
      show = vi.fn()
      focus = vi.fn()
      destroy = vi.fn(() => {
        this.destroyed = true
        this.emit('closed')
      })
      isDestroyed = () => this.destroyed

      constructor(options: unknown) {
        super()
        created(this, options)
      }
    }
  }
})

import {
  EastmoneyVerification,
  eastmoneyVerificationPageUrl,
  hasEastmoneyChallenge,
  hasEastmoneyResponseData,
  isEastmoneyUrl
} from './eastmoney-verification'

interface VerificationWindow {
  webContents: EventEmitter
  show: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

const REQUEST_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.600000'

describe('Eastmoney verification', () => {
  let verification: EastmoneyVerification
  const onVerified = vi.fn()
  const onRequired = vi.fn()

  const currentWindow = () => created.mock.lastCall![0] as VerificationWindow

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    inspect.mockResolvedValue(false)
    fetch.mockRejectedValue(new Error('net::ERR_EMPTY_RESPONSE'))
    verification = new EastmoneyVerification(() => ({ fetch }) as unknown as Session)
    verification.configure({
      getParentWindow: () => null,
      onVerified,
      onRequired,
      onError: vi.fn()
    })
  })

  afterEach(() => {
    verification.dispose()
    vi.useRealTimers()
  })

  it('coalesces failure probes without showing a normal page and applies a cooldown', async () => {
    verification.check(REQUEST_URL)
    verification.check(REQUEST_URL)
    currentWindow().webContents.emit('dom-ready')
    await vi.advanceTimersByTimeAsync(15_000)

    expect(created).toHaveBeenCalledTimes(1)
    expect(currentWindow().show).not.toHaveBeenCalled()
    expect(currentWindow().destroy).toHaveBeenCalledTimes(1)
    verification.check(REQUEST_URL)
    expect(created).toHaveBeenCalledTimes(1)
    expect(onRequired).not.toHaveBeenCalled()
  })

  it('shows the official page after detecting a visible verification control', async () => {
    verification.check(REQUEST_URL)
    inspect.mockResolvedValue(true)
    currentWindow().webContents.emit('dom-ready')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(currentWindow().show).toHaveBeenCalledTimes(1)
    expect(verification.required).toBe(true)
    expect(onRequired).toHaveBeenCalledTimes(1)
    expect(created.mock.lastCall![1].webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    })
  })

  it('keeps the window open on empty responses and closes only after real data returns', async () => {
    verification.check(REQUEST_URL, true)
    fetch.mockImplementation(async () => new Response('{"data":null}'))
    await vi.advanceTimersByTimeAsync(6_000)
    expect(currentWindow().destroy).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()

    fetch.mockImplementation(
      async () => new Response('{"rc":0,"data":{"diff":[{"f12":"600000"}]}}')
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(currentWindow().destroy).toHaveBeenCalledTimes(1)
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(verification.required).toBe(false)
    expect(fetch).toHaveBeenCalledWith(
      REQUEST_URL,
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('does not treat manual closing as verification success', () => {
    verification.check(REQUEST_URL, true)
    currentWindow().destroy()
    expect(onVerified).not.toHaveBeenCalled()
    expect(verification.required).toBe(false)
  })

  it('prevents top-level navigation away from the official site', () => {
    verification.check(REQUEST_URL, true)
    const event = { preventDefault: vi.fn() }
    currentWindow().webContents.emit('will-navigate', event, 'https://eastmoney.com.example.org/')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(isEastmoneyUrl('https://quote.eastmoney.com/')).toBe(true)
  })

  it('uses a stock page for quote requests and the data center for valuation requests', () => {
    expect(eastmoneyVerificationPageUrl(REQUEST_URL)).toBe(
      'https://quote.eastmoney.com/unify/r/1.600000'
    )
    expect(
      eastmoneyVerificationPageUrl('https://datacenter-web.eastmoney.com/api/data/v1/get')
    ).toBe('https://data.eastmoney.com/')
  })

  it('ignores hidden script templates on normal pages and recognizes challenge titles', () => {
    expect(
      hasEastmoneyChallenge('<title>股票行情</title><script>const template = "安全验证"</script>')
    ).toBe(false)
    expect(hasEastmoneyChallenge('<title>安全验证</title>')).toBe(true)
    expect(hasEastmoneyChallenge('请按住滑块，拖动到最右边')).toBe(true)
  })

  it('rejects empty or failed payloads as evidence of recovery', () => {
    for (const payload of [
      null,
      { data: null },
      { data: { diff: [] } },
      { data: { data: [] } },
      { success: false, data: { message: 'failed' } }
    ]) {
      expect(hasEastmoneyResponseData(payload)).toBe(false)
    }
    expect(hasEastmoneyResponseData({ data: { klines: ['2026-11-13,10,10'] } })).toBe(true)
  })
})
