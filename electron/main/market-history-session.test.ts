import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetch, historyFetch, refresh, getCookies, httpsGet } = vi.hoisted(() => ({
  netFetch: vi.fn(),
  historyFetch: vi.fn(),
  refresh: vi.fn(),
  getCookies: vi.fn(),
  httpsGet: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: netFetch } }))
vi.mock('node:https', () => ({ get: httpsGet }))
vi.mock('./eastmoney-history-session', () => ({
  eastmoneyHistorySession: {
    getSession: async () => ({ fetch: historyFetch }),
    getCookieHeader: getCookies,
    refresh,
    generation: 0
  }
}))

import { fetchKline } from './market'

function klinePayload(name = '测试股票') {
  return {
    data: {
      name,
      klines: ['2026-10-09,10.00,10.20,10.30,9.90,100,102000,0,2.00,0.20,1.00']
    }
  }
}

describe('historical K-line session recovery', () => {
  beforeEach(() => {
    netFetch.mockReset()
    historyFetch.mockReset()
    refresh.mockReset().mockResolvedValue(true)
    getCookies.mockReset().mockResolvedValue({ Cookie: 'history-session=fresh' })
    httpsGet.mockReset().mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter()
      const response = Object.assign(new EventEmitter(), { statusCode: 200 })
      queueMicrotask(() => {
        callback(response)
        response.emit('data', Buffer.from(JSON.stringify(klinePayload('镜像数据'))))
        response.emit('end')
      })
      return request
    })
  })

  it('sends primary requests through the dedicated session with cookies enabled', async () => {
    historyFetch.mockResolvedValueOnce(new Response(JSON.stringify(klinePayload())))

    await expect(fetchKline('1.600000', 'daily')).resolves.toMatchObject({
      source: 'eastmoney-primary'
    })
    expect(historyFetch).toHaveBeenCalledWith(
      expect.stringContaining('push2his.eastmoney.com'),
      expect.objectContaining({ credentials: 'include' })
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('refreshes a rejected session and retries primary before using the mirror', async () => {
    historyFetch
      .mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))
      .mockResolvedValueOnce(new Response(JSON.stringify(klinePayload())))

    await expect(fetchKline('1.600000', 'daily')).resolves.toMatchObject({
      source: 'eastmoney-primary'
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith(0)
    expect(historyFetch).toHaveBeenCalledTimes(2)
    expect(httpsGet).not.toHaveBeenCalled()
  })

  it('passes the refreshed primary-origin cookies to the mirror with its Host override', async () => {
    historyFetch.mockRejectedValue(new Error('net::ERR_EMPTY_RESPONSE'))

    await expect(fetchKline('1.600000', 'daily')).resolves.toMatchObject({
      name: '镜像数据',
      source: 'eastmoney-mirror'
    })
    expect(httpsGet).toHaveBeenCalledWith(
      expect.stringContaining('push2delay.eastmoney.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Host: 'push2his.eastmoney.com',
          Cookie: 'history-session=fresh'
        })
      }),
      expect.any(Function)
    )
    expect(getCookies).toHaveBeenCalledWith(expect.stringContaining('push2his.eastmoney.com'))
  })

  it('still falls back to Tencent when initialization and the mirror fail', async () => {
    historyFetch.mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))
    refresh.mockRejectedValueOnce(new Error('东方财富行情会话初始化超时'))
    getCookies.mockResolvedValueOnce({})
    httpsGet.mockImplementationOnce(() => {
      const request = new EventEmitter()
      queueMicrotask(() => request.emit('error', new Error('socket hang up')))
      return request
    })
    netFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            sh600000: {
              qt: { sh600000: ['', '腾讯数据'] },
              qfqday: [['2026-10-09', '10.00', '10.20', '10.30', '9.90', '100']]
            }
          }
        })
      )
    )

    const result = await fetchKline('1.600000', 'daily')
    expect(result).toMatchObject({ source: 'tencent' })
    expect(result.fallbackReason).toContain('东方财富行情会话初始化超时')
    expect(result.bars).toHaveLength(1)
  })

  describe('Tencent K-line nodes', () => {
    function tencentPayload(key = 'qfqday', symbol = 'sh600000') {
      return {
        code: 0,
        data: {
          [symbol]: {
            qt: { [symbol]: ['', '腾讯数据'] },
            [key]: [
              [
                key === 'm5' ? '202610090930' : '2026-10-09',
                '10.00',
                '10.20',
                '10.30',
                '9.90',
                '100'
              ]
            ]
          }
        }
      }
    }

    beforeEach(() => {
      historyFetch.mockRejectedValue(new Error('net::ERR_EMPTY_RESPONSE'))
      refresh.mockResolvedValue(false)
      httpsGet.mockImplementation(() => {
        const request = new EventEmitter()
        queueMicrotask(() => request.emit('error', new Error('socket hang up')))
        return request
      })
    })

    it('keeps the primary Tencent node first on every request when it succeeds', async () => {
      netFetch.mockImplementation(async () => new Response(JSON.stringify(tencentPayload())))

      await fetchKline('1.600000', 'daily')
      await fetchKline('1.600000', 'daily')

      expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
        'ifzq.gtimg.cn',
        'ifzq.gtimg.cn'
      ])
    })

    it.each([
      ['1.600000', 'daily', 'qfqday', 120, 'sh600000'],
      ['1.600000', 'weekly', 'qfqweek', 104, 'sh600000'],
      ['1.600000', 'monthly', 'qfqmonth', 60, 'sh600000'],
      ['1.600000', 'fiveDay', 'm5', 240, 'sh600000'],
      ['116.00700', 'daily', 'day', 120, 'hk00700'],
      ['116.00700', 'weekly', 'week', 104, 'hk00700'],
      ['116.00700', 'monthly', 'month', 60, 'hk00700']
    ] as const)(
      'recovers %s %s from a primary WAF 501 using the web node',
      async (quoteId, period, key, limit, symbol) => {
        netFetch
          .mockResolvedValueOnce(new Response('<html>WAF</html>', { status: 501 }))
          .mockResolvedValueOnce(new Response(JSON.stringify(tencentPayload(key, symbol))))

        const result = await fetchKline(quoteId, period, limit, 'test:tencent-fallback')

        const requests = netFetch.mock.calls.map(([url]) => new URL(url))
        expect(requests.map((url) => url.hostname)).toEqual(['ifzq.gtimg.cn', 'web.ifzq.gtimg.cn'])
        expect(requests[1].pathname).toBe(requests[0].pathname)
        expect(requests[1].search).toBe(requests[0].search)
        expect(requests[1].searchParams.get('param')).toBe(
          period === 'fiveDay'
            ? `${symbol},m5,,240`
            : `${symbol},${key.replace('qfq', '')},,,${limit},qfq`
        )
        expect(netFetch.mock.calls[1][1].headers).toEqual(netFetch.mock.calls[0][1].headers)
        expect(result).toMatchObject({ quoteId, source: 'tencent' })
        expect(result.bars).toHaveLength(1)
        expect(result.bars[0]).toMatchObject({ close: 10.2, volume: 100 })
      }
    )

    it.each([
      ['invalid JSON', '<html>WAF</html>'],
      ['business error', JSON.stringify({ code: 1, msg: '腾讯主节点不可用' })],
      ['empty bars', JSON.stringify({ code: 0, data: {} })]
    ])('tries the web node after primary %s', async (_name, body) => {
      netFetch
        .mockResolvedValueOnce(new Response(body))
        .mockResolvedValueOnce(new Response(JSON.stringify(tencentPayload())))

      await expect(fetchKline('1.600000', 'daily')).resolves.toMatchObject({
        source: 'tencent'
      })
      expect(new URL(netFetch.mock.calls[1][0]).hostname).toBe('web.ifzq.gtimg.cn')
    })

    it('tries the primary again after a previous request used the web node', async () => {
      netFetch
        .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
        .mockResolvedValueOnce(new Response(JSON.stringify(tencentPayload())))
        .mockResolvedValueOnce(new Response(JSON.stringify(tencentPayload())))

      await fetchKline('1.600000', 'daily')
      await fetchKline('1.600000', 'daily')

      expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
        'ifzq.gtimg.cn',
        'web.ifzq.gtimg.cn',
        'ifzq.gtimg.cn'
      ])
    })

    it('reports both Tencent node failures when neither is available', async () => {
      netFetch
        .mockResolvedValueOnce(new Response('WAF', { status: 501 }))
        .mockRejectedValueOnce(new Error('web node disconnected'))

      await expect(fetchKline('1.600000', 'daily')).rejects.toThrow(
        '腾讯行情节点均不可用（ifzq.gtimg.cn：行情服务返回 501；web.ifzq.gtimg.cn：web node disconnected）'
      )
      expect(netFetch).toHaveBeenCalledTimes(2)
    })
  })
})
