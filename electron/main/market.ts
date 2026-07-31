import { net } from 'electron'
import type {
  FundsFlowResult,
  KlineBar,
  KlinePeriod,
  KlineResult,
  OrderBookLevel,
  SearchResult,
  SectorIndexResult,
  StockOrderBook,
  StockQuote,
  StockRadarSignal,
  StockSectorQuote,
  WatchStock
} from '../../src/shared/types'

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

interface SectorBinding {
  boardCode: string
  boardName: string
  boardQuoteId: string
  cachedAt: number
}

const sectorBindingCache = new Map<string, SectorBinding>()

async function requestJson<T>(
  url: string,
  maxAttempts = 2,
  headers: Record<string, string> = EASTMONEY_HEADERS
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await net.fetch(url, {
        headers,
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

async function requestText(url: string): Promise<string> {
  const response = await net.fetch(url, {
    headers: EASTMONEY_HEADERS,
    signal: AbortSignal.timeout(12_000)
  })

  if (!response.ok) throw new Error(`行情服务返回 ${response.status}`)
  return response.text()
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

export async function fetchQuotes(
  stocks: WatchStock[],
  radarStocks: WatchStock[] = stocks
): Promise<StockQuote[]> {
  if (stocks.length === 0) return []

  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get')
  url.searchParams.set('secids', stocks.map((stock) => stock.quoteId).join(','))
  url.searchParams.set('fields', 'f2,f3,f4,f5,f6,f8,f12,f14,f15,f16,f17,f18')

  const radarSignals = currentRadarSignals(radarStocks)
  const payload = await requestJson<{ data?: { diff?: EastmoneyQuoteItem[] } }>(url.toString())
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
    turnoverRate: scaled(item.f8),
    radarSignals: radarSignals.get(quoteIdByCode.get(item.f12 ?? '') ?? ''),
    updatedAt: now
  }))
}

export async function fetchOrderBook(quoteId: string): Promise<StockOrderBook> {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('invt', '2')
  url.searchParams.set('fltt', '2')
  url.searchParams.set(
    'fields',
    'f43,f58,f60,f531,f11,f12,f13,f14,f15,f16,f17,f18,f19,f20,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40'
  )

  const payload = await requestJson<{ data?: EastmoneyOrderBookData }>(url.toString(), 1)
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
  }>(url.toString())
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
  }>(statisticsUrl.toString())
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
    }>(detailUrl.toString())
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
  limit: number
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
  }>(url.toString(), 2, TENCENT_HEADERS)
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

async function fetchIntradayTrend(quoteId: string): Promise<KlineResult> {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/trends2/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('ndays', '1')
  url.searchParams.set('iscr', '1')
  url.searchParams.set('iscca', '0')
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58')

  const payload = await requestJson<{
    data?: { name?: string; trends?: string[] }
  }>(url.toString())

  return {
    ...toIntradayKlineResult(quoteId, payload.data?.name, payload.data?.trends ?? []),
    intervalMinutes: 1
  }
}

async function fetchHistoricalKline(
  quoteId: string,
  klt: '5' | '101' | '102' | '103',
  limit: number
): Promise<KlineResult> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('klt', klt)
  url.searchParams.set('fqt', '1')
  url.searchParams.set('lmt', String(limit))
  url.searchParams.set('end', '20500101')
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')

  const payload = await requestJson<{
    data?: { name?: string; klines?: string[] }
  }>(url.toString())

  return toHistoricalKlineResult(quoteId, payload.data?.name, payload.data?.klines ?? [])
}

async function fetchEastmoneyKline(
  quoteId: string,
  period: KlinePeriod = 'intraday',
  limit?: number
): Promise<KlineResult> {
  const requestedLimit = limit === undefined ? 0 : Math.max(1, Math.round(limit))
  switch (period) {
    case 'fiveDay': return fetchHistoricalKline(quoteId, '5', 240)
    case 'daily': return fetchHistoricalKline(quoteId, '101', requestedLimit || 120)
    case 'weekly': return fetchHistoricalKline(quoteId, '102', requestedLimit || 104)
    case 'monthly': return fetchHistoricalKline(quoteId, '103', requestedLimit || 60)
    case 'intraday':
      try {
        return await fetchIntradayTrend(quoteId)
      } catch (reason) {
        const fallback = await fetchHistoricalKline(quoteId, '5', 120)
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
  limit?: number
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
    const result = await fetchEastmoneyKline(quoteId, period, limit)
    return result
  } catch (error) {
    primaryError = error
  }

  try {
    const result = await fetchTencentKline(quoteId, period, requestedLimit)
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

async function fetchSectorBinding(stockQuoteId: string): Promise<SectorBinding> {
  const cached = sectorBindingCache.get(stockQuoteId)
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60_000) return cached

  const html = await requestText(`https://quote.eastmoney.com/unify/r/${stockQuoteId}`)
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
  sectorBindingCache.set(stockQuoteId, binding)
  return binding
}

export async function fetchSectorQuotes(
  stocks: WatchStock[]
): Promise<Map<string, StockSectorQuote>> {
  const bindings = (await Promise.all(stocks.map(async (stock) => {
    try {
      return { stockQuoteId: stock.quoteId, binding: await fetchSectorBinding(stock.quoteId) }
    } catch {
      return null
    }
  }))).filter((entry): entry is { stockQuoteId: string; binding: SectorBinding } => entry !== null)

  const uniqueBoards = new Map(bindings.map(({ binding }) => [
    binding.boardQuoteId,
    {
      code: binding.boardCode,
      name: binding.boardName,
      quoteId: binding.boardQuoteId,
      marketLabel: '行业板块',
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: false
    } satisfies WatchStock
  ]))
  const boardQuotes = await fetchQuotes([...uniqueBoards.values()], [])
  const boardQuoteMap = new Map(boardQuotes.map((quote) => [quote.quoteId, quote]))

  return new Map(bindings.flatMap(({ stockQuoteId, binding }) => {
    const quote = boardQuoteMap.get(binding.boardQuoteId)
    return quote
      ? [[stockQuoteId, {
          code: binding.boardCode,
          name: binding.boardName,
          quoteId: binding.boardQuoteId,
          changePercent: quote.changePercent
        } satisfies StockSectorQuote] as const]
      : []
  }))
}

export async function fetchSectorIndex(stockQuoteId: string): Promise<SectorIndexResult> {
  const binding = await fetchSectorBinding(stockQuoteId)
  const boardStock: WatchStock = {
    code: binding.boardCode,
    name: binding.boardName,
    quoteId: binding.boardQuoteId,
    marketLabel: '行业板块',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: false
  }
  const [quotes, trend] = await Promise.all([
    fetchQuotes([boardStock], []),
    fetchKline(binding.boardQuoteId, 'intraday')
  ])
  const quote = quotes[0]
  if (!quote) throw new Error('行情服务未返回板块指数数据')

  return {
    stockQuoteId,
    boardCode: binding.boardCode,
    boardName: binding.boardName,
    boardQuoteId: binding.boardQuoteId,
    quote,
    trend
  }
}

export async function fetchFundsFlow(quoteId: string): Promise<FundsFlowResult> {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get')
  url.searchParams.set('secid', quoteId)
  url.searchParams.set('lmt', '0')
  url.searchParams.set('klt', '1')
  url.searchParams.set('fields1', 'f1,f2,f3,f7')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55')

  const payload = await requestJson<{
    data?: { name?: string; klines?: string[] }
  }>(url.toString())
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
