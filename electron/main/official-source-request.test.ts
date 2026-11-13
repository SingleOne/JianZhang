import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOfficialSource, requestOfficialSourceBytes } from './official-source-request'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const nodeFetch = vi.fn<typeof fetch>()
const url = 'https://static.cninfo.com.cn/finalpage/report.PDF'

beforeEach(() => {
  vi.mocked(net.fetch).mockReset()
  nodeFetch.mockReset()
  vi.stubGlobal('fetch', nodeFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('official source connections', () => {
  it('preserves POST, headers, caller signal and manual redirect handling on a 403 retry', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 403 }))
    nodeFetch.mockResolvedValue(new Response('recovered'))
    const controller = new AbortController()
    const options: RequestInit = {
      method: 'POST',
      body: 'stock=000001%2Cgssz0000001',
      headers: { 'User-Agent': 'JianZhang test', Referer: 'https://www.cninfo.com.cn/' },
      signal: controller.signal,
      redirect: 'manual'
    }

    expect((await fetchOfficialSource(url, options)).status).toBe(200)
    expect(nodeFetch).toHaveBeenCalledTimes(1)
    const retried = nodeFetch.mock.calls[0][1]!
    expect(retried).toMatchObject({
      method: options.method,
      body: options.body,
      headers: options.headers,
      redirect: 'manual'
    })
    expect(retried.signal).not.toBe(vi.mocked(net.fetch).mock.calls[0][1]?.signal)
    controller.abort()
    expect(retried.signal?.aborted).toBe(true)
  })

  it.each([401, 404, 429, 500])('does not retry HTTP %i', async (status) => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status }))
    await expect(requestOfficialSourceBytes(url)).rejects.toThrow(`HTTP ${status}`)
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('keeps the second HTTP 403 visible after one retry', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 403 }))
    nodeFetch.mockResolvedValue(new Response(null, { status: 403 }))

    await expect(requestOfficialSourceBytes(url)).rejects.toThrow('HTTP 403')
    expect(nodeFetch).toHaveBeenCalledTimes(1)
  })

  it('retries a connection timeout with a fresh timeout signal', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    nodeFetch.mockResolvedValue(new Response('document'))

    const result = await requestOfficialSourceBytes(url)

    expect(new TextDecoder().decode(result.bytes)).toBe('document')
    expect(nodeFetch.mock.calls[0][1]?.signal).not.toBe(
      vi.mocked(net.fetch).mock.calls[0][1]?.signal
    )
  })

  it('does not start either connection after caller cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchOfficialSource(url, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(net.fetch).not.toHaveBeenCalled()
    expect(nodeFetch).not.toHaveBeenCalled()
  })

  it('paces SEC retries and documents through the same request queue', async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const times: number[] = []
    vi.mocked(net.fetch).mockImplementation(async () => {
      times.push(Date.now() - start)
      return new Response(null, { status: 403 })
    })
    nodeFetch.mockImplementation(async () => {
      times.push(Date.now() - start)
      return new Response('document')
    })

    const pending = [
      fetchOfficialSource('https://data.sec.gov/submissions/CIK0000320193.json'),
      fetchOfficialSource('https://www.sec.gov/Archives/edgar/data/320193/report.htm')
    ]
    await vi.advanceTimersByTimeAsync(450)
    await Promise.all(pending)

    expect(times).toEqual([0, 150, 300, 450])
  })
})
