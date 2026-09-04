import type {
  ExchangeRateSettings,
  StockQuote,
  StockPosition,
  TTrade,
  TTradingAccount,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import { DEFAULT_EXCHANGE_RATE_SETTINGS } from '../shared/types'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { countMarketTradingDays, marketDateKey } from '../shared/market-hours'
import { marketFromQuoteId, type StockCurrency, type StockMarket } from '../shared/stock-market'
import { getAccountTrades } from './trade-records'

export interface PositionMetrics {
  currency: StockCurrency
  exchangeRate: number | null
  costExchangeRate: number | null
  marketValue: number | null
  todayProfit: number | null
  todayProfitPercent: number | null
  todayCostBasis: number | null
  holdingCost: number | null
  holdingCostBasis: number | null
  totalProfit: number | null
  profitPercent: number | null
  cnyMarketValue: number | null
  cnyTodayProfit: number | null
  cnyTodayCostBasis: number | null
  cnyCostBasis: number | null
  cnyHoldingCostBasis: number | null
  cnyTotalProfit: number | null
  cnyProfitPercent: number | null
}

export interface PositionProfitOverride {
  totalProfit: number | null
  cnyTotalProfit: number | null
}

export interface PortfolioSummary extends PositionMetrics {
  costBasis: number | null
  positionCount: number
  unconvertedPositionCount: number
  marketValues: Partial<Record<StockMarket, number>>
  currencyValues: Partial<Record<StockCurrency, number>>
}

export function currentDateKey(): string {
  const now = new Date()
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-')
}

export function isPositionOpenedToday(
  position: StockPosition | undefined,
  market: StockMarket = 'CN'
): boolean {
  return position?.openedOn === marketDateKey(new Date(), market)
}

export function getAvailablePositionQuantity(
  position: StockPosition | undefined,
  account: TTradingAccount | undefined,
  market: StockMarket = 'CN'
): number | null {
  if (!position) return null
  if (market !== 'CN') return position.quantity
  if (isPositionOpenedToday(position, market)) return 0

  const today = currentDateKey()
  const trades = getAccountTrades(account)
  const todayPurchasedQuantity = trades.reduce(
    (total, trade) =>
      trade.side === 'buy' && trade.tradedAt.slice(0, 10) === today
        ? total + trade.quantity
        : total,
    0
  )

  return Math.max(0, position.quantity - todayPurchasedQuantity)
}

export function getPositionHoldingDays(
  position: StockPosition | undefined,
  additionalClosedDates: readonly string[] = [],
  market: StockMarket = 'CN',
  halfDayDates: readonly string[] = []
): number | null {
  if (!position?.openedOn) return null

  const holdingDays = countMarketTradingDays(
    market,
    position.openedOn,
    marketDateKey(new Date(), market),
    { closedDates: additionalClosedDates, halfDayDates }
  )
  return holdingDays > 0 ? holdingDays : null
}

function getTradeFees(trade: TTrade): number {
  return (
    trade.fees.commission +
    trade.fees.handling +
    trade.fees.regulatory +
    trade.fees.transfer +
    trade.fees.stampDuty +
    (trade.feeItems ?? []).reduce((total, item) => total + item.amount, 0)
  )
}

export function calculatePositionMetrics(
  position: StockPosition | undefined,
  quote: StockQuote | undefined,
  account?: TTradingAccount,
  exchangeRates: ExchangeRateSettings = DEFAULT_EXCHANGE_RATE_SETTINGS,
  profitOverride?: PositionProfitOverride
): PositionMetrics {
  const market = marketFromQuoteId(quote?.quoteId ?? account?.quoteId ?? '')
  const currency = position?.currency ?? quote?.currency ?? 'CNY'
  const exchangeRate = exchangeRateForCurrency(exchangeRates, currency)
  const costExchangeRate = position?.costExchangeRate ?? (currency === 'CNY' ? 1 : null)
  const latest = quote?.latest
  const marketValue =
    position && latest !== null && latest !== undefined ? latest * position.quantity : null
  const inventoryProfit =
    position && latest !== null && latest !== undefined
      ? (latest - position.cost) * position.quantity
      : null
  const totalProfit = profitOverride ? profitOverride.totalProfit : inventoryProfit
  const today = marketDateKey(new Date(), market)
  const todayTrades = getAccountTrades(account).filter(
    (trade) => trade.tradedAt.slice(0, 10) === today
  )

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
    const openedToday = isPositionOpenedToday(position, market)
    const openingValue =
      openedToday && position
        ? position.cost * currentQuantity - buyCost + sellProceeds
        : quote?.previousClose === null || quote?.previousClose === undefined
          ? null
          : openingQuantity * quote.previousClose
    const currentValue = currentQuantity === 0 ? 0 : marketValue

    if (openingValue !== null && currentValue !== null) {
      todayCostBasis = openingValue + buyCost
      todayProfit = currentValue + sellProceeds - todayCostBasis
    }
  }

  const todayProfitPercent =
    todayProfit !== null && todayCostBasis && todayCostBasis > 0
      ? (todayProfit / todayCostBasis) * 100
      : null
  const inventoryCostBasis = position ? position.cost * position.quantity : null
  const holdingCostBasis = profitOverride
    ? marketValue !== null && totalProfit !== null
      ? marketValue - totalProfit
      : null
    : inventoryCostBasis
  const holdingCost =
    position && position.quantity > 0 && holdingCostBasis !== null
      ? holdingCostBasis / position.quantity
      : null
  const profitPercent =
    holdingCostBasis !== null && holdingCostBasis > 0 && totalProfit !== null
      ? (totalProfit / holdingCostBasis) * 100
      : null
  const cnyMarketValue =
    marketValue !== null && exchangeRate !== null ? marketValue * exchangeRate : null
  const cnyTodayProfit =
    todayProfit !== null && exchangeRate !== null ? todayProfit * exchangeRate : null
  const cnyTodayCostBasis =
    todayCostBasis !== null && exchangeRate !== null ? todayCostBasis * exchangeRate : null
  const cnyCostBasis =
    position && costExchangeRate !== null
      ? position.cost * position.quantity * costExchangeRate
      : null
  const cnyTotalProfit = profitOverride
    ? profitOverride.cnyTotalProfit
    : cnyMarketValue !== null && cnyCostBasis !== null
      ? cnyMarketValue - cnyCostBasis
      : null
  const cnyHoldingCostBasis = profitOverride
    ? cnyMarketValue !== null && cnyTotalProfit !== null
      ? cnyMarketValue - cnyTotalProfit
      : null
    : cnyCostBasis
  return {
    currency,
    exchangeRate,
    costExchangeRate,
    marketValue,
    todayProfit,
    todayProfitPercent,
    todayCostBasis,
    holdingCost,
    holdingCostBasis,
    totalProfit,
    profitPercent,
    cnyMarketValue,
    cnyTodayProfit,
    cnyTodayCostBasis,
    cnyCostBasis,
    cnyHoldingCostBasis,
    cnyTotalProfit,
    cnyProfitPercent:
      cnyHoldingCostBasis !== null && cnyHoldingCostBasis > 0 && cnyTotalProfit !== null
        ? (cnyTotalProfit / cnyHoldingCostBasis) * 100
        : null
  }
}

