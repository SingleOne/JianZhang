import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { fetchOrderBook } from './market'

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => value)
  } as unknown as Response
}

function textResponse(value: string): Response {
  const bytes = Buffer.from(value, 'ascii')
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } as unknown as Response
}

function orderBookPayload(name = '测试股票') {
  return {
    data: {
      f43: 10.5,
      f58: name,
      f60: 10.2,
      f19: 10.01,
      f20: 500,
      f17: 10.02,
      f18: 400,
      f15: 10.03,
      f16: 300,
      f13: 10.04,
      f14: 200,
      f11: 10.05,
      f12: 100,
      f39: 10.11,
      f40: 600,
      f37: 10.12,
      f38: 700,
      f35: 10.13,
      f36: 800,
      f33: 10.14,
      f34: 900,
      f31: 10.15,
      f32: 1_000
    }
  }
}

describe('fetchOrderBook', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('uses the primary endpoint when it succeeds', async () => {
    netFetch.mockResolvedValueOnce(jsonResponse(orderBookPayload()))

    const result = await fetchOrderBook('1.600000', 'test')

    expect(new URL(netFetch.mock.calls[0][0]).hostname).toBe('push2.eastmoney.com')
    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      quoteId: '1.600000',
      name: '测试股票',
      latest: 10.5,
      previousClose: 10.2
    })
    expect(result.bids[0]).toEqual({ price: 10.01, volume: 500 })
    expect(result.asks[0]).toEqual({ price: 10.11, volume: 600 })
  })

  it('falls back to the delay endpoint and retries the primary endpoint next time', async () => {
    netFetch
      .mockRejectedValueOnce(new Error('主节点连接失败'))
      .mockResolvedValueOnce(jsonResponse(orderBookPayload('Delay 数据')))
      .mockResolvedValueOnce(jsonResponse(orderBookPayload('主节点恢复')))

    await expect(fetchOrderBook('1.600000', 'first')).resolves.toMatchObject({ name: 'Delay 数据' })
    await expect(fetchOrderBook('1.600000', 'second')).resolves.toMatchObject({ name: '主节点恢复' })

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'push2.eastmoney.com'
    ])
  })

  it('falls back to Tencent when both Eastmoney endpoints are unavailable', async () => {
    const fields = Array.from({ length: 39 }, () => '')
    fields[1] = 'Tencent Stock'
    fields[3] = '10.50'
    fields[4] = '10.20'
    fields.splice(9, 20,
      '10.01', '500', '10.02', '400', '10.03', '300', '10.04', '200', '10.05', '100',
      '10.11', '600', '10.12', '700', '10.13', '800', '10.14', '900', '10.15', '1000'
    )
    netFetch
      .mockRejectedValueOnce(new Error('主节点连接失败'))
      .mockResolvedValueOnce(jsonResponse({ data: { f43: 10.5, f58: 'Delay 数据', f60: 10.2 } }))
      .mockResolvedValueOnce(textResponse(`v_sh600000="${fields.join('~')}";`))

    const result = await fetchOrderBook('1.600000', 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'qt.gtimg.cn'
    ])
    expect(result).toMatchObject({
      quoteId: '1.600000',
      name: 'Tencent Stock',
      latest: 10.5,
      previousClose: 10.2
    })
    expect(result.bids[0]).toEqual({ price: 10.01, volume: 500 })
    expect(result.asks[0]).toEqual({ price: 10.11, volume: 600 })
  })

  it('reports all endpoint failures', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockRejectedValueOnce(new Error('Delay 节点连接失败'))
      .mockRejectedValueOnce(new Error('腾讯节点连接失败'))

    await expect(fetchOrderBook('1.600000', 'test')).rejects.toThrow(
      '盘口数据源均不可用（东方财富主节点：行情服务未返回五档数据；东方财富Delay节点：Delay 节点连接失败；腾讯盘口：腾讯节点连接失败）'
    )
  })
})
