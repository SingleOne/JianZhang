import { calculatePortfolioSummary, calculatePositionMetrics } from './portfolio'
import { calculateCurrentPositionProfitOverrides } from './portfolio-performance'
import { stockQuoteDataState } from './quote-state'
import { isMarketOpen, marketDateKey } from '../shared/market-hours'
import { marketFromQuoteId } from '../shared/stock-market'
import type { AppState, StockQuote } from '../shared/types'

export interface WidgetPriceSample {
  time: number
  price: number
}

export interface DesktopWidgetSnapshot {
  schemaVersion: 1
  generatedAt: number
  appRunning: boolean
  calendarKey: string
  marketScheduleAt: number
  groups: { id: string; name: string }[]
  markets: Record<string, { at: number; open: boolean }[]>
  stocks: {
    id: string
    code: string
    name: string
    market: string
    currency: string
    groupIds: string[]
    priority: boolean
    holding: boolean
    latest: number | null
    change: number | null
    changePercent: number | null
    dataAt: number | null
    status: string
    history: WidgetPriceSample[]
  }[]
  portfolio: {
    count: number
    complete: boolean
    marketValue: number | null
    todayProfit: number | null
    todayProfitPercent: number | null
    totalProfit: number | null
  }
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function widgetNavigationQuoteId(url: string): string | null | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'jianzhang:' || parsed.hostname !== 'widget') return undefined
    if (parsed.pathname === '' || parsed.pathname === '/') return null
    const match = /^\/stock\/([^/]+)$/.exec(parsed.pathname)
    return match ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

export function createDesktopWidgetSnapshot(
  state: AppState,
  quotes: readonly StockQuote[],
  previous?: DesktopWidgetSnapshot,
  now = new Date(),
  appRunning = true
): DesktopWidgetSnapshot {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  const previousStocks = new Map(previous?.stocks.map((stock) => [stock.id, stock]))
  const overrides = calculateCurrentPositionProfitOverrides(
    state.watchlist,
    [...quotes],
    state.stockTradingBooks,
    state.settings.exchangeRates,
    state.portfolioPerformanceAdjustments ?? {}
  )
  const summary = calculatePortfolioSummary(
    state.watchlist,
    [...quotes],
    state.stockTradingBooks,
    state.settings.exchangeRates,
    overrides
  )
  const generatedAt = now.getTime() / 1000
  const calendarKey = JSON.stringify(state.settings.tradingCalendar.markets)
  const reuseSchedule =
    previous?.calendarKey === calendarKey && generatedAt - previous.marketScheduleAt < 12 * 3600
  const markets: DesktopWidgetSnapshot['markets'] = {}
  const stocks = state.watchlist.map((stock) => {
    const quote = quoteMap.get(stock.quoteId)
    const market = stock.market ?? marketFromQuoteId(stock.quoteId)
    if (!markets[market] && reuseSchedule && previous?.markets[market]) {
      markets[market] = previous.markets[market]
    }
    if (!markets[market]) {
      const calendar = state.settings.tradingCalendar.markets[market]
      const transitions = [{ at: generatedAt, open: isMarketOpen(market, now, calendar) }]
      // Future entries only change market/freshness labels, never invent future quotes.
      for (let minutes = 1; minutes <= 24 * 60; minutes += 1) {
        const at = generatedAt + minutes * 60
        const open = isMarketOpen(market, new Date(at * 1000), calendar)
        if (open !== transitions.at(-1)!.open) transitions.push({ at, open })
      }
      markets[market] = transitions
    }
    const dataAt = quote?.dataAt ? finite(Date.parse(quote.dataAt) / 1000) : null
    const today = marketDateKey(now, market)
    const history = (previousStocks.get(stock.quoteId)?.history ?? []).filter(
      (point) => marketDateKey(new Date(point.time * 1000), market) === today
    )
    const last = history.at(-1)
    if (
      dataAt !== null &&
      dataAt <= generatedAt + 300 &&
      finite(quote?.latest) !== null &&
      marketDateKey(new Date(dataAt * 1000), market) === today &&
      (!last || dataAt - last.time >= 30)
    ) {
      history.push({ time: dataAt, price: quote!.latest! })
    }
    return {
      id: stock.quoteId,
      code: stock.code,
      name: stock.name,
      market,
      currency:
        quote?.currency ??
        stock.currency ??
        (market === 'CN' ? 'CNY' : market === 'HK' ? 'HKD' : 'USD'),
      groupIds: stock.groupIds ?? [],
      priority: stock.isPriority,
      holding: Boolean(stock.position && stock.position.quantity > 0),
      latest: finite(quote?.latest),
      change: finite(quote?.change),
      changePercent: finite(quote?.changePercent),
      dataAt,
      status: stockQuoteDataState(quote, now, state.settings.tradingCalendar.markets[market]),
      history: history.slice(-60)
    }
  })
  const held = state.watchlist.filter((stock) => stock.position && stock.position.quantity > 0)
  const complete = held.every((stock) => {
    const metrics = calculatePositionMetrics(
      stock.position,
      quoteMap.get(stock.quoteId),
      state.stockTradingBooks[stock.quoteId],
      state.settings.exchangeRates,
      overrides[stock.quoteId]
    )
    return (
      finite(metrics.cnyMarketValue) !== null &&
      finite(metrics.cnyTodayProfit) !== null &&
      finite(metrics.cnyTotalProfit) !== null
    )
  })
  return {
    schemaVersion: 1,
    generatedAt,
    appRunning,
    calendarKey,
    marketScheduleAt: reuseSchedule ? previous.marketScheduleAt : generatedAt,
    groups: state.watchlistGroups.map(({ id, name }) => ({ id, name })),
    markets,
    stocks,
    portfolio: {
      count: held.length,
      complete,
      marketValue: complete ? finite(summary.marketValue) : null,
      todayProfit: complete ? finite(summary.todayProfit) : null,
      todayProfitPercent: complete ? finite(summary.todayProfitPercent) : null,
      totalProfit: complete ? finite(summary.totalProfit) : null
    }
  }
}
