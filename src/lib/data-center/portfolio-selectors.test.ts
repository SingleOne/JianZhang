import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState,
  type StockQuote,
  type WatchStock
} from '../../shared/types'
import { calculatePortfolioSummary } from '../portfolio'
import { calculateCurrentPositionProfitOverrides } from '../portfolio-performance'
import { createPortfolioSelector } from './portfolio-selectors'
import type { AppDataSnapshot } from './center'

function fixture(): AppDataSnapshot {
  const stock = (quoteId: string): WatchStock => ({
    quoteId,
    code: quoteId.slice(2),
    name: quoteId,
    marketLabel: '沪A',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: false,
    position: { quantity: 100, cost: 10, openedOn: '2026-01-01', openedToday: false }
  })
  const state: AppState = {
    revision: 1,
    watchlist: [stock('1.600000'), stock('1.600001')],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    stockTradingBooks: {},
    corporateActionApplications: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER]
  }
  const quotes: StockQuote[] = state.watchlist.map((stock) => ({
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    latest: 12,
    previousClose: 11,
    change: 1,
    changePercent: 100 / 11,
    open: 11,
    high: 12,
    low: 11,
    volume: 1000,
    amount: 12000,
    turnoverRate: 1,
    updatedAt: '2026-11-03 10:00:00'
  }))
  return {
    state,
    quotes,
    trackingArchiveIndex: {},
    writes: { pendingCount: 0, activeOperation: null, lastError: null },
    quotesById: new Map(quotes.map((quote) => [quote.quoteId, quote]))
  }
}

function withQuotes(snapshot: AppDataSnapshot, quotes: StockQuote[]): AppDataSnapshot {
  return { ...snapshot, quotes, quotesById: new Map(quotes.map((quote) => [quote.quoteId, quote])) }
}

describe('shared portfolio projections', () => {
  it('preserves unrelated stock metrics and matches the original summary calculation', () => {
    const select = createPortfolioSelector()
    const initial = fixture()
    const before = select(initial)
    const next = withQuotes(initial, [{ ...initial.quotes[0], latest: 13 }, initial.quotes[1]])
    const after = select(next)
    expect(after.metrics.get('1.600000')).not.toBe(before.metrics.get('1.600000'))
    expect(after.metrics.get('1.600001')).toBe(before.metrics.get('1.600001'))
    const overrides = calculateCurrentPositionProfitOverrides(
      next.state.watchlist,
      next.quotes,
      next.state.stockTradingBooks,
      next.state.settings.exchangeRates
    )
    expect(after.summary).toEqual(
      calculatePortfolioSummary(
        next.state.watchlist,
        next.quotes,
        next.state.stockTradingBooks,
        next.state.settings.exchangeRates,
        overrides
      )
    )
  })

  it('keeps numeric snapshots stable when only quote metadata changes', () => {
    const select = createPortfolioSelector()
    const initial = fixture()
    const before = select(initial)
    const after = select(
      withQuotes(
        initial,
        initial.quotes.map((quote) => ({ ...quote, updatedAt: '2026-11-03 10:00:05' }))
      )
    )
    expect(after.metrics.get('1.600000')).toBe(before.metrics.get('1.600000'))
    expect(after.summary).toBe(before.summary)
  })

  it('uses the current optimistic business state during the staged migration', () => {
    const select = createPortfolioSelector()
    const snapshot = fixture()
    const committed = select(snapshot)
    const edited: AppState = {
      ...snapshot.state,
      watchlist: snapshot.state.watchlist.map((stock, index) =>
        index === 0 ? { ...stock, position: { ...stock.position!, quantity: 200 } } : stock
      )
    }
    const optimistic = select(snapshot, edited)
    expect(optimistic.metrics.get('1.600000')?.marketValue).toBe(2400)
    expect(optimistic.metrics.get('1.600001')).toBe(committed.metrics.get('1.600001'))
    const restored = select(snapshot)
    expect(restored.summary).toEqual(committed.summary)
    const removed = select({ ...snapshot, state: { ...snapshot.state, watchlist: [] } })
    expect(removed.metrics.size).toBe(0)
  })
})
