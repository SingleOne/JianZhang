import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchStock } from '../../src/shared/types'

const { netFetch, httpsGet } = vi.hoisted(() => ({
  netFetch: vi.fn(),
  httpsGet: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: netFetch } }))
vi.mock('node:https', () => ({ get: httpsGet }))

import { fetchQuotes } from './market'

function watchStock(quoteId: string): WatchStock {
  return {
    quoteId,
    code: quoteId.split('.')[1],
    name: 'TestStock',
    marketLabel: '测试',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: false
  }
}

function textResponse(value: string): Response {
  const bytes = Buffer.from(value, 'ascii')
  return {
    ok: true,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  } as Response
}

function tencentQuote(): string {
  const fields = Array<string>(55).fill('')
  fields[1] = 'TestStock'
  fields[3] = '10.5'
  fields[4] = '10'
  fields[30] = '20261008150000'
  fields[31] = '0.5'
  fields[32] = '5'
  return `v_sh600000="${fields.join('~')}";`
}

describe('fetchQuotes sector isolation', () => {
  const stock = watchStock('1.600000')
  const board = watchStock('90.BK0475')

  beforeEach(() => {
    netFetch.mockReset()
    httpsGet.mockReset()
    httpsGet.mockImplementation(() => {
      const request = new EventEmitter()
      queueMicrotask(() => request.emit('error', new Error('socket hang up')))
      return request
    })
    netFetch.mockImplementation(async (url: string) => {
      const hostname = new URL(url).hostname
      if (hostname === 'push2.eastmoney.com') throw new Error('net::ERR_EMPTY_RESPONSE')
      return textResponse(hostname === 'qt.gtimg.cn' ? tencentQuote() : '')
    })
  })

  it('keeps Tencent stock quotes when Eastmoney sector quotes fail', async () => {
    const result = await fetchQuotes([stock, board], [], 'quote-cycle:manual')

    expect(result.quotes).toEqual([
      expect.objectContaining({ quoteId: stock.quoteId, latest: 10.5, source: 'tencent' })
    ])
    expect(result.source).toBe('tencent')
    expect(result.warning).toContain('行业板块行情数据源均不可用')
    expect(result.warning).not.toContain('CN 行情数据源均不可用')
    const requests = netFetch.mock.calls.map(([url]) => new URL(url))
    expect(
      requests.filter((url) => url.hostname === 'qt.gtimg.cn').map((url) => url.pathname)
    ).toEqual(['/q=sh600000'])
    expect(requests.some((url) => url.hostname === 'hq.sinajs.cn')).toBe(false)
  })

  it('retains both stock and sector quotes when Eastmoney succeeds', async () => {
    netFetch.mockImplementation(async (value: string) => {
      const url = new URL(value)
      const diff = (url.searchParams.get('secids') ?? '').split(',').map((quoteId) => {
        const [market, code] = quoteId.split('.')
        return { f12: code, f13: Number(market), f14: 'TestStock', f2: 1050 }
      })
      return { ok: true, json: async () => ({ data: { diff } }) } as Response
    })

    const result = await fetchQuotes([stock, board], [], 'quote-cycle:manual')

    expect(result.quotes.map((quote) => quote.quoteId)).toEqual([stock.quoteId, board.quoteId])
    expect(result.warning).toBeUndefined()
    expect(result.source).toBe('eastmoney-primary')
    expect(netFetch.mock.calls.map(([url]) => new URL(url).searchParams.get('secids'))).toEqual([
      stock.quoteId,
      board.quoteId
    ])
    expect(httpsGet).not.toHaveBeenCalled()
  })

  it('tries the Eastmoney mirror for sectors without unsupported fallback requests', async () => {
    httpsGet.mockImplementation((_url, _options, onResponse) => {
      const request = new EventEmitter()
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200 })
        onResponse(response)
        response.emit(
          'data',
          Buffer.from(JSON.stringify({ data: { diff: [{ f12: board.code, f13: 90, f2: 1050 }] } }))
        )
        response.emit('end')
      })
      return request
    })

    const result = await fetchQuotes([board], [], 'detail:sector')

    expect(result.quotes[0]).toMatchObject({ quoteId: board.quoteId, source: 'eastmoney-mirror' })
    expect(result.source).toBe('eastmoney-delay')
    expect(result.warning).toBeUndefined()
    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(new URL(httpsGet.mock.calls[0][0]).hostname).toBe('push2delay.eastmoney.com')
  })

  it('rejects sector-only requests when both supported sources fail', async () => {
    await expect(fetchQuotes([board], [], 'detail:sector')).rejects.toThrow(
      '行业板块行情数据源均不可用'
    )

    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(httpsGet).toHaveBeenCalledTimes(1)
  })

  it('still reports missing ordinary stock quotes', async () => {
    await expect(
      fetchQuotes([stock, watchStock('1.600519')], [], 'quote-cycle:manual')
    ).rejects.toThrow('腾讯行情：缺少 600519 的行情数据')
  })
})
