import type {
  StockQuote,
  StockPosition,
  TTrade,
  TTradingAccount,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import { countAStockTradingDays } from '../shared/trading-calendar'
import { getAccountTrades } from './trade-records'

export interface PositionMetrics {
  marketValue: number | null
  todayProfit: number | null
  todayProfitPercent: number | null
  todayCostBasis: number | null
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
  return position?.openedOn === currentDateKey()
}

export function getAvailablePositionQuantity(
  position: StockPosition | undefined,
  account: TTradingAccount | undefined
): number | null {
  if (!position) return null
  if (isPositionOpenedToday(position)) return 0

  const today = currentDateKey()
  const trades = getAccountTrades(account)
  const todayPurchasedQuantity = trades.reduce((total, trade) => (
    trade.side === 'buy' && trade.tradedAt.slice(0, 10) === today
      ? total + trade.quantity
      : total
  ), 0)

  return Math.max(0, position.quantity - todayPurchasedQuantity)
}

export function getPositionHoldingDays(
  position: StockPosition | undefined,
  additionalClosedDates: readonly string[] = []
): number | null {
  if (!position?.openedOn) return null

  const holdingDays = countAStockTradingDays(position.openedOn, currentDateKey(), additionalClosedDates)
  return holdingDays > 0 ? holdingDays : null
}

function getTradeFees(trade: TTrade): number {
  return trade.fees.commission
    + trade.fees.handling
    + trade.fees.regulatory
    + trade.fees.transfer
    + trade.fees.stampDuty
}

export function calculatePositionMetrics(
  position: StockPosition | undefined,
  quote: StockQuote | undefined,
  account?: TTradingAccount
): PositionMetrics {
  const latest = quote?.latest
  const marketValue = position && latest !== null && latest !== undefined
    ? latest * position.quantity
    : null
  const totalProfit = position && latest !== null && latest !== undefined
    ? (latest - position.cost) * position.quantity
    : null
  const today = currentDateKey()
  const todayTrades = getAccountTrades(account)
    .filter((trade) => trade.tradedAt.slice(0, 10) === today)

  let todayProfit: number | null = null
  let todayCostBasis: number | null = null
  if (position || todayTrades.length > 0) {
    const currentQuantity = position?.quantity ?? 0
    let buyQuantity = 0
    let sellQuantity = 0
    let buyCost = 0
    let sellProceeds = 0

    for (const trade of todayTrades) {
      const amount = trade.price * trade.quantity
      const fees = getTradeFees(trade)
      if (trade.side === 'buy') {
        buyQuantity += trade.quantity
        buyCost += amount + fees
      } else {
        sellQuantity += trade.quantity
        sellProceeds += amount - fees
      }
    }

    const openingQuantity = Math.max(0, currentQuantity - buyQuantity + sellQuantity)
    const openedToday = isPositionOpenedToday(position)
    const openingValue = openedToday && position
      ? position.cost * currentQuantity - buyCost + sellProceeds
      : quote?.previousClose === null || quote?.previousClose === undefined
        ? null
        : openingQuantity * quote.previousClose
    const currentValue = currentQuantity === 0
      ? 0
      : marketValue

    if (openingValue !== null && currentValue !== null) {
      todayCostBasis = openingValue + buyCost
      todayProfit = currentValue + sellProceeds - todayCostBasis
    }
  }

  return {
    marketValue,
    todayProfit,
    todayProfitPercent: todayProfit !== null && todayCostBasis && todayCostBasis > 0
      ? todayProfit / todayCostBasis * 100
      : null,
    todayCostBasis,
    totalProfit,
    profitPercent: position && latest !== null && latest !== undefined
      ? (latest / position.cost - 1) * 100
      : null
  }
}

export function calculatePortfolioSummary(
  watchlist: WatchStock[],
  quotes: StockQuote[],
  tTradingAccounts: TTradingAccounts
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
    if (stock.position) positionCount += 1
    const metrics = calculatePositionMetrics(
      stock.position,
      quoteMap.get(stock.quoteId),
      tTradingAccounts[stock.quoteId]
    )
    if (stock.position && metrics.marketValue !== null && metrics.totalProfit !== null) {
      pricedPositionCount += 1
      costBasis += stock.position.cost * stock.position.quantity
      marketValue += metrics.marketValue
      totalProfit += metrics.totalProfit
    }
    if (metrics.todayProfit !== null && metrics.todayCostBasis !== null) {
      todayPricedPositionCount += 1
      todayProfit += metrics.todayProfit
      todayCostBasis += metrics.todayCostBasis
    }
  }

  return {
    costBasis: pricedPositionCount > 0 ? costBasis : null,
    marketValue: pricedPositionCount > 0 ? marketValue : null,
    todayProfit: todayPricedPositionCount > 0 ? todayProfit : null,
    todayProfitPercent: todayCostBasis > 0 ? todayProfit / todayCostBasis * 100 : null,
    todayCostBasis: todayPricedPositionCount > 0 ? todayCostBasis : null,
    totalProfit: pricedPositionCount > 0 ? totalProfit : null,
    profitPercent: costBasis > 0 ? totalProfit / costBasis * 100 : null,
    positionCount
  }
}
