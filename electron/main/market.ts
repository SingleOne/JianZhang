import { net } from 'electron'
import { get as httpsGet } from 'node:https'
import type {
  FundsFlowResult,
  KlineBar,
  KlinePeriod,
  KlineResult,
  OrderBookLevel,
  SearchResult,
  StockOrderBook,
  StockQuote,
  StockRadarSignal,
  WatchStock
} from '../../src/shared/types'
import type { MarketRequestLogger } from './market-request-logger'
import type { SectorBinding } from './sector-market-cache'
import {
  EASTMONEY_FIELDS,
  EASTMONEY_FIXED_PARAMS,
  EASTMONEY_HEADERS,
  EASTMONEY_RADAR_TOKEN,
  EASTMONEY_SEARCH_TOKEN,
  MARKET_INDEX_QUOTE_IDS,
  RADAR_LABELS,
  RADAR_TYPES,
  SINA_HEADERS,
  TENCENT_HEADERS
} from './market-constants'

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
  f8?: number | '-'
  f12?: string
  f13?: number | '-'
  f14?: string
  f15?: number | '-'
  f16?: number | '-'
  f17?: number | '-'
  f18?: number | '-'
  f23?: number | '-'
  f115?: number | '-'
  f124?: number | '-'
}

interface EastmoneyOrderBookData {
  f11?: number | '-'
  f12?: number | '-'
  f13?: number | '-'
  f14?: number | '-'
  f15?: number | '-'
  f16?: number | '-'
  f17?: number | '-'
  f18?: number | '-'
  f19?: number | '-'
  f20?: number | '-'
  f31?: number | '-'
  f32?: number | '-'
  f33?: number | '-'
  f34?: number | '-'
  f35?: number | '-'
  f36?: number | '-'
  f37?: number | '-'
  f38?: number | '-'
  f39?: number | '-'
  f40?: number | '-'
  f43?: number | '-'
  f58?: string
  f60?: number | '-'
}

interface EastmoneyRadarItem {
  tm: number
  c: string
  m: number
  t: number
  i: string
}

type RadarSignalMap = Map<string, StockRadarSignal[]>

type RadarSignalsUpdated = () => void

interface RadarCache {
  cachedAt: number
  date: string
  watchlistKey: string
  signals: RadarSignalMap
}

let todayRadarCache: RadarCache | undefined
let historyRadarCache: RadarCache | undefined
let todayRadarRefresh: Promise<void> | undefined
let historyRadarRefresh: Promise<void> | undefined

let marketRequestLogger: MarketRequestLogger | null = null

export interface QuoteBatchResult {
  quotes: StockQuote[]
  source: string
}

export interface DailyMarketActiveQuote extends StockQuote {
  tradingDate: string
}

export interface DailyMarketActiveQuotesResult {
  quotes: DailyMarketActiveQuote[]
  source: string
  universeCount: number
}

interface MarketRequestOptions<T> {
  dataType: string
  caller: string
  source: string
  fallbackFrom?: string
  requestedCount?: number
  maxAttempts?: number
  headers?: Record<string, string>
  returnedCount?: (value: T) => number
}

interface MarketTextRequestOptions {
  dataType: string
  caller: string
  source: string
  fallbackFrom?: string
  requestedCount?: number
  headers?: Record<string, string>
  encoding?: string
  returnedCount?: (value: string) => number
}

export function setMarketRequestLogger(logger: MarketRequestLogger): void {
  marketRequestLogger = logger
}

function trackedRequest<T>(
  options: Pick<MarketRequestOptions<T>, 'dataType' | 'caller' | 'source' | 'fallbackFrom' | 'requestedCount'> & { attempt?: number },
  operation: () => Promise<T>,
  returnedCount?: (value: T) => number
): Promise<T> {
  const details = {
    dataType: options.dataType,
    caller: options.caller,
    source: options.source,
    fallbackFrom: options.fallbackFrom,
    requestedCount: options.requestedCount,
    attempt: options.attempt
  }
  return marketRequestLogger
    ? marketRequestLogger.track(details, operation, returnedCount)
    : operation()
}

async function requestJson<T>(
  url: string,
  options: MarketRequestOptions<T>
): Promise<T> {
  let lastError: unknown
  const maxAttempts = options.maxAttempts ?? 2

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await trackedRequest({ ...options, attempt: attempt + 1 }, async () => {
        const response = await net.fetch(url, {
          headers: options.headers ?? EASTMONEY_HEADERS,
          signal: AbortSignal.timeout(12_000)
        })

        if (!response.ok) throw new Error(`行情服务返回 ${response.status}`)
        return (await response.json()) as T
      }, options.returnedCount)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('行情服务暂时不可用')
}

