import {
  calculatePositionMetrics,
  calculatePortfolioSummary,
  type PositionProfitOverride
} from '../portfolio'
import { calculateCurrentPositionProfitOverride } from '../portfolio-performance'
import { reuseUnchangedState } from '../../shared/state-changes'
import { marketDateKey } from '../../shared/market-hours'
import { marketFromQuoteId } from '../../shared/stock-market'
import type { AppDataSnapshot } from './center'

function sameInputs(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

function exposureText(summary: ReturnType<typeof calculatePortfolioSummary>): string {
  const total = summary.marketValue ?? 0
  if (total <= 0) return ''
  const labels = { CN: 'A股', HK: '港股', US: '美股' }
  const market = (['CN', 'HK', 'US'] as const)
    .filter((key) => (summary.marketValues[key] ?? 0) > 0)
    .map(
      (key) => `${labels[key]} ${(((summary.marketValues[key] ?? 0) / total) * 100).toFixed(1)}%`
    )
    .join(' · ')
  const currency = (['CNY', 'HKD', 'USD'] as const)
    .filter((key) => (summary.currencyValues[key] ?? 0) > 0)
    .map((key) => `${key} ${(((summary.currencyValues[key] ?? 0) / total) * 100).toFixed(1)}%`)
    .join(' · ')
  return [market, currency].filter(Boolean).join(' ｜ ')
}

/** One cache per renderer, shared by rows and summaries. Removed stocks release their entries. */
export function createPortfolioSelector() {
  const cache = new Map<
    string,
    {
      inputs: unknown[]
      metrics: ReturnType<typeof calculatePositionMetrics>
      override: PositionProfitOverride | undefined
    }
  >()
  let previousInputs: readonly unknown[] | undefined
  let result:
    | {
        metrics: ReadonlyMap<string, ReturnType<typeof calculatePositionMetrics>>
        overrides: Readonly<Record<string, PositionProfitOverride>>
        summary: ReturnType<typeof calculatePortfolioSummary>
        exposureText: string
      }
    | undefined

  return (snapshot: AppDataSnapshot) => {
    const { state } = snapshot
    const now = new Date()
    const inputs = [
      state.watchlist,
      state.stockTradingBooks,
      state.settings.exchangeRates,
      state.portfolioPerformanceAdjustments,
      snapshot.quotes,
      ...(['CN', 'HK', 'US'] as const).map((market) => marketDateKey(now, market))
    ]
    if (previousInputs && sameInputs(previousInputs, inputs) && result) return result
    previousInputs = inputs
    const { quotes, quotesById } = snapshot
    const ids = new Set(state.watchlist.map((stock) => stock.quoteId))
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
    const overrides: Record<string, PositionProfitOverride> = {}
    const metrics = new Map<string, ReturnType<typeof calculatePositionMetrics>>()
    for (const stock of state.watchlist) {
      const quote = quotesById.get(stock.quoteId)
      const book = state.stockTradingBooks[stock.quoteId]
      const rates = state.settings.exchangeRates
      const rawAdjustment = state.portfolioPerformanceAdjustments?.[stock.quoteId]
      const adjustment = Number.isFinite(rawAdjustment) ? rawAdjustment! : 0
      const day = marketDateKey(now, marketFromQuoteId(stock.quoteId))
      // These calculations consume price, previous close and currency, not fetch timestamps.
      const inputs = [
        stock,
        quote?.quoteId,
        quote?.latest,
        quote?.previousClose,
        quote?.currency,
        book,
        rates,
        adjustment,
        day
      ]
      let entry = cache.get(stock.quoteId)
      if (!entry || !sameInputs(entry.inputs, inputs)) {
        const override = calculateCurrentPositionProfitOverride(
          stock,
          quote,
          book,
          rates,
          adjustment
        )
        const nextMetrics = calculatePositionMetrics(stock.position, quote, book, rates, override)
        entry = {
          inputs,
          metrics: entry ? reuseUnchangedState(entry.metrics, nextMetrics) : nextMetrics,
          override: entry ? reuseUnchangedState(entry.override, override) : override
        }
        cache.set(stock.quoteId, entry)
      }
      metrics.set(stock.quoteId, entry.metrics)
      if (entry.override) overrides[stock.quoteId] = entry.override
    }
    const summary = calculatePortfolioSummary(
      state.watchlist,
      quotes,
      state.stockTradingBooks,
      state.settings.exchangeRates,
      overrides,
      metrics
    )
    result = {
      metrics,
      overrides,
      summary: result ? reuseUnchangedState(result.summary, summary) : summary,
      exposureText: exposureText(summary)
    }
    return result
  }
}

export const selectPortfolio = createPortfolioSelector()
