import type { StockQuote, StockPosition } from '../shared/types'

export interface PositionMetrics {
  marketValue: number | null
  todayProfit: number | null
  totalProfit: number | null
  profitPercent: number | null
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
    return { marketValue: null, todayProfit: null, totalProfit: null, profitPercent: null }
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
    totalProfit,
    profitPercent: (quote.latest / position.cost - 1) * 100
  }
}