async function requestJsonWithHost<T>(
  url: string,
  host: string,
  options: MarketRequestOptions<T>
): Promise<T> {
  return trackedRequest({ ...options, attempt: 1 }, () => new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: { ...(options.headers ?? EASTMONEY_HEADERS), Host: host },
      timeout: 12_000
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          reject(new Error(`行情服务返回 ${status}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('行情服务请求超时')))
    request.on('error', reject)
  }), options.returnedCount)
}

async function requestText(
  url: string,
  options: MarketTextRequestOptions
): Promise<string> {
  return trackedRequest({ ...options, attempt: 1 }, async () => {
    const response = await net.fetch(url, {
      headers: options.headers ?? EASTMONEY_HEADERS,
      signal: AbortSignal.timeout(12_000)
    })

    if (!response.ok) throw new Error(`行情服务返回 ${response.status}`)
    return new TextDecoder(options.encoding ?? 'utf-8').decode(await response.arrayBuffer())
  }, options.returnedCount)
}

function scaled(value: number | '-' | undefined): number | null {
  return typeof value === 'number' ? value / 100 : null
}

function rawNumber(value: number | '-' | undefined): number | null {
  return typeof value === 'number' ? value : null
}

function toEastmoneyQuote(item: EastmoneyQuoteItem, updatedAt: string): StockQuote {
  return {
    code: item.f12 ?? '',
    name: item.f14 ?? '',
    quoteId: typeof item.f13 === 'number' && item.f12 ? `${item.f13}.${item.f12}` : '',
    latest: scaled(item.f2),
    changePercent: scaled(item.f3),
    change: scaled(item.f4),
    open: scaled(item.f17),
    high: scaled(item.f15),
    low: scaled(item.f16),
    previousClose: scaled(item.f18),
    volume: rawNumber(item.f5),
    amount: rawNumber(item.f6),
    turnoverRate: scaled(item.f8),
    priceEarningsRatioTtm: scaled(item.f115),
    priceBookRatio: scaled(item.f23),
    updatedAt
  }
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const normalized = query.trim()
  if (!normalized) return []

  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get')
  url.searchParams.set('input', normalized)
  url.searchParams.set('type', EASTMONEY_FIXED_PARAMS.search.type)
  url.searchParams.set('token', EASTMONEY_SEARCH_TOKEN)
  url.searchParams.set('count', EASTMONEY_FIXED_PARAMS.search.count)

  const payload = await requestJson<{
    QuotationCodeTable?: { Data?: EastmoneySearchItem[] }
  }>(url.toString(), {
    dataType: 'stock-search',
    caller: 'search-bar',
    source: 'eastmoney-search',
    requestedCount: 1,
    returnedCount: (value) => value.QuotationCodeTable?.Data?.length ?? 0
  })

  return (payload.QuotationCodeTable?.Data ?? [])
    .filter((item) => item.Classify === 'AStock' && item.Code && item.Name && item.QuoteID)
    .map((item) => ({
      code: item.Code!,
      name: item.Name!,
      quoteId: item.QuoteID!,
      marketLabel: item.SecurityTypeName ?? 'A股'
    }))
}

function quoteNumber(value: string | undefined): number | null {
  if (!value) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function createEastmoneyQuotesUrl(origin: string, stocks: WatchStock[]): URL {
  const url = new URL('/api/qt/ulist.np/get', origin)
  url.searchParams.set('secids', stocks.map((stock) => stock.quoteId).join(','))
  url.searchParams.set('fields', EASTMONEY_FIELDS.quotes)
  return url
}

async function fetchEastmoneyQuotes(
  stocks: WatchStock[],
  useDelayNode: boolean,
  caller: string
): Promise<StockQuote[]> {
  type EastmoneyQuotePayload = { data?: { diff?: EastmoneyQuoteItem[] } }
  const primaryHost = 'push2.eastmoney.com'
  const url = createEastmoneyQuotesUrl(
    `https://${useDelayNode ? 'push2delay.eastmoney.com' : primaryHost}`,
    stocks
  )
  const payload = useDelayNode
    ? await requestJsonWithHost<EastmoneyQuotePayload>(url.toString(), primaryHost, {
        dataType: 'quotes',
        caller,
        source: 'eastmoney-delay',
        fallbackFrom: 'eastmoney-primary',
        requestedCount: stocks.length,
        returnedCount: (value) => value.data?.diff?.length ?? 0
      })
    : await requestJson<EastmoneyQuotePayload>(url.toString(), {
        dataType: 'quotes',
        caller,
        source: 'eastmoney-primary',
        requestedCount: stocks.length,
        maxAttempts: 1,
        returnedCount: (value) => value.data?.diff?.length ?? 0
      })
  const now = new Date().toISOString()

  return (payload.data?.diff ?? []).map((item) => toEastmoneyQuote(item, now))
}

interface EastmoneyMarketListPayload {
  data?: {
    total?: number
    diff?: EastmoneyQuoteItem[]
  }
}

function createDailyMarketScanQuotesUrl(origin: string, page: number): URL {
  const url = new URL('/api/qt/clist/get', origin)
  url.searchParams.set('pn', String(page))
  url.searchParams.set('pz', EASTMONEY_FIXED_PARAMS.dailyMarketScan.pageSize)
  url.searchParams.set('po', '1')
  url.searchParams.set('np', '1')
  url.searchParams.set('fid', 'f6')
  url.searchParams.set('fs', EASTMONEY_FIXED_PARAMS.dailyMarketScan.universe)
  url.searchParams.set('fields', EASTMONEY_FIELDS.dailyMarketScanQuotes)
  return url
}

async function fetchDailyMarketScanQuotesPage(
  page: number,
  useDelayNode: boolean
): Promise<EastmoneyMarketListPayload> {
  const primaryHost = 'push2.eastmoney.com'
  const source = useDelayNode ? 'eastmoney-delay' : 'eastmoney-primary'
  const url = createDailyMarketScanQuotesUrl(
    `https://${useDelayNode ? 'push2delay.eastmoney.com' : primaryHost}`,
    page
  )
  const options = {
    dataType: 'daily-market-scan:quotes',
    caller: 'daily-market-scan',
    source,
    fallbackFrom: useDelayNode ? 'eastmoney-primary' : undefined,
    requestedCount: Number(EASTMONEY_FIXED_PARAMS.dailyMarketScan.pageSize),
    maxAttempts: 1,
    returnedCount: (value: EastmoneyMarketListPayload) => value.data?.diff?.length ?? 0
  }
  return useDelayNode
    ? requestJsonWithHost(url.toString(), primaryHost, options)
    : requestJson(url.toString(), options)
}

export async function fetchDailyMarketActiveQuotes(
  minimumAmount: number
): Promise<DailyMarketActiveQuotesResult> {
  let useDelayNode = false
  let firstPage: EastmoneyMarketListPayload
  try {
    firstPage = await fetchDailyMarketScanQuotesPage(1, false)
  } catch {
    useDelayNode = true
    firstPage = await fetchDailyMarketScanQuotesPage(1, true)
  }

  const quotes: DailyMarketActiveQuote[] = []
  const updatedAt = new Date().toISOString()
  let page = 1
  let payload = firstPage
  while (true) {
    const items = payload.data?.diff
    if (!items) throw new Error('行情服务未返回全市场行情')
    quotes.push(...items
      .filter((item) => typeof item.f6 === 'number' && item.f6 > minimumAmount)
      .map((item) => ({
        ...toEastmoneyQuote(item, updatedAt),
        tradingDate: typeof item.f124 === 'number'
          ? new Date((item.f124 + 8 * 60 * 60) * 1000).toISOString().slice(0, 10)
          : ''
      }))
      .filter((quote) => Boolean(quote.quoteId && quote.code && quote.name)))

    const lastAmount = rawNumber(items.at(-1)?.f6)
    if (
      items.length < Number(EASTMONEY_FIXED_PARAMS.dailyMarketScan.pageSize) ||
      lastAmount === null ||
      lastAmount <= minimumAmount
    ) {
      break
    }
    page += 1
    try {
      payload = await fetchDailyMarketScanQuotesPage(page, useDelayNode)
    } catch (reason) {
      if (useDelayNode) throw reason
      useDelayNode = true
      payload = await fetchDailyMarketScanQuotesPage(page, true)
    }
  }

  return {
    quotes,
    universeCount: firstPage.data?.total ?? quotes.length,
    source: useDelayNode ? 'eastmoney-delay' : 'eastmoney-primary'
  }
}

async function fetchTencentQuotes(stocks: WatchStock[], caller: string): Promise<StockQuote[]> {
  const stockBySymbol = new Map(stocks.map((stock) => [toTencentSymbol(stock.quoteId), stock]))
  const symbols = [...stockBySymbol.keys()]
  const text = await requestText(
    `https://qt.gtimg.cn/q=${symbols.join(',')}`,
    {
      dataType: 'quotes',
      caller,
      source: 'tencent',
      fallbackFrom: 'eastmoney-delay',
      requestedCount: stocks.length,
      headers: TENCENT_HEADERS,
      encoding: 'gbk',
      returnedCount: (value) => [...value.matchAll(/v_([^=]+)="([^"]*)"/g)].length
    }
  )
  const now = new Date().toISOString()

  return [...text.matchAll(/v_([^=]+)="([^"]*)"/g)].flatMap((match) => {
    const stock = stockBySymbol.get(match[1])
    if (!stock) return []
    const fields = match[2].split('~')
    const summary = fields[35]?.split('/') ?? []
    return [{
      code: stock.code,
      name: fields[1] || stock.name,
      quoteId: stock.quoteId,
      latest: quoteNumber(fields[3]),
      changePercent: quoteNumber(fields[32]),
      change: quoteNumber(fields[31]),
      open: quoteNumber(fields[5]),
      high: quoteNumber(fields[33]),
      low: quoteNumber(fields[34]),
      previousClose: quoteNumber(fields[4]),
      volume: quoteNumber(fields[36] || fields[6]),
      amount: quoteNumber(summary[2]),
      turnoverRate: quoteNumber(fields[38]),
      priceEarningsRatioTtm: quoteNumber(fields[39]),
      priceBookRatio: quoteNumber(fields[46]),
      updatedAt: now
    }]
  })
}

