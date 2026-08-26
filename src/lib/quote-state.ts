import { isMarketOpen } from '../shared/market-hours'
import type { MarketCalendarDates } from '../shared/market-calendar'
import { marketFromQuoteId } from '../shared/stock-market'
import type {
  FiveLevelLargeOrderAlert,
  StockQuote,
  StockQuoteDataState,
  StockQuoteSource,
  StockRadarSignal
} from '../shared/types'

const LIVE_QUOTE_MAX_AGE_MILLISECONDS = 2 * 60_000
const EXPIRED_QUOTE_AGE_MILLISECONDS = 5 * 60_000
const FUTURE_QUOTE_TOLERANCE_MILLISECONDS = 5 * 60_000

export const STOCK_QUOTE_SOURCE_LABELS: Record<StockQuoteSource, string> = {
  'eastmoney-primary': '东方财富',
  'eastmoney-mirror': '东方财富镜像',
  tencent: '腾讯行情',
  sina: '新浪行情',
  demo: '演示行情'
}

export const STOCK_QUOTE_DATA_STATE_LABELS: Record<StockQuoteDataState, string> = {
  live: '实时',
  closed: '休市',
  stale: '已过期',
  unknown: '时间未知'
}

export function stockQuoteDataState(
  quote: StockQuote | undefined,
  now = new Date(),
  calendar?: MarketCalendarDates
): StockQuoteDataState {
  if (!quote?.dataAt) return 'unknown'
  const dataTime = new Date(quote.dataAt).getTime()
  if (!Number.isFinite(dataTime)) return 'unknown'
  const market = marketFromQuoteId(quote.quoteId)
  if (!isMarketOpen(market, now, calendar)) return 'closed'
  const age = now.getTime() - dataTime
  return age >= -FUTURE_QUOTE_TOLERANCE_MILLISECONDS && age <= LIVE_QUOTE_MAX_AGE_MILLISECONDS
    ? 'live'
    : 'stale'
}

export function isStockQuoteExpired(
  quote: StockQuote | undefined,
  now = new Date(),
  calendar?: MarketCalendarDates
): boolean {
  if (!quote?.dataAt) return false
  const dataTime = new Date(quote.dataAt).getTime()
  if (!Number.isFinite(dataTime)) return false
  const market = marketFromQuoteId(quote.quoteId)
  if (!isMarketOpen(market, now, calendar)) return false
  return now.getTime() - dataTime > EXPIRED_QUOTE_AGE_MILLISECONDS
}

function radarSignalEqual(left: StockRadarSignal, right: StockRadarSignal): boolean {
  return (
    left.type === right.type &&
    left.label === right.label &&
    left.date === right.date &&
    left.time === right.time &&
    left.info === right.info &&
    left.direction === right.direction
  )
}

function fiveLevelAlertEqual(
  left: FiveLevelLargeOrderAlert,
  right: FiveLevelLargeOrderAlert
): boolean {
  return (
    left.side === right.side &&
    left.level === right.level &&
    left.price === right.price &&
    left.volume === right.volume &&
    left.otherLevelsVolume === right.otherLevelsVolume
  )
}

function arrayEqual<T>(
  left: T[] | undefined,
  right: T[] | undefined,
  itemEqual: (leftItem: T, rightItem: T) => boolean
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((item, index) => itemEqual(item, right[index]))
}

export function stockQuoteEqual(left: StockQuote, right: StockQuote): boolean {
  return (
    left.quoteId === right.quoteId &&
    left.code === right.code &&
    left.name === right.name &&
    left.latest === right.latest &&
    left.change === right.change &&
    left.changePercent === right.changePercent &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.previousClose === right.previousClose &&
    left.volume === right.volume &&
    left.amount === right.amount &&
    left.turnoverRate === right.turnoverRate &&
    left.market === right.market &&
    left.currency === right.currency &&
    left.volumeUnit === right.volumeUnit &&
    left.source === right.source &&
    left.updatedAt === right.updatedAt &&
    left.dataAt === right.dataAt &&
    left.sector?.quoteId === right.sector?.quoteId &&
    left.sector?.code === right.sector?.code &&
    left.sector?.name === right.sector?.name &&
    left.sector?.changePercent === right.sector?.changePercent &&
    arrayEqual(left.radarSignals, right.radarSignals, radarSignalEqual) &&
    arrayEqual(left.fiveLevelLargeOrders, right.fiveLevelLargeOrders, fiveLevelAlertEqual)
  )
}

export function reconcileStockQuotes(current: StockQuote[], incoming: StockQuote[]): StockQuote[] {
  const currentById = new Map(current.map((quote) => [quote.quoteId, quote]))
  const reconciled = incoming.map((quote) => {
    const previous = currentById.get(quote.quoteId)
    return previous && stockQuoteEqual(previous, quote) ? previous : quote
  })
  const unchanged =
    current.length === reconciled.length &&
    reconciled.every((quote, index) => quote === current[index])
  return unchanged ? current : reconciled
}
