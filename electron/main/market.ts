import { net } from 'electron'
import type { KlineResult, SearchResult, StockQuote, WatchStock } from '../../src/shared/types'

const SEARCH_TOKEN = 'D43BF722C8E33A67B1BDCC6FDED9C901'
const EASTMONEY_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

interface EastmoneySearchItem {
  Code?: string
  Name?: string
  QuoteID?: string
  SecurityTypeName?: string
  Classify?: string
}

interface EastmoneyQuoteItem {
  f2?: number | '-'
  f3?: number | '-'
  f4?: number | '-'
  f5?: number | '-'
  f6?: number | '-'
  f12?: string
  f14?: string
  f15?: number | '-'
  f16?: number | '-'
  f17?: number | '-'
  f18?: number | '-'
}

async function requestJson<T>(url: string): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await net.fetch(url, {
        headers: EASTMONEY_HEADERS,
        signal: AbortSignal.timeout(12_000)
      })

      if (!response.ok) {
        throw new Error(`行情服务返回 ${response.status}`)
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('行情服务暂时不可用')
}

function scaled(value: number | '-' | undefined): number | null {
  return typeof value === 'number' ? value / 100 : null
}

function rawNumber(value: number | '-' | undefined): number | null {
  return typeof value === 'number' ? value : null
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const normalized = query.trim()
  if (!normalized) return []

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get')
  url.searchParams.set('input', normalized)
  url.searchParams.set('type', '14')
  url.searchParams.set('token', SEARCH_TOKEN)
  url.searchParams.set('count', '10')

  const payload = await requestJson<{
    QuotationCodeTable?: { Data?: EastmoneySearchItem[] }
  }>(url.toString())

  return (payload.QuotationCodeTable?.Data ?? [])
    .filter((item) => item.Classify === 'AStock' && item.Code && item.Name && item.QuoteID)
    .map((item) => ({
      code: item.Code!,
      name: item.Name!,
      quoteId: item.QuoteID!,
      marketLabel: item.SecurityTypeName ?? 'A股'
    }))
}

export async function fetchQuotes(stocks: WatchStock[]): Promise<StockQuote[]> {
  if (stocks.length === 0) return []

  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get')
  url.searchParams.set('secids', stocks.map((stock) => stock.quoteId).join(','))
  url.searchParams.set('fields', 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18')

  const payload = await requestJson<{
    data?: { diff?: EastmoneyQuoteItem[] }
  }>(url.toString())
  const quoteIdByCode = new Map(stocks.map((stock) => [stock.code, stock.quoteId]))
  const now = new Date().toISOString()

  return (payload.data?.diff ?? []).map((item) => ({
    code: item.f12 ?? '',
    name: item.f14 ?? '',
    quoteId: quoteIdByCode.get(item.f12 ?? '') ?? '',
    latest: scaled(item.f2),
    changePercent: scaled(item.f3),
    change: scaled(item.f4),
    open: scaled(item.f17),
    high: scaled(item.f15),
    low: scaled(item.f16),
    previousClose: scaled(item.f18),
    volume: rawNumber(item.f5),
    amount: rawNumber(item.f6),
    updatedAt: now
  }))
}

function toKlineResult(quoteId: string, name: string | undefined, lines: string[]): KlineResult {
  if (lines.length === 0) throw new Error('行情服务未返回分时数据')

  const tradingDate = lines.at(-1)?.slice(0, 10) ?? ''
  const bars = lines
    .filter((line) => line.startsWith(tradingDate))
    .map((line) => {
      const [time, open, close, high, low, volume, amount] = line.split(',')
      return {
        time,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        amount: Number(amount)
      }
    })

  return { quoteId, name: name ?? '', tradingDate, bars }
}

async function fetchIntradayTrend(quoteId: string): Promise<KlineResult> {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/trends2/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('ndays', '1')
  url.searchParams.set('iscr', '0')
  url.searchParams.set('iscca', '0')
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')

  const payload = await requestJson<{
    data?: { name?: string; trends?: string[] }
  }>(url.toString())

  return toKlineResult(quoteId, payload.data?.name, payload.data?.trends ?? [])
}

async function fetchFiveMinuteKline(quoteId: string): Promise<KlineResult> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('klt', '5')
  url.searchParams.set('fqt', '1')
  url.searchParams.set('lmt', '120')
  url.searchParams.set('end', '20500101')
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')

  const payload = await requestJson<{
    data?: { name?: string; klines?: string[] }
  }>(url.toString())

  return toKlineResult(quoteId, payload.data?.name, payload.data?.klines ?? [])
}

export async function fetchKline(quoteId: string): Promise<KlineResult> {
  try {
    return await fetchIntradayTrend(quoteId)
  } catch {
    return fetchFiveMinuteKline(quoteId)
  }
}