async function fetchSinaQuotes(stocks: WatchStock[], caller: string): Promise<StockQuote[]> {
  const stockBySymbol = new Map(stocks.map((stock) => [toTencentSymbol(stock.quoteId), stock]))
  const symbols = [...stockBySymbol.keys()]
  const text = await requestText(
    `https://hq.sinajs.cn/list=${symbols.join(',')}`,
    {
      dataType: 'quotes',
      caller,
      source: 'sina',
      fallbackFrom: 'tencent',
      requestedCount: stocks.length,
      headers: SINA_HEADERS,
      encoding: 'gbk',
      returnedCount: (value) => [...value.matchAll(/var hq_str_([^=]+)="([^"]*)"/g)].length
    }
  )
  const now = new Date().toISOString()

  return [...text.matchAll(/var hq_str_([^=]+)="([^"]*)"/g)].flatMap((match) => {
    const stock = stockBySymbol.get(match[1])
    if (!stock || !match[2]) return []
    const fields = match[2].split(',')
    const latest = quoteNumber(fields[3])
    const previousClose = quoteNumber(fields[2])
    const change = latest !== null && previousClose !== null ? latest - previousClose : null
    const rawVolume = quoteNumber(fields[8])
    return [{
      code: stock.code,
      name: fields[0] || stock.name,
      quoteId: stock.quoteId,
      latest,
      changePercent: change !== null && previousClose
        ? change / previousClose * 100
        : null,
      change,
      open: quoteNumber(fields[1]),
      high: quoteNumber(fields[4]),
      low: quoteNumber(fields[5]),
      previousClose,
      volume: rawVolume !== null && !MARKET_INDEX_QUOTE_IDS.has(stock.quoteId)
        ? rawVolume / 100
        : rawVolume,
      amount: quoteNumber(fields[9]),
      turnoverRate: null,
      updatedAt: now
    }]
  })
}

