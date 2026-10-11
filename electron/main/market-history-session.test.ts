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
})
