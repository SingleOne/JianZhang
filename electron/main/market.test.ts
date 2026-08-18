import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { fetchDailyMarketActiveQuotes, fetchOrderBook, fetchQuotes } from './market'

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

describe('fetchQuotes investment valuation fields', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('maps Eastmoney PE TTM and PB using the quote field scale', async () => {
    netFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        diff: [{
          f2: 130580,
          f3: -125,
          f4: -1650,
          f5: 33375,
          f6: 4382903655,
          f8: 27,
          f12: '600519',
          f13: 1,
          f14: '贵州茅台',
          f15: 133380,
          f16: 130350,
          f17: 132700,
          f18: 132230,
          f23: 692,
          f115: 1973
        }]
      }
    }))

    const result = await fetchQuotes([{
      code: '600519',
      name: '贵州茅台',
      quoteId: '1.600519',
      marketLabel: '沪A',
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: false
    }], [], 'test')

    expect(new URL(netFetch.mock.calls[0][0]).searchParams.get('fields')).toContain('f115')
    expect(result.quotes[0]).toMatchObject({
      priceEarningsRatioTtm: 19.73,
      priceBookRatio: 6.92
    })
  })

  it('publishes an update after asynchronously loading radar signals', async () => {
    const stock = {
      code: '600001',
      name: '异动测试',
      quoteId: '1.600001',
      marketLabel: '沪A',
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: true
    }
    const quotePayload = {
      data: {
        diff: [{
          f2: 1050,
          f3: 200,
          f4: 21,
          f5: 10_000,
          f6: 60_000_000,
          f8: 120,
          f12: stock.code,
          f13: 1,
          f14: stock.name,
          f15: 1060,
          f16: 1020,
          f17: 1030,
          f18: 1029
        }]
      }
    }
    const now = new Date()
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
      .join('')
    netFetch
      .mockResolvedValueOnce(jsonResponse({
        data: { allstock: [{ tm: 101530, c: stock.code, m: 1, t: 8201, i: '快速拉升,测试' }] }
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { data: [] } }))
      .mockResolvedValueOnce(jsonResponse(quotePayload))
    const onRadarSignalsUpdated = vi.fn()

    const initial = await fetchQuotes([stock], [stock], 'radar-test', onRadarSignalsUpdated)

    expect(initial.quotes[0].radarSignals).toBeUndefined()
    await vi.waitFor(() => expect(onRadarSignalsUpdated).toHaveBeenCalled())

    netFetch.mockResolvedValueOnce(jsonResponse(quotePayload))
    const refreshed = await fetchQuotes([stock], [stock], 'radar-test', onRadarSignalsUpdated)

    expect(refreshed.quotes[0].radarSignals).toEqual([{
      type: '8201',
      label: '火箭发射',
      date,
      time: '10:15:30',
      info: '快速拉升',
      direction: 'up'
    }])
  })
})

describe('fetchDailyMarketActiveQuotes', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('paginates by amount and stops after reaching the active cutoff', async () => {
    const quoteItem = (index: number, amount: number) => ({
      f2: 1050,
      f3: 200,
      f4: 21,
      f5: 10_000 + index,
      f6: amount,
      f8: 120,
      f12: String(600000 + index),
      f13: 1,
      f14: `测试${index}`,
      f15: 1060,
      f16: 1020,
      f17: 1030,
      f18: 1029
    })
    netFetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          total: 5_891,
          diff: Array.from({ length: 100 }, (_, index) => quoteItem(index, 60_000_000))
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          total: 5_891,
          diff: [quoteItem(100, 55_000_000), quoteItem(101, 50_000_000)]
        }
      }))

    const result = await fetchDailyMarketActiveQuotes(50_000_000)

    expect(result).toMatchObject({
      universeCount: 5_891,
      source: 'eastmoney-primary'
    })
    expect(result.quotes).toHaveLength(101)
    expect(result.quotes[0]).toMatchObject({
      latest: 10.5,
      changePercent: 2,
      amount: 60_000_000
    })
    expect(netFetch).toHaveBeenCalledTimes(2)
    expect(netFetch.mock.calls.map(([url]) => new URL(url).searchParams.get('pn'))).toEqual(['1', '2'])
    expect(new URL(netFetch.mock.calls[0][0]).searchParams.get('fid')).toBe('f6')
  })
})