export async function fetchQuotes(
  stocks: WatchStock[],
  radarStocks: WatchStock[] = stocks,
  caller = 'quotes',
  onRadarSignalsUpdated?: RadarSignalsUpdated
): Promise<QuoteBatchResult> {
  if (stocks.length === 0) return { quotes: [], source: 'none' }

  const radarSignals = currentRadarSignals(radarStocks, onRadarSignalsUpdated)
  const withRadarSignals = (quotes: StockQuote[]) => quotes.map((quote) => ({
    ...quote,
    radarSignals: radarSignals.get(quote.quoteId)
  }))
  const sources: Array<[string, string, () => Promise<StockQuote[]>]> = [
    ['东方财富主节点', 'eastmoney-primary', () => fetchEastmoneyQuotes(stocks, false, caller)],
    ['东方财富镜像节点', 'eastmoney-delay', () => fetchEastmoneyQuotes(stocks, true, caller)],
    ['腾讯行情', 'tencent', () => fetchTencentQuotes(stocks, caller)],
    ['新浪行情', 'sina', () => fetchSinaQuotes(stocks, caller)]
  ]
  const failures: string[] = []

  for (const [name, source, fetchSource] of sources) {
    try {
      const quotes = await fetchSource()
      if (quotes.length === 0) throw new Error('未返回行情数据')
      return { quotes: withRadarSignals(quotes), source }
    } catch (error) {
      failures.push(`${name}：${error instanceof Error ? error.message : '请求失败'}`)
    }
  }

  throw new Error(`主行情数据源均不可用（${failures.join('；')}）`)
}

export async function fetchOrderBook(quoteId: string, caller = 'order-book'): Promise<StockOrderBook> {
  const fetchEastmoney = async (origin: string, source: string, fallbackFrom?: string) => {
    const url = new URL('/api/qt/stock/get', origin)
    url.searchParams.set('secid', quoteId)
    url.searchParams.set('invt', EASTMONEY_FIXED_PARAMS.orderBook.invt)
    url.searchParams.set('fltt', EASTMONEY_FIXED_PARAMS.orderBook.fltt)
    url.searchParams.set('fields', EASTMONEY_FIELDS.orderBook)

    const payload = await requestJson<{ data?: EastmoneyOrderBookData }>(url.toString(), {
      dataType: 'order-book',
      caller,
      source,
      fallbackFrom,
      requestedCount: 1,
      maxAttempts: 1,
      returnedCount: (value) => value.data ? 1 : 0
    })
    if (!payload.data) throw new Error('行情服务未返回五档数据')
    const data = payload.data
    const result: StockOrderBook = {
      quoteId,
      name: data.f58 ?? '',
      latest: rawNumber(data.f43),
      previousClose: rawNumber(data.f60),
      bids: [
        { price: rawNumber(data.f19), volume: rawNumber(data.f20) },
        { price: rawNumber(data.f17), volume: rawNumber(data.f18) },
        { price: rawNumber(data.f15), volume: rawNumber(data.f16) },
        { price: rawNumber(data.f13), volume: rawNumber(data.f14) },
        { price: rawNumber(data.f11), volume: rawNumber(data.f12) }
      ],
      asks: [
        { price: rawNumber(data.f39), volume: rawNumber(data.f40) },
        { price: rawNumber(data.f37), volume: rawNumber(data.f38) },
        { price: rawNumber(data.f35), volume: rawNumber(data.f36) },
        { price: rawNumber(data.f33), volume: rawNumber(data.f34) },
        { price: rawNumber(data.f31), volume: rawNumber(data.f32) }
      ],
      updatedAt: new Date().toISOString()
    }
    if (![...result.bids, ...result.asks].some((level) => level.price !== null)) {
      throw new Error('行情服务未返回买卖五档数据')
    }
    return result
  }

  const fetchTencent = async () => {
    const symbol = toTencentSymbol(quoteId)
    const text = await requestText(`https://qt.gtimg.cn/q=${symbol}`, {
      dataType: 'order-book',
      caller,
      source: 'tencent',
      fallbackFrom: 'eastmoney-delay',
      requestedCount: 1,
      headers: TENCENT_HEADERS,
      encoding: 'gbk',
      returnedCount: (value) => [...value.matchAll(/v_([^=]+)="([^"]*)"/g)].length
    })
    const match = [...text.matchAll(/v_([^=]+)="([^"]*)"/g)]
      .find((item) => item[1] === symbol)
    if (!match?.[2]) throw new Error('腾讯行情未返回五档数据')
    const fields = match[2].split('~')
    if (fields.length <= 28) throw new Error('腾讯行情返回的五档字段不完整')

    const levels = (start: number): OrderBookLevel[] => Array.from({ length: 5 }, (_, index) => ({
      price: quoteNumber(fields[start + index * 2]),
      volume: quoteNumber(fields[start + index * 2 + 1])
    }))
    return {
      quoteId,
      name: fields[1] ?? '',
      latest: quoteNumber(fields[3]),
      previousClose: quoteNumber(fields[4]),
      bids: levels(9),
      asks: levels(19),
      updatedAt: new Date().toISOString()
    }
  }

  const sources: Array<[string, () => Promise<StockOrderBook>]> = [
    ['东方财富主节点', () => fetchEastmoney('https://push2.eastmoney.com', 'eastmoney-primary')],
    ['东方财富Delay节点', () => fetchEastmoney(
      'https://push2delay.eastmoney.com',
      'eastmoney-delay',
      'eastmoney-primary'
    )],
    ['腾讯盘口', fetchTencent]
  ]
  const failures: string[] = []
  for (const [name, fetchSource] of sources) {
    try {
      return await fetchSource()
    } catch (error) {
      failures.push(`${name}：${error instanceof Error ? error.message : '请求失败'}`)
    }
  }
  throw new Error(`盘口数据源均不可用（${failures.join('；')}）`)
}

function compactDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('')
}

function recentRadarDates(): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 4)
  return { startDate: compactDate(start), endDate: compactDate(end) }
}

function radarSignal(item: Pick<EastmoneyRadarItem, 'tm' | 't' | 'i'>, date: string): StockRadarSignal | null {
  const meta = RADAR_LABELS[item.t]
  if (!meta) return null
  const rawTime = String(item.tm).padStart(6, '0')
  return {
    type: String(item.t),
    label: meta.label,
    date,
    time: `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}:${rawTime.slice(4, 6)}`,
    info: item.i?.split(',')[0] ?? '',
    direction: meta.direction
  }
}

