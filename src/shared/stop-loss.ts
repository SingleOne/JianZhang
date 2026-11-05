import type { AppState, StockQuote, StockQuoteDataState, WatchStock } from './types'
import type { MarketCalendarDates } from './market-calendar'
import { marketDateKey } from './market-hours'
import { marketFromQuoteId } from './stock-market'
import { stockQuoteDataState } from '../lib/quote-state'

/** Presence means enabled. The reference is a high close, observed high or locked cost. */
export interface StopLossRule {
  mode: 'trailingClose' | 'trailingHigh' | 'fixedCost'
  percent: number
  referencePrice: number
  resetId?: string
  /** Only trailingHigh uses the activation boundary to exclude earlier prices. */
  startedAt?: string
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
    (value.mode !== 'trailingClose' &&
      value.mode !== 'trailingHigh' &&
      value.mode !== 'fixedCost') ||
    !Number.isFinite(value.percent) ||
    value.percent <= 0 ||
    value.percent >= 100 ||
    !Number.isFinite(value.referencePrice) ||
    value.referencePrice <= 0 ||
    (value.mode === 'trailingHigh' &&
      (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))))
  )
    return undefined
  return {
    mode: value.mode,
    percent: value.percent,
    referencePrice: value.referencePrice,
    ...(typeof value.resetId === 'string' ? { resetId: value.resetId } : {}),
    ...(value.mode === 'trailingHigh' ? { startedAt: value.startedAt } : {}),
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
  if (!usableQuote(quote, now, calendar) || quote?.quoteId !== stock.quoteId) return undefined
  const referencePrice = mode === 'trailingHigh' ? quote.latest : quote.previousClose
  if (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0)
    return undefined
  return normalizeStopLoss({
    mode,
    percent,
    referencePrice,
    resetId: crypto.randomUUID(),
    ...(mode === 'trailingHigh'
      ? { startedAt: now.toISOString() }
      : { quoteDate: marketDateKey(new Date(quote.dataAt!), marketFromQuoteId(stock.quoteId)) })
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
    if (rule.mode === 'fixedCost') return stock
    const quote = quoteMap.get(stock.quoteId)
    if (
      !usableQuote(
        quote,
        now,
        state.settings.tradingCalendar.markets[marketFromQuoteId(stock.quoteId)]
      ) ||
      !quote
    )
      return stock
    if (rule.mode === 'trailingHigh') {
      if (
        !rule.startedAt ||
        Date.parse(quote.dataAt!) < Date.parse(rule.startedAt) ||
        quote.latest === null ||
        !Number.isFinite(quote.latest) ||
        quote.latest <= rule.referencePrice
      )
        return stock
      changed = true
      return { ...stock, stopLoss: { ...rule, referencePrice: quote.latest } }
    }
    if (!quote.previousClose || !Number.isFinite(quote.previousClose) || quote.previousClose <= 0)
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
