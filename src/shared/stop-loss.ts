import type { AppState, StockQuote, StockQuoteDataState, WatchStock } from './types'
import type { MarketCalendarDates } from './market-calendar'
import { marketDateKey } from './market-hours'
import { marketFromQuoteId } from './stock-market'
import { stockQuoteDataState } from '../lib/quote-state'

/** Presence means enabled. The single reference is a high close or a locked cost. */
export interface StopLossRule {
  mode: 'trailingClose' | 'fixedCost'
  percent: number
  referencePrice: number
  resetId?: string
  /** Date of the quote whose previousClose was last processed, not a coverage cursor. */
  quoteDate?: string
}

export interface StopLossSnapshot {
  quoteId: string
  mode: StopLossRule['mode']
  referencePrice: number
  percent: number
  stopPrice: number
  latest: number | null
  /** Percentage of the latest price remaining before the stop is reached. */
  distancePercent: number | null
  /** null means a current comparison is unavailable; subscribers choose their response. */
  reached: boolean | null
  dataState: StockQuoteDataState
  dataAt?: string
}

export function normalizeStopLoss(value: StopLossRule | undefined): StopLossRule | undefined {
  if (
    !value ||
    (value.mode !== 'trailingClose' && value.mode !== 'fixedCost') ||
    !Number.isFinite(value.percent) ||
    value.percent <= 0 ||
    value.percent >= 100 ||
    !Number.isFinite(value.referencePrice) ||
    value.referencePrice <= 0
  )
    return undefined
  return {
    mode: value.mode,
    percent: value.percent,
    referencePrice: value.referencePrice,
    ...(typeof value.resetId === 'string' ? { resetId: value.resetId } : {}),
    ...(value.mode === 'trailingClose' &&
    typeof value.quoteDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.quoteDate)
      ? { quoteDate: value.quoteDate }
      : {})
  }
}

export function withStopLoss(stock: WatchStock, rule: StopLossRule | undefined): WatchStock {
  const { stopLoss: _previous, ...rest } = stock
  const normalized = (stock.position?.quantity ?? 0) > 0 ? normalizeStopLoss(rule) : undefined
  return normalized ? { ...rest, stopLoss: normalized } : rest
}

function usableQuote(
  quote: StockQuote | undefined,
  now: Date,
  calendar?: MarketCalendarDates
): boolean {
  if (!quote?.dataAt) return false
  const timestamp = Date.parse(quote.dataAt)
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() + 5 * 60_000 &&
    !['stale', 'unknown'].includes(stockQuoteDataState(quote, now, calendar))
  )
}

export function createStopLossRule(
  stock: WatchStock,
  quote: StockQuote | undefined,
  mode: StopLossRule['mode'],
  percent: number,
  now = new Date(),
  calendar?: MarketCalendarDates
): StopLossRule | undefined {
  if (!((stock.position?.quantity ?? 0) > 0)) return undefined
  if (mode === 'fixedCost')
    return normalizeStopLoss({
      mode,
      percent,
      referencePrice: stock.position!.cost,
      resetId: crypto.randomUUID()
    })
  if (
    !usableQuote(quote, now, calendar) ||
    quote?.quoteId !== stock.quoteId ||
    !quote.previousClose
  )
    return undefined
  return normalizeStopLoss({
    mode,
    percent,
    referencePrice: quote.previousClose,
    resetId: crypto.randomUUID(),
    quoteDate: marketDateKey(new Date(quote.dataAt!), marketFromQuoteId(stock.quoteId))
  })
}

export function updateStopLossReferences(
  state: AppState,
  quotes: readonly StockQuote[],
  now = new Date()
): WatchStock[] {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  let changed = false
  const watchlist = state.watchlist.map((stock) => {
    const rule = stock.stopLoss
    if (!rule) return stock
    if (!((stock.position?.quantity ?? 0) > 0)) {
      changed = true
      return withStopLoss(stock, undefined)
    }
    if (rule.mode !== 'trailingClose') return stock
    const quote = quoteMap.get(stock.quoteId)
    if (
      !usableQuote(
        quote,
        now,
        state.settings.tradingCalendar.markets[marketFromQuoteId(stock.quoteId)]
      ) ||
      !quote?.previousClose ||
      !Number.isFinite(quote.previousClose) ||
      quote.previousClose <= 0
    )
      return stock
    const quoteDate = marketDateKey(new Date(quote.dataAt!), marketFromQuoteId(stock.quoteId))
    if (rule.quoteDate && quoteDate < rule.quoteDate) return stock
    const referencePrice = Math.max(rule.referencePrice, quote.previousClose)
    if (referencePrice === rule.referencePrice && quoteDate === rule.quoteDate) return stock
    changed = true
    return { ...stock, stopLoss: { ...rule, referencePrice, quoteDate } }
  })
  return changed ? watchlist : state.watchlist
}

export function evaluateStopLoss(
  stock: WatchStock,
  quote?: StockQuote,
  now = new Date(),
  calendar?: MarketCalendarDates
): StopLossSnapshot | null {
  const rule = (stock.position?.quantity ?? 0) > 0 ? normalizeStopLoss(stock.stopLoss) : undefined
  if (!rule) return null
  const stopPrice = Number((rule.referencePrice * (1 - rule.percent / 100)).toFixed(8))
  const valid =
    quote?.quoteId === stock.quoteId &&
    usableQuote(quote, now, calendar) &&
    quote.latest !== null &&
    Number.isFinite(quote.latest) &&
    quote.latest > 0
  const latest = valid ? quote!.latest! : null
  return {
    quoteId: stock.quoteId,
    mode: rule.mode,
    referencePrice: rule.referencePrice,
    percent: rule.percent,
    stopPrice,
    latest,
    distancePercent: latest === null ? null : ((latest - stopPrice) / latest) * 100,
    reached: latest === null ? null : latest <= stopPrice,
    dataState: stockQuoteDataState(quote, now, calendar),
    dataAt: quote?.dataAt
  }
}

export function evaluateStopLosses(
  state: AppState,
  quotes: readonly StockQuote[],
  now = new Date()
): StopLossSnapshot[] {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  return state.watchlist.flatMap((stock) => {
    const snapshot = evaluateStopLoss(
      stock,
      quoteMap.get(stock.quoteId),
      now,
      state.settings.tradingCalendar.markets[marketFromQuoteId(stock.quoteId)]
    )
    return snapshot ? [snapshot] : []
  })
}