function normalizeRadarSignals(signals: StockRadarSignal[]): StockRadarSignal[] {
  const uniqueSignals = new Map<string, StockRadarSignal>()
  for (const signal of signals) {
    const key = `${signal.date}:${signal.type}`
    const current = uniqueSignals.get(key)
    if (!current || signal.time > current.time) uniqueSignals.set(key, signal)
  }
  return [...uniqueSignals.values()].sort((left, right) => (
    `${right.date}${right.time}`.localeCompare(`${left.date}${left.time}`)
  ))
}

function radarSignalMapsEqual(left: RadarSignalMap | undefined, right: RadarSignalMap): boolean {
  if (!left || left.size !== right.size) return false
  for (const [quoteId, rightSignals] of right) {
    const leftSignals = left.get(quoteId)
    if (!leftSignals || leftSignals.length !== rightSignals.length) return false
    if (leftSignals.some((signal, index) => {
      const rightSignal = rightSignals[index]
      return signal.type !== rightSignal.type
        || signal.label !== rightSignal.label
        || signal.date !== rightSignal.date
        || signal.time !== rightSignal.time
        || signal.info !== rightSignal.info
        || signal.direction !== rightSignal.direction
    })) return false
  }
  return true
}

function mergeRadarSignals(...maps: Array<RadarSignalMap | undefined>): RadarSignalMap {
  const merged = new Map<string, StockRadarSignal[]>()
  for (const map of maps) {
    for (const [quoteId, signals] of map ?? []) {
      merged.set(quoteId, normalizeRadarSignals([...(merged.get(quoteId) ?? []), ...signals]))
    }
  }
  return merged
}

function currentRadarSignals(
  stocks: WatchStock[],
  onRadarSignalsUpdated?: RadarSignalsUpdated
): RadarSignalMap {
  if (stocks.length === 0) return new Map()
  const { startDate, endDate } = recentRadarDates()
  const watchlistKey = stocks.map((stock) => stock.quoteId).sort().join(',')
  const todayCacheValid = todayRadarCache?.date === endDate && todayRadarCache.watchlistKey === watchlistKey
  const historyCacheValid = historyRadarCache?.date === endDate && historyRadarCache.watchlistKey === watchlistKey

  if ((!todayCacheValid || Date.now() - (todayRadarCache?.cachedAt ?? 0) >= 30_000) && !todayRadarRefresh) {
    const previousSignals = todayCacheValid ? todayRadarCache?.signals : undefined
    todayRadarRefresh = fetchTodayRadarSignals(stocks, endDate)
      .then((signals) => {
        todayRadarCache = { cachedAt: Date.now(), date: endDate, watchlistKey, signals }
        if ((previousSignals || signals.size > 0) && !radarSignalMapsEqual(previousSignals, signals)) {
          onRadarSignalsUpdated?.()
        }
      })
      .catch(() => undefined)
      .finally(() => { todayRadarRefresh = undefined })
  }

  if ((!historyCacheValid || Date.now() - (historyRadarCache?.cachedAt ?? 0) >= 10 * 60_000) && !historyRadarRefresh) {
    const previousSignals = historyCacheValid ? historyRadarCache?.signals : undefined
    historyRadarRefresh = fetchHistoricalRadarSignals(stocks, startDate, endDate)
      .then((signals) => {
        historyRadarCache = { cachedAt: Date.now(), date: endDate, watchlistKey, signals }
        if ((previousSignals || signals.size > 0) && !radarSignalMapsEqual(previousSignals, signals)) {
          onRadarSignalsUpdated?.()
        }
      })
      .catch(() => undefined)
      .finally(() => { historyRadarRefresh = undefined })
  }

  return mergeRadarSignals(
    historyCacheValid ? historyRadarCache?.signals : undefined,
    todayCacheValid ? todayRadarCache?.signals : undefined
  )
}

async function fetchTodayRadarSignals(stocks: WatchStock[], date: string): Promise<RadarSignalMap> {
  const url = new URL('https://push2ex.eastmoney.com/getAllStockChanges')
  url.searchParams.set('type', RADAR_TYPES.join(','))
  url.searchParams.set('pageindex', EASTMONEY_FIXED_PARAMS.radar.pageIndex)
  url.searchParams.set('pagesize', EASTMONEY_FIXED_PARAMS.radar.pageSize)
  url.searchParams.set('ut', EASTMONEY_RADAR_TOKEN)
  url.searchParams.set('dpt', EASTMONEY_FIXED_PARAMS.radar.dpt)

  const payload = await requestJson<{
    data?: { allstock?: EastmoneyRadarItem[] }
  }>(url.toString(), {
    dataType: 'radar-today',
    caller: 'radar:today',
    source: 'eastmoney-push2ex',
    requestedCount: stocks.length,
    returnedCount: (value) => value.data?.allstock?.length ?? 0
  })
  const watchedQuoteIds = new Set(stocks.map((stock) => stock.quoteId))
  const signals = new Map<string, StockRadarSignal[]>()

  for (const item of payload.data?.allstock ?? []) {
    const quoteId = `${item.m}.${item.c}`
    if (!watchedQuoteIds.has(quoteId)) continue
    const signal = radarSignal(item, date)
    if (signal) signals.set(quoteId, normalizeRadarSignals([...(signals.get(quoteId) ?? []), signal]))
  }

  return signals
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(mapper)))
  }
  return results
}

