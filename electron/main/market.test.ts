import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import {
  fetchDailyMarketActiveQuotes,
  fetchKline,
  fetchOrderBook,
  fetchQuotes,
  searchStocks
} from './market'

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
    arrayBuffer: vi.fn(async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    )
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

function intradayPayload(name = '测试股票') {
  return {
    data: {
      name,
      trends: [
        '2026-08-28 09:30,10.00,10.10,10.20,9.90,100,101000.00,10.100',
        '2026-08-28 09:31,10.10,10.20,10.30,10.00,200,204000.00,10.150'
      ]
    }
  }
}

function tencentMinutePayload() {
  return {
    code: 0,
    data: {
      sh600000: {
        qt: { sh600000: ['', '测试股票'] },
        m1: [
          ['202608280930', '10.00', '10.10', '10.20', '9.90', '100'],
          ['202608280931', '10.10', '10.20', '10.30', '10.00', '200']
        ]
      }
    }
  }
}

function tencentGlobalMinutePayload() {
  return {
    code: 0,
    data: {
      hk00700: {
        qt: { hk00700: ['', '腾讯控股'] },
        data: {
          date: '20260828',
          data: ['0930 444.000 1000 444000.00', '0931 445.000 1500 666500.00']
        }
      }
    }
  }
}

function sinaMinutePayload() {
  return {
    result: {
      status: { code: 0 },
      data: [
        {
          day: '2026-08-28 09:30:00',
          open: '10.00',
          high: '10.20',
          low: '9.90',
          close: '10.10',
          volume: '10000',
          amount: '101000.00'
        },
        {
          day: '2026-08-28 09:31:00',
          open: '10.10',
          high: '10.30',
          low: '10.00',
          close: '10.20',
          volume: '20000',
          amount: '204000.00'
        }
      ]
    }
  }
}

describe('fetchKline intraday sources', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('uses the Eastmoney primary intraday endpoint first', async () => {
    netFetch.mockResolvedValueOnce(jsonResponse(intradayPayload()))

    const result = await fetchKline('1.600000', 'intraday', undefined, 'test')

    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(new URL(netFetch.mock.calls[0][0]).hostname).toBe('push2.eastmoney.com')
    expect(result).toMatchObject({ source: 'eastmoney-primary', intervalMinutes: 1 })
  })

  it('falls back from Eastmoney primary to its mirror before Tencent', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse(intradayPayload('镜像数据')))

    const result = await fetchKline('1.600000', 'intraday', undefined, 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com'
    ])
    expect(result).toMatchObject({
      name: '镜像数据',
      source: 'eastmoney-mirror',
      intervalMinutes: 1
    })
  })

  it('uses Tencent one-minute data after both Eastmoney endpoints fail', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse(tencentMinutePayload()))

    const result = await fetchKline('1.600000', 'intraday', undefined, 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'ifzq.gtimg.cn'
    ])
    expect(new URL(netFetch.mock.calls[2][0]).searchParams.get('param')).toContain(',m1,,480')
    expect(result).toMatchObject({ source: 'tencent', intervalMinutes: 1 })
  })

  it('uses Sina one-minute data last for A shares', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ code: 1, msg: '腾讯分时不可用' }))
      .mockResolvedValueOnce(jsonResponse(sinaMinutePayload()))

    const result = await fetchKline('1.600000', 'intraday', undefined, 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'ifzq.gtimg.cn',
      'quotes.sina.cn'
    ])
    expect(result).toMatchObject({ source: 'sina', intervalMinutes: 1 })
    expect(result.bars[0].volume).toBe(100)
  })

  it('uses the Tencent minute endpoint for Hong Kong stocks', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse(tencentGlobalMinutePayload()))

    const result = await fetchKline('116.00700', 'intraday', undefined, 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'web.ifzq.gtimg.cn'
    ])
    expect(result).toMatchObject({
      name: '腾讯控股',
      source: 'tencent',
      intervalMinutes: 1
    })
    expect(result.bars[1]).toMatchObject({ volume: 500, amount: 222500 })
  })

  it('keeps the five-minute fallback after every one-minute source fails', async () => {
    netFetch
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ code: 1, msg: '腾讯分时不可用' }))
      .mockResolvedValueOnce(
        jsonResponse({ result: { status: { code: 1, msg: '新浪分时不可用' } } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            name: '测试股票',
            klines: [
              '2026-08-27 15:00,9.90,10.00,10.10,9.80,100,100000,0,0,0,1.00',
              '2026-08-28 09:30,10.00,10.10,10.20,9.90,200,202000,0,0,0,1.10'
            ]
          }
        })
      )

    const result = await fetchKline('1.600000', 'intraday', undefined, 'test')

    expect(netFetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'push2.eastmoney.com',
      'push2delay.eastmoney.com',
      'ifzq.gtimg.cn',
      'quotes.sina.cn',
      'push2his.eastmoney.com'
    ])
    expect(result).toMatchObject({ source: 'eastmoney-primary', intervalMinutes: 5 })
    expect(result.bars).toHaveLength(1)
    expect(result.fallbackReason).toContain('1分钟分时数据源均不可用')
  })
})

