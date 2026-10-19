import type { AppState, StockQuote } from '../shared/types'
import { marketFromQuoteId } from '../shared/stock-market'
import { calculatePositionMetrics } from './portfolio'
import { calculateCurrentPositionProfitOverride } from './portfolio-performance'
import { stockTOverview } from './stock-accounts'
import { getTaskbarVisibleStocks } from './taskbar-visibility'

export function getTraySummaryStocks(state: AppState, quotes: readonly StockQuote[]) {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  return getTaskbarVisibleStocks(state.watchlist).map((stock) => {
    const quote = quoteMap.get(stock.quoteId)
    const account = state.stockTradingBooks[stock.quoteId]
    const overview = stockTOverview(account, quote?.latest, {
      market: stock.market ?? marketFromQuoteId(stock.quoteId),
      instrumentType: stock.instrumentType,
      feeState: {
        securitiesAccounts: state.securitiesAccounts,
        feeSchemes: state.feeSchemes,
        settings: state.settings
      }
    })
    const profitOverride = calculateCurrentPositionProfitOverride(
      stock,
      quote,
      account,
      state.settings.exchangeRates,
      state.portfolioPerformanceAdjustments?.[stock.quoteId] ?? 0
    )
    return {
      stock,
      quote,
      positionMetrics: calculatePositionMetrics(
        stock.position,
        quote,
        account,
        state.settings.exchangeRates,
        profitOverride
      ),
      tSummaries: overview.summaries,
      alertBadges: overview.badges,
      floatingAlerts: overview.floatingAlerts
    }
  })
}

export function getTrayTodayProfitTotal(stocks: ReturnType<typeof getTraySummaryStocks>) {
  return stocks.reduce<number | null>(
    (total, { positionMetrics }) =>
      positionMetrics.cnyTodayProfit === null
        ? total
        : (total ?? 0) + positionMetrics.cnyTodayProfit,
    null
  )
}