async function fetchStockRadarHistory(
  stock: WatchStock,
  startDate: string,
  endDate: string
): Promise<StockRadarSignal[]> {
  const market = Number(stock.quoteId.split('.')[0])
  const statisticsUrl = new URL('https://push2ex.eastmoney.com/getStockStatisticsChanges')
  statisticsUrl.searchParams.set('ut', EASTMONEY_RADAR_TOKEN)
  statisticsUrl.searchParams.set('startdate', startDate)
  statisticsUrl.searchParams.set('enddate', endDate)
  statisticsUrl.searchParams.set('dpt', EASTMONEY_FIXED_PARAMS.radar.dpt)
  statisticsUrl.searchParams.set('code', stock.code)
  statisticsUrl.searchParams.set('market', String(market))

  const statistics = await requestJson<{
    data?: { data?: Array<{ d: number; ct: number }> }
  }>(statisticsUrl.toString(), {
    dataType: 'radar-history-statistics',
    caller: 'radar:history',
    source: 'eastmoney-push2ex',
    requestedCount: 1,
    returnedCount: (value) => value.data?.data?.length ?? 0
  })
  const dates = (statistics.data?.data ?? []).map((item) => String(item.d))
  const dailySignals = await Promise.all(dates.map(async (date) => {
    const detailUrl = new URL('https://push2ex.eastmoney.com/getStockChanges')
    detailUrl.searchParams.set('ut', EASTMONEY_RADAR_TOKEN)
    detailUrl.searchParams.set('date', date)
    detailUrl.searchParams.set('dpt', EASTMONEY_FIXED_PARAMS.radar.dpt)
    detailUrl.searchParams.set('code', stock.code)
    detailUrl.searchParams.set('market', String(market))
    const detail = await requestJson<{
      data?: { data?: Array<Pick<EastmoneyRadarItem, 'tm' | 't' | 'i'>> }
    }>(detailUrl.toString(), {
      dataType: 'radar-history-detail',
      caller: 'radar:history',
      source: 'eastmoney-push2ex',
      requestedCount: 1,
      returnedCount: (value) => value.data?.data?.length ?? 0
    })
    return (detail.data?.data ?? []).flatMap((item) => {
      const signal = radarSignal(item, date)
      return signal ? [signal] : []
    })
  }))
  return normalizeRadarSignals(dailySignals.flat())
}

async function fetchHistoricalRadarSignals(
  stocks: WatchStock[],
  startDate: string,
  endDate: string
): Promise<RadarSignalMap> {
  const stockSignals = await mapInBatches(stocks, 6, async (stock) => ({
    quoteId: stock.quoteId,
    signals: await fetchStockRadarHistory(stock, startDate, endDate).catch(() => [])
  }))
  return new Map(stockSignals
    .filter((item) => item.signals.length > 0)
    .map((item): [string, StockRadarSignal[]] => [item.quoteId, item.signals]))
}