describe('searchStocks', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('保留沪深 A 股和 ETF，过滤指数', async () => {
    netFetch.mockResolvedValueOnce(
      jsonResponse({
        QuotationCodeTable: {
          Data: [
            {
              Code: '600362',
              Name: '江西铜业',
              QuoteID: '1.600362',
              SecurityType: '1',
              SecurityTypeName: '沪A',
              TypeUS: '2'
            },
            {
              Code: '300750',
              Name: '宁德时代',
              QuoteID: '0.300750',
              SecurityType: '2',
              SecurityTypeName: '深A',
              TypeUS: '80'
            },
            {
              Code: '510300',
              Name: '沪深300ETF华泰柏瑞',
              QuoteID: '1.510300',
              SecurityType: '8',
              SecurityTypeName: '基金',
              TypeUS: '9'
            },
            {
              Code: '000001',
              Name: '上证指数',
              QuoteID: '1.000001',
              SecurityType: '5',
              SecurityTypeName: '指数',
              TypeUS: '1'
            }
          ]
        }
      })
    )

    const result = await searchStocks('600362')

    expect(
      result.map(({ code, quoteId, instrumentType }) => ({ code, quoteId, instrumentType }))
    ).toEqual([
      { code: '600362', quoteId: '1.600362', instrumentType: 'stock' },
      { code: '300750', quoteId: '0.300750', instrumentType: 'stock' },
      { code: '510300', quoteId: '1.510300', instrumentType: 'etf' }
    ])
  })
})

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
    await expect(fetchOrderBook('1.600000', 'second')).resolves.toMatchObject({
      name: '主节点恢复'
    })

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
    fields.splice(
      9,
      20,
      '10.01',
      '500',
      '10.02',
      '400',
      '10.03',
      '300',
      '10.04',
      '200',
      '10.05',
      '100',
      '10.11',
      '600',
      '10.12',
      '700',
      '10.13',
      '800',
      '10.14',
      '900',
      '10.15',
      '1000'
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

  it('uses the index scale and market identity for global indexes', async () => {
    netFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
              f2: 2_640_242,
              f3: -52,
              f4: -13_893,
              f12: 'NDX',
              f13: 100,
              f14: '纳斯达克',
              f15: 2_670_068,
              f16: 2_635_927,
              f17: 2_651_599,
              f18: 2_654_135
            }
          ]
        }
      })
    )

    const result = await fetchQuotes(
      [
        {
          code: 'NDX',
          name: '纳斯达克',
          quoteId: '100.NDX',
          marketLabel: '美股指数',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: false
        }
      ],
      [],
      'test'
    )

    expect(result.quotes[0]).toMatchObject({
      market: 'US',
      currency: 'USD',
      latest: 26_402.42,
      change: -138.93,
      open: 26_515.99,
      high: 26_700.68,
      low: 26_359.27,
      previousClose: 26_541.35
    })
  })

  it('uses the three-decimal Eastmoney scale for US prices', async () => {
    netFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
              f2: 311335,
              f3: 46,
              f4: 1435,
              f5: 2_010_856,
              f6: 623_959_088,
              f8: 93,
              f12: 'AAPL',
              f13: 105,
              f14: '苹果',
              f15: 311680,
              f16: 308800,
              f17: 310245,
              f18: 309900,
              f23: 4227,
              f115: 3525
            }
          ]
        }
      })
    )

    const result = await fetchQuotes(
      [
        {
          code: 'AAPL',
          name: '苹果',
          quoteId: '105.AAPL',
          marketLabel: '纳斯达克',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: false
        }
      ],
      [],
      'test'
    )

    expect(result.quotes[0]).toMatchObject({
      latest: 311.335,
      changePercent: 0.46,
      change: 1.435,
      open: 310.245,
      high: 311.68,
      low: 308.8,
      previousClose: 309.9,
      priceEarningsRatioTtm: 35.25,
      priceBookRatio: 42.27
    })
  })

  it('uses the three-decimal Eastmoney scale for Hong Kong prices', async () => {
    netFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
              f2: 445400,
              f3: 77,
              f4: 3400,
              f12: '00700',
              f13: 116,
              f14: '腾讯控股',
              f15: 450000,
              f16: 443000,
              f17: 448000,
              f18: 442000
            }
          ]
        }
      })
    )

    const result = await fetchQuotes(
      [
        {
          code: '00700',
          name: '腾讯控股',
          quoteId: '116.00700',
          marketLabel: '港股',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: false
        }
      ],
      [],
      'test'
    )

    expect(result.quotes[0]).toMatchObject({
      latest: 445.4,
      changePercent: 0.77,
      change: 3.4,
      open: 448,
      high: 450,
      low: 443,
      previousClose: 442
    })
  })

  it('maps Eastmoney PE TTM and PB using the quote field scale', async () => {
    netFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
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
              f20: 1_633_169_107_626,
              f23: 692,
              f115: 1973
            }
          ]
        }
      })
    )

    const result = await fetchQuotes(
      [
        {
          code: '600519',
          name: '贵州茅台',
          quoteId: '1.600519',
          marketLabel: '沪A',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: false
        }
      ],
      [],
      'test'
    )

    expect(new URL(netFetch.mock.calls[0][0]).searchParams.get('fields')).toContain('f115')
    expect(new URL(netFetch.mock.calls[0][0]).searchParams.get('fields')).toContain('f20')
    expect(result.quotes[0]).toMatchObject({
      totalMarketValue: 1_633_169_107_626,
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
        diff: [
          {
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
          }
        ]
      }
    }
    const now = new Date()
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
      .join('')
    netFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: { allstock: [{ tm: 101530, c: stock.code, m: 1, t: 8201, i: '快速拉升,测试' }] }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { data: [] } }))
      .mockResolvedValueOnce(jsonResponse(quotePayload))
    const onRadarSignalsUpdated = vi.fn()

    const initial = await fetchQuotes([stock], [stock], 'radar-test', onRadarSignalsUpdated)

    expect(initial.quotes[0].radarSignals).toBeUndefined()
    await vi.waitFor(() => expect(onRadarSignalsUpdated).toHaveBeenCalled())

    netFetch.mockResolvedValueOnce(jsonResponse(quotePayload))
    const refreshed = await fetchQuotes([stock], [stock], 'radar-test', onRadarSignalsUpdated)

    expect(refreshed.quotes[0].radarSignals).toEqual([
      {
        type: '8201',
        label: '火箭发射',
        date,
        time: '10:15:30',
        info: '快速拉升',
        direction: 'up'
      }
    ])
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
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            total: 5_891,
            diff: Array.from({ length: 100 }, (_, index) => quoteItem(index, 60_000_000))
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            total: 5_891,
            diff: [quoteItem(100, 55_000_000), quoteItem(101, 50_000_000)]
          }
        })
      )

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
    expect(netFetch.mock.calls.map(([url]) => new URL(url).searchParams.get('pn'))).toEqual([
      '1',
      '2'
    ])
    expect(new URL(netFetch.mock.calls[0][0]).searchParams.get('fid')).toBe('f6')
  })
})
