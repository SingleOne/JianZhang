import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestJson, requestText } from './official-utils'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const nodeFetch = vi.fn<typeof fetch>()
const url = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'

beforeEach(() => {
  vi.mocked(net.fetch).mockReset()
  nodeFetch.mockReset()
  vi.stubGlobal('fetch', nodeFetch)
})

afterEach(() => vi.unstubAllGlobals())

describe('official news requests', () => {
  it('uses Chromium when the system connection succeeds', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response('{"announcements":[]}'))

    expect(await requestJson(url)).toEqual({ announcements: [] })
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('retries through Node with the same POST and headers after a Chromium timeout', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new DOMException('operation timed out', 'TimeoutError'))
    nodeFetch.mockResolvedValue(new Response('{"announcements":[]}'))
    const body = 'stock=000876%2Cgssz0000876'

    await requestJson(url, {
      method: 'POST',
      headers: new Headers({
        Referer: 'https://www.cninfo.com.cn/',
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      body
    })

    const first = vi.mocked(net.fetch).mock.calls[0][1]!
    const fallback = nodeFetch.mock.calls[0][1]!
    expect(fallback).toMatchObject({ method: 'POST', body })
    expect(new Headers(fallback.headers).get('referer')).toBe('https://www.cninfo.com.cn/')
    expect(new Headers(fallback.headers).get('user-agent')).toContain('Mozilla/5.0')
    expect(fallback.signal).not.toBe(first.signal)
  })

  it('also recovers when the response body stalls', async () => {
    vi.mocked(net.fetch).mockResolvedValue({
      ok: true,
      text: () => Promise.reject(new DOMException('timeout', 'TimeoutError'))
    } as Response)
    nodeFetch.mockResolvedValue(new Response('recovered'))

    expect(await requestText(url, { method: 'POST' })).toBe('recovered')
    expect(nodeFetch.mock.calls[0][1]?.body).toBe('')
  })

  it('keeps HTTP rejections visible without retrying through another connection', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response('forbidden', { status: 403 }))

    await expect(requestText(url)).rejects.toThrow('HTTP 403')
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('does not retry invalid JSON or an explicit caller cancellation', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('not JSON'))
    await expect(requestJson(url)).rejects.toBeInstanceOf(SyntaxError)

    const controller = new AbortController()
    controller.abort()
    vi.mocked(net.fetch).mockRejectedValueOnce(controller.signal.reason)
    await expect(requestText(url, { signal: controller.signal })).rejects.toThrow()
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('surfaces failure when both connections time out', async () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    vi.mocked(net.fetch).mockRejectedValue(error)
    nodeFetch.mockRejectedValue(error)

    await expect(requestText(url)).rejects.toBe(error)
    expect(nodeFetch).toHaveBeenCalledTimes(1)
  })
})