function toIntradayKlineResult(quoteId: string, name: string | undefined, lines: string[]): KlineResult {
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

function toHistoricalKlineResult(quoteId: string, name: string | undefined, lines: string[]): KlineResult {
  if (lines.length === 0) throw new Error('行情服务未返回 K 线数据')

  const bars = lines.map((line) => {
    const [time, open, close, high, low, volume, amount, , , , turnoverRate] = line.split(',')
    return {
      time,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      turnoverRate: turnoverRate === undefined ? undefined : Number(turnoverRate)
    }
  })
  const firstDate = bars[0]?.time.slice(0, 10) ?? ''
  const lastDate = bars.at(-1)?.time.slice(0, 10) ?? ''
  return {
    quoteId,
    name: name ?? '',
    tradingDate: firstDate === lastDate ? lastDate : `${firstDate} 至 ${lastDate}`,
    bars
  }
}

type TencentKlineRow = [string, string, string, string, string, string, ...unknown[]]

interface TencentKlineData {
  qt?: Record<string, string[]>
  qfqday?: TencentKlineRow[]
  qfqweek?: TencentKlineRow[]
  qfqmonth?: TencentKlineRow[]
  day?: TencentKlineRow[]
  week?: TencentKlineRow[]
  month?: TencentKlineRow[]
  m5?: TencentKlineRow[]
}

function toTencentSymbol(quoteId: string): string {
  const [market, code] = quoteId.split('.')
  if (market === '1') return `sh${code}`
  if (/^(4|8|92)/.test(code)) return `bj${code}`
  return `sz${code}`
}

function normalizeTencentKlineTime(time: string): string {
  if (!/^\d{12}$/.test(time)) return time
  return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)} ${time.slice(8, 10)}:${time.slice(10, 12)}`
}

function toTencentKlineResult(
  quoteId: string,
  name: string | undefined,
  rows: TencentKlineRow[]
): KlineResult {
  if (rows.length === 0) throw new Error('腾讯行情未返回 K 线数据')

  const amountUnit = MARKET_INDEX_QUOTE_IDS.has(quoteId) ? 1 : 100
  const bars: KlineBar[] = rows.map((row) => {
    const [time, openText, closeText, highText, lowText, volumeText] = row
    const open = Number(openText)
    const close = Number(closeText)
    const high = Number(highText)
    const low = Number(lowText)
    const volume = Number(volumeText)
    return {
      time: normalizeTencentKlineTime(time),
      open,
      close,
      high,
      low,
      volume,
      amount: (open + close + high + low) / 4 * volume * amountUnit,
      turnoverRate: typeof row[7] === 'string' ? Number(row[7]) : undefined
    }
  })
  const firstDate = bars[0]?.time.slice(0, 10) ?? ''
  const lastDate = bars.at(-1)?.time.slice(0, 10) ?? ''
  return {
    quoteId,
    name: name ?? '',
    tradingDate: firstDate === lastDate ? lastDate : `${firstDate} 至 ${lastDate}`,
    bars
  }
}

async function fetchTencentKline(
  quoteId: string,
  period: KlinePeriod,
  limit: number,
  caller: string
): Promise<KlineResult> {
  const symbol = toTencentSymbol(quoteId)
  const url = period === 'fiveDay' || period === 'intraday'
    ? new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline')
    : new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get')

  if (period === 'fiveDay' || period === 'intraday') {
    url.searchParams.set('param', `${symbol},m5,,${period === 'fiveDay' ? 240 : 120}`)
  } else {
    const tencentPeriod = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'
    url.searchParams.set('param', `${symbol},${tencentPeriod},,,${limit},qfq`)
  }

  const payload = await requestJson<{
    code?: number
    msg?: string
    data?: Record<string, TencentKlineData>
  }>(url.toString(), {
    dataType: `kline:${period}`,
    caller,
    source: 'tencent',
    fallbackFrom: 'eastmoney',
    requestedCount: 1,
    headers: TENCENT_HEADERS,
    returnedCount: (value) => {
      const source = value.data?.[symbol]
      if (period === 'fiveDay' || period === 'intraday') return source?.m5?.length ?? 0
      if (period === 'daily') return (source?.qfqday ?? source?.day)?.length ?? 0
      if (period === 'weekly') return (source?.qfqweek ?? source?.week)?.length ?? 0
      return (source?.qfqmonth ?? source?.month)?.length ?? 0
    }
  })
  if (payload.code !== 0) throw new Error(payload.msg || '腾讯行情 K 线请求失败')

  const source = payload.data?.[symbol]
  const quote = source?.qt?.[symbol]
  let rows: TencentKlineRow[] = []
  if (period === 'fiveDay' || period === 'intraday') {
    rows = source?.m5 ?? []
  } else if (period === 'daily') {
    rows = source?.qfqday ?? source?.day ?? []
  } else if (period === 'weekly') {
    rows = source?.qfqweek ?? source?.week ?? []
  } else {
    rows = source?.qfqmonth ?? source?.month ?? []
  }

  const result = toTencentKlineResult(quoteId, quote?.[1], rows)
  if (period !== 'intraday') return result

  const tradingDate = result.bars.at(-1)?.time.slice(0, 10) ?? ''
  return {
    ...result,
    intervalMinutes: 5,
    tradingDate,
    bars: result.bars.filter((bar) => bar.time.startsWith(tradingDate))
  }
}

async function fetchIntradayTrend(quoteId: string, caller: string): Promise<KlineResult> {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/trends2/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('ndays', EASTMONEY_FIXED_PARAMS.intraday.ndays)
  url.searchParams.set('iscr', EASTMONEY_FIXED_PARAMS.intraday.iscr)
  url.searchParams.set('iscca', EASTMONEY_FIXED_PARAMS.intraday.iscca)
  url.searchParams.set('fields1', EASTMONEY_FIELDS.intradayPrimary)
  url.searchParams.set('fields2', EASTMONEY_FIELDS.intradaySecondary)

  const payload = await requestJson<{
    data?: { name?: string; trends?: string[] }
  }>(url.toString(), {
    dataType: 'kline:intraday',
    caller,
    source: 'eastmoney-primary',
    requestedCount: 1,
    returnedCount: (value) => value.data?.trends?.length ?? 0
  })

  return {
    ...toIntradayKlineResult(quoteId, payload.data?.name, payload.data?.trends ?? []),
    intervalMinutes: 1
  }
}

async function fetchHistoricalKline(
  quoteId: string,
  klt: '5' | '101' | '102' | '103',
  limit: number,
  caller: string
): Promise<KlineResult> {
  const createUrl = (origin: string) => {
    const url = new URL('/api/qt/stock/kline/get', origin)
    url.searchParams.set('secid', quoteId)
    url.searchParams.set('klt', klt)
    url.searchParams.set('fqt', EASTMONEY_FIXED_PARAMS.historicalKline.fqt)
    url.searchParams.set('lmt', String(limit))
    url.searchParams.set('end', EASTMONEY_FIXED_PARAMS.historicalKline.end)
    url.searchParams.set('fields1', EASTMONEY_FIELDS.historicalKlinePrimary)
    url.searchParams.set('fields2', EASTMONEY_FIELDS.historicalKlineSecondary)
    return url
  }
  const fetchFrom = async (
    url: URL,
    source: string,
    host?: string
  ) => {
    type HistoricalKlinePayload = {
      data?: { name?: string; klines?: string[] }
    }
    const payload = host
      ? await requestJsonWithHost<HistoricalKlinePayload>(url.toString(), host, {
          dataType: `kline:${klt}`,
          caller,
          source,
          fallbackFrom: 'eastmoney-history-primary',
          requestedCount: 1,
          returnedCount: (value) => value.data?.klines?.length ?? 0
        })
      : await requestJson<HistoricalKlinePayload>(url.toString(), {
          dataType: `kline:${klt}`,
          caller,
          source,
          requestedCount: 1,
          maxAttempts: 1,
          returnedCount: (value) => value.data?.klines?.length ?? 0
        })

    return toHistoricalKlineResult(quoteId, payload.data?.name, payload.data?.klines ?? [])
  }
  const primaryUrl = createUrl('https://push2his.eastmoney.com')

  try {
    return await fetchFrom(primaryUrl, 'eastmoney-history-primary')
  } catch (primaryError) {
    const delayUrl = createUrl('https://push2delay.eastmoney.com')
    try {
      const result = await fetchFrom(delayUrl, 'eastmoney-delay', primaryUrl.host)
      return {
        ...result,
        fallbackReason: primaryError instanceof Error
          ? `东方财富历史 K 线主节点读取失败，当前使用镜像节点：${primaryError.message}`
          : '东方财富历史 K 线主节点读取失败，当前使用镜像节点'
      }
    } catch (delayError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : '请求失败'
      const delayMessage = delayError instanceof Error ? delayError.message : '请求失败'
      throw new Error(`东方财富历史 K 线主节点和镜像节点均不可用（主节点：${primaryMessage}；镜像节点：${delayMessage}）`)
    }
  }
}

async function fetchEastmoneyKline(
  quoteId: string,
  period: KlinePeriod = 'intraday',
  limit?: number,
  caller = 'kline'
): Promise<KlineResult> {
  const requestedLimit = limit === undefined ? 0 : Math.max(1, Math.round(limit))
  switch (period) {
    case 'fiveDay': return fetchHistoricalKline(quoteId, '5', 240, caller)
    case 'daily': return fetchHistoricalKline(quoteId, '101', requestedLimit || 120, caller)
    case 'weekly': return fetchHistoricalKline(quoteId, '102', requestedLimit || 104, caller)
    case 'monthly': return fetchHistoricalKline(quoteId, '103', requestedLimit || 60, caller)
    case 'intraday':
      try {
        return await fetchIntradayTrend(quoteId, caller)
      } catch (reason) {
        const fallback = await fetchHistoricalKline(quoteId, '5', 120, caller)
        const tradingDate = fallback.bars.at(-1)?.time.slice(0, 10) ?? ''
        return {
          ...fallback,
          intervalMinutes: 5,
          fallbackReason: reason instanceof Error ? reason.message : '1分钟分时数据加载失败',
          tradingDate,
          bars: fallback.bars.filter((bar) => bar.time.startsWith(tradingDate))
        }
      }
  }
}

export async function fetchKline(
  quoteId: string,
  period: KlinePeriod = 'intraday',
  limit?: number,
  caller = 'kline'
): Promise<KlineResult> {
  const requestedLimit = limit === undefined
    ? period === 'weekly'
      ? 104
      : period === 'monthly'
        ? 60
        : 120
    : Math.max(1, Math.round(limit))
  let primaryError: unknown

  try {
    const result = await fetchEastmoneyKline(quoteId, period, limit, caller)
    return result
  } catch (error) {
    primaryError = error
  }

  try {
    const result = await fetchTencentKline(quoteId, period, requestedLimit, caller)
    return {
      ...result,
      fallbackReason: primaryError instanceof Error
        ? `东方财富行情读取失败：${primaryError.message}`
        : '东方财富行情读取失败，当前使用腾讯备用行情'
    }
  } catch (backupError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : '请求失败'
    const backupMessage = backupError instanceof Error ? backupError.message : '请求失败'
    throw new Error(`K 线主备数据源均不可用（东方财富：${primaryMessage}；腾讯行情：${backupMessage}）`)
  }
}

export async function fetchSectorBinding(
  stockQuoteId: string,
  caller = 'sector-binding'
): Promise<SectorBinding> {
  const html = await requestText(`https://quote.eastmoney.com/unify/r/${stockQuoteId}`, {
    dataType: 'sector-binding',
    caller,
    source: 'eastmoney-quote-page',
    requestedCount: 1,
    returnedCount: (value) => value.length > 0 ? 1 : 0
  })
  const quotedata = html.match(/var\s+quotedata\s*=\s*(\{[^;]+\});/)
  if (!quotedata) throw new Error('暂未获取到该股票的所属板块')

  const data = JSON.parse(quotedata[1]) as { bk_id?: string; bk_name?: string }
  if (!data.bk_id || !data.bk_name) throw new Error('该股票暂无所属行业板块数据')

  const boardCode = data.bk_id.toUpperCase()
  const binding = {
    boardCode,
    boardName: data.bk_name,
    boardQuoteId: `90.${boardCode}`,
    cachedAt: Date.now()
  }
  return binding
}

