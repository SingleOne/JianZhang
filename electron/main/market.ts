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

const SEARCH_TOKEN = 'D43BF722C8E33A67B1BDCC6FDED9C901'
const EASTMONEY_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}
const TENCENT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://gu.qq.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}
const SINA_HEADERS = {
  Accept: '*/*',
  Referer: 'https://finance.sina.com.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}
const MARKET_INDEX_QUOTE_IDS = new Set([
  '1.000001', '0.399001', '0.399006', '1.000016', '1.000300',
  '1.000688', '1.000905', '1.000852', '0.899050'
])
const RADAR_TOKEN = '7eea3edcaed734bea9cbfc24409ed989'
const RADAR_TYPES = [
  8201, 8202, 8193, 4, 32, 64, 8207, 8209, 8211, 8213, 8215,
  8204, 8203, 8194, 8, 16, 128, 8208, 8210, 8212, 8214, 8216
]
const RADAR_LABELS: Record<number, { label: string; direction: 'up' | 'down' }> = {
  4: { label: '封涨停板', direction: 'up' },
  8: { label: '封跌停板', direction: 'down' },
  16: { label: '打开涨停板', direction: 'down' },
  32: { label: '打开跌停板', direction: 'up' },
  64: { label: '有大买盘', direction: 'up' },
  128: { label: '有大卖盘', direction: 'down' },
  8193: { label: '大笔买入', direction: 'up' },
  8194: { label: '大笔卖出', direction: 'down' },
  8201: { label: '火箭发射', direction: 'up' },
  8202: { label: '快速反弹', direction: 'up' },
  8203: { label: '高台跳水', direction: 'down' },
  8204: { label: '加速下跌', direction: 'down' },
  8207: { label: '竞价上涨', direction: 'up' },
  8208: { label: '竞价下跌', direction: 'down' },
  8209: { label: '高开5日线', direction: 'up' },
  8210: { label: '低开5日线', direction: 'down' },
  8211: { label: '向上缺口', direction: 'up' },
  8212: { label: '向下缺口', direction: 'down' },
  8213: { label: '60日新高', direction: 'up' },
  8214: { label: '60日新低', direction: 'down' },
  8215: { label: '60日大幅上涨', direction: 'up' },
  8216: { label: '60日大幅下跌', direction: 'down' }
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
  f8?: number | '-'
  f12?: string
  f13?: number | '-'
  f14?: string
  f15?: number | '-'
  f16?: number | '-'
  f17?: number | '-'
  f18?: number | '-'
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
  url.searchParams.set('fields', 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18')
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

  return (payload.data?.diff ?? []).map((item) => ({
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
    updatedAt: now
  }))
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
  caller = 'quotes'
): Promise<QuoteBatchResult> {
  if (stocks.length === 0) return { quotes: [], source: 'none' }

  const radarSignals = currentRadarSignals(radarStocks)
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
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('invt', '2')
  url.searchParams.set('fltt', '2')
  url.searchParams.set(
    'fields',
    'f43,f58,f60,f531,f11,f12,f13,f14,f15,f16,f17,f18,f19,f20,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40'
  )

  const payload = await requestJson<{ data?: EastmoneyOrderBookData }>(url.toString(), {
    dataType: 'order-book',
    caller,
    source: 'eastmoney-primary',
    requestedCount: 1,
    maxAttempts: 1,
    returnedCount: (value) => value.data ? 1 : 0
  })
  const data = payload.data
  if (!data) throw new Error('行情服务未返回五档数据')

  const bids: OrderBookLevel[] = [
    { price: rawNumber(data.f19), volume: rawNumber(data.f20) },
    { price: rawNumber(data.f17), volume: rawNumber(data.f18) },
    { price: rawNumber(data.f15), volume: rawNumber(data.f16) },
    { price: rawNumber(data.f13), volume: rawNumber(data.f14) },
    { price: rawNumber(data.f11), volume: rawNumber(data.f12) }
  ]
  const asks: OrderBookLevel[] = [
    { price: rawNumber(data.f39), volume: rawNumber(data.f40) },
    { price: rawNumber(data.f37), volume: rawNumber(data.f38) },
    { price: rawNumber(data.f35), volume: rawNumber(data.f36) },
    { price: rawNumber(data.f33), volume: rawNumber(data.f34) },
    { price: rawNumber(data.f31), volume: rawNumber(data.f32) }
  ]

  return {
    quoteId,
    name: data.f58 ?? '',
    latest: rawNumber(data.f43),
    previousClose: rawNumber(data.f60),
    bids,
    asks,
    updatedAt: new Date().toISOString()
  }
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

function mergeRadarSignals(...maps: Array<RadarSignalMap | undefined>): RadarSignalMap {
  const merged = new Map<string, StockRadarSignal[]>()
  for (const map of maps) {
    for (const [quoteId, signals] of map ?? []) {
      merged.set(quoteId, normalizeRadarSignals([...(merged.get(quoteId) ?? []), ...signals]))
    }
  }
  return merged
}

function currentRadarSignals(stocks: WatchStock[]): RadarSignalMap {
  if (stocks.length === 0) return new Map()
  const { startDate, endDate } = recentRadarDates()
  const watchlistKey = stocks.map((stock) => stock.quoteId).sort().join(',')
  const todayCacheValid = todayRadarCache?.date === endDate && todayRadarCache.watchlistKey === watchlistKey
  const historyCacheValid = historyRadarCache?.date === endDate && historyRadarCache.watchlistKey === watchlistKey

  if ((!todayCacheValid || Date.now() - (todayRadarCache?.cachedAt ?? 0) >= 30_000) && !todayRadarRefresh) {
    todayRadarRefresh = fetchTodayRadarSignals(stocks, endDate)
      .then((signals) => {
        todayRadarCache = { cachedAt: Date.now(), date: endDate, watchlistKey, signals }
      })
      .catch(() => undefined)
      .finally(() => { todayRadarRefresh = undefined })
  }

  if ((!historyCacheValid || Date.now() - (historyRadarCache?.cachedAt ?? 0) >= 10 * 60_000) && !historyRadarRefresh) {
    historyRadarRefresh = fetchHistoricalRadarSignals(stocks, startDate, endDate)
      .then((signals) => {
        historyRadarCache = { cachedAt: Date.now(), date: endDate, watchlistKey, signals }
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
  url.searchParams.set('pageindex', '0')
  url.searchParams.set('pagesize', '3000')
  url.searchParams.set('ut', RADAR_TOKEN)
  url.searchParams.set('dpt', 'wzchanges')

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
  statisticsUrl.searchParams.set('ut', RADAR_TOKEN)
  statisticsUrl.searchParams.set('startdate', startDate)
  statisticsUrl.searchParams.set('enddate', endDate)
  statisticsUrl.searchParams.set('dpt', 'wzchanges')
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
    detailUrl.searchParams.set('ut', RADAR_TOKEN)
    detailUrl.searchParams.set('date', date)
    detailUrl.searchParams.set('dpt', 'wzchanges')
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
  url.searchParams.set('ndays', '1')
  url.searchParams.set('iscr', '1')
  url.searchParams.set('iscca', '0')
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')

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
    url.searchParams.set('fqt', '1')
    url.searchParams.set('lmt', String(limit))
    url.searchParams.set('end', '20500101')
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
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
    url.searchParams.set('lmt', '0')
    url.searchParams.set('klt', '1')
    url.searchParams.set('fields1', 'f1,f2,f3,f7')
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55')

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
