import type { StockQuote, StockPosition, WatchStock } from '../shared/types'

export interface PositionMetrics {
  marketValue: number | null
  todayProfit: number | null
  todayProfitPercent: number | null
  totalProfit: number | null
  profitPercent: number | null
}

export interface PortfolioSummary extends PositionMetrics {
  costBasis: number | null
  positionCount: number
}

export function currentDateKey(): string {
  const now = new Date()
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-')
}

export function isPositionOpenedToday(position: StockPosition | undefined): boolean {
  return Boolean(position?.openedToday && position.openedOn === currentDateKey())
}

export function calculatePositionMetrics(
  position: StockPosition | undefined,
  quote: StockQuote | undefined
): PositionMetrics {
  if (!position || quote?.latest === null || quote?.latest === undefined) {
    return {
      marketValue: null,
      todayProfit: null,
      todayProfitPercent: null,
      totalProfit: null,
      profitPercent: null
    }
  }

  const marketValue = quote.latest * position.quantity
  const totalProfit = (quote.latest - position.cost) * position.quantity
  const todayBase = isPositionOpenedToday(position) ? position.cost : quote.previousClose
  const todayProfit = todayBase === null || todayBase === undefined
    ? null
    : (quote.latest - todayBase) * position.quantity

  return {
    marketValue,
    todayProfit,
    todayProfitPercent: todayBase && todayBase > 0 ? (quote.latest / todayBase - 1) * 100 : null,
    totalProfit,
    profitPercent: (quote.latest / position.cost - 1) * 100
  }
}

export function calculatePortfolioSummary(
  watchlist: WatchStock[],
  quotes: StockQuote[]
): PortfolioSummary {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  let positionCount = 0
  let costBasis = 0
  let marketValue = 0
  let todayProfit = 0
  let todayCostBasis = 0
  let totalProfit = 0
  let pricedPositionCount = 0
  let todayPricedPositionCount = 0

  for (const stock of watchlist) {
    if (!stock.position) continue
    positionCount += 1
    const metrics = calculatePositionMetrics(stock.position, quoteMap.get(stock.quoteId))
    if (metrics.marketValue === null || metrics.totalProfit === null) continue
    pricedPositionCount += 1
    costBasis += stock.position.cost * stock.position.quantity
    marketValue += metrics.marketValue
    totalProfit += metrics.totalProfit
    if (metrics.todayProfit !== null) {
      todayPricedPositionCount += 1
      todayProfit += metrics.todayProfit
      todayCostBasis += metrics.marketValue - metrics.todayProfit
    }
  }

  if (pricedPositionCount === 0) {
    return {
      costBasis: null,
      marketValue: null,
      todayProfit: null,
      todayProfitPercent: null,
      totalProfit: null,
      profitPercent: null,
      positionCount
    }
  }

  return {
    costBasis,
    marketValue,
    todayProfit: todayPricedPositionCount > 0 ? todayProfit : null,
    todayProfitPercent: todayCostBasis > 0 ? todayProfit / todayCostBasis * 100 : null,
    totalProfit,
    profitPercent: costBasis > 0 ? totalProfit / costBasis * 100 : null,
    positionCount
  }
}