export async function fetchFundsFlow(quoteId: string, caller = 'funds-flow'): Promise<FundsFlowResult> {
  const fetchFrom = async (origin: string, source: string, fallbackFrom?: string) => {
    const url = new URL('/api/qt/stock/fflow/kline/get', origin)
    url.searchParams.set('secid', quoteId)
    url.searchParams.set('lmt', EASTMONEY_FIXED_PARAMS.fundsFlow.lmt)
    url.searchParams.set('klt', EASTMONEY_FIXED_PARAMS.fundsFlow.klt)
    url.searchParams.set('fields1', EASTMONEY_FIELDS.fundsFlowPrimary)
    url.searchParams.set('fields2', EASTMONEY_FIELDS.fundsFlowSecondary)

    const payload = await requestJson<{
      data?: { name?: string; klines?: string[] }
    }>(url.toString(), {
      dataType: 'funds-flow',
      caller,
      source,
      fallbackFrom,
      requestedCount: 1,
      maxAttempts: 1,
      returnedCount: (value) => value.data?.klines?.length ?? 0
    })
    const lines = payload.data?.klines ?? []
    if (lines.length === 0) throw new Error('行情服务未返回资金流向数据')

    const tradingDate = lines.at(-1)?.slice(0, 10) ?? ''
    const points = lines
      .filter((line) => line.startsWith(tradingDate))
      .map((line) => {
        const [time, main, small, medium, large] = line.split(',')
        const mainValue = Number(main)
        const largeValue = Number(large)
        return {
          time,
          main: mainValue,
          superLarge: mainValue - largeValue,
          large: largeValue,
          medium: Number(medium),
          small: Number(small)
        }
      })

    return { quoteId, name: payload.data?.name ?? '', tradingDate, points }
  }

  try {
    return await fetchFrom('https://push2.eastmoney.com', 'eastmoney-primary')
  } catch (primaryError) {
    try {
      return await fetchFrom(
        'https://push2delay.eastmoney.com',
        'eastmoney-delay',
        'eastmoney-primary'
      )
    } catch (delayError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : '请求失败'
      const delayMessage = delayError instanceof Error ? delayError.message : '请求失败'
      throw new Error(`资金流向主备节点均不可用（主节点：${primaryMessage}；Delay节点：${delayMessage}）`)
    }
  }
}