export function calculatePortfolioSummary(
  watchlist: WatchStock[],
  quotes: StockQuote[],
  tTradingAccounts: TTradingAccounts,
  exchangeRates: ExchangeRateSettings = DEFAULT_EXCHANGE_RATE_SETTINGS,
  profitOverrides: Readonly<Record<string, PositionProfitOverride>> = {}
): PortfolioSummary {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  let positionCount = 0
  let costBasis = 0
  let marketValue = 0
  let todayProfit = 0
  let todayCostBasis = 0
  let totalProfit = 0
  let marketValuePositionCount = 0
  let profitPositionCount = 0
  let todayPricedPositionCount = 0
  let unconvertedPositionCount = 0
  const marketValues: Partial<Record<StockMarket, number>> = {}
  const currencyValues: Partial<Record<StockCurrency, number>> = {}

  for (const stock of watchlist) {
    if (stock.position) positionCount += 1
    const metrics = calculatePositionMetrics(
      stock.position,
      quoteMap.get(stock.quoteId),
      tTradingAccounts[stock.quoteId],
      exchangeRates,
      profitOverrides[stock.quoteId]
    )
    if (stock.position && metrics.cnyMarketValue !== null) {
      marketValuePositionCount += 1
      marketValue += metrics.cnyMarketValue
      const market = stock.market ?? marketFromQuoteId(stock.quoteId)
      marketValues[market] = (marketValues[market] ?? 0) + metrics.cnyMarketValue
      currencyValues[metrics.currency] =
        (currencyValues[metrics.currency] ?? 0) + metrics.cnyMarketValue
    }
    if (stock.position && metrics.cnyHoldingCostBasis !== null && metrics.cnyTotalProfit !== null) {
      profitPositionCount += 1
      costBasis += metrics.cnyHoldingCostBasis
      totalProfit += metrics.cnyTotalProfit
    } else if (stock.position) {
      unconvertedPositionCount += 1
    }
    if (metrics.cnyTodayProfit !== null && metrics.cnyTodayCostBasis !== null) {
      todayPricedPositionCount += 1
      todayProfit += metrics.cnyTodayProfit
      todayCostBasis += metrics.cnyTodayCostBasis
    }
  }

  return {
    currency: 'CNY',
    exchangeRate: 1,
    costExchangeRate: 1,
    costBasis: profitPositionCount > 0 ? costBasis : null,
    marketValue: marketValuePositionCount > 0 ? marketValue : null,
    todayProfit: todayPricedPositionCount > 0 ? todayProfit : null,
    todayProfitPercent: todayCostBasis > 0 ? (todayProfit / todayCostBasis) * 100 : null,
    todayCostBasis: todayPricedPositionCount > 0 ? todayCostBasis : null,
    holdingCost: null,
    holdingCostBasis: profitPositionCount > 0 ? costBasis : null,
    totalProfit: profitPositionCount > 0 ? totalProfit : null,
    profitPercent: costBasis > 0 ? (totalProfit / costBasis) * 100 : null,
    cnyMarketValue: marketValuePositionCount > 0 ? marketValue : null,
    cnyTodayProfit: todayPricedPositionCount > 0 ? todayProfit : null,
    cnyTodayCostBasis: todayPricedPositionCount > 0 ? todayCostBasis : null,
    cnyCostBasis: profitPositionCount > 0 ? costBasis : null,
    cnyHoldingCostBasis: profitPositionCount > 0 ? costBasis : null,
    cnyTotalProfit: profitPositionCount > 0 ? totalProfit : null,
    cnyProfitPercent: costBasis > 0 ? (totalProfit / costBasis) * 100 : null,
    positionCount,
    unconvertedPositionCount,
    marketValues,
    currencyValues
  }
}
