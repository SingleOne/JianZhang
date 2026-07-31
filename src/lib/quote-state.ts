import type { FiveLevelLargeOrderAlert, StockQuote, StockRadarSignal } from '../shared/types'

function radarSignalEqual(left: StockRadarSignal, right: StockRadarSignal): boolean {
  return (
    left.type === right.type &&
    left.label === right.label &&
    left.date === right.date &&
    left.time === right.time &&
    left.info === right.info &&
    left.direction === right.direction
  )
}

function fiveLevelAlertEqual(
  left: FiveLevelLargeOrderAlert,
  right: FiveLevelLargeOrderAlert
): boolean {
  return (
    left.side === right.side &&
    left.level === right.level &&
    left.price === right.price &&
    left.volume === right.volume &&
    left.otherLevelsVolume === right.otherLevelsVolume
  )
}

function arrayEqual<T>(
  left: T[] | undefined,
  right: T[] | undefined,
  itemEqual: (leftItem: T, rightItem: T) => boolean
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((item, index) => itemEqual(item, right[index]))
}

export function stockQuoteEqual(left: StockQuote, right: StockQuote): boolean {
  return (
    left.quoteId === right.quoteId &&
    left.code === right.code &&
    left.name === right.name &&
    left.latest === right.latest &&
    left.change === right.change &&
    left.changePercent === right.changePercent &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.previousClose === right.previousClose &&
    left.volume === right.volume &&
    left.amount === right.amount &&
    left.turnoverRate === right.turnoverRate &&
    left.updatedAt === right.updatedAt &&
    left.sector?.quoteId === right.sector?.quoteId &&
    left.sector?.code === right.sector?.code &&
    left.sector?.name === right.sector?.name &&
    left.sector?.changePercent === right.sector?.changePercent &&
    arrayEqual(left.radarSignals, right.radarSignals, radarSignalEqual) &&
    arrayEqual(left.fiveLevelLargeOrders, right.fiveLevelLargeOrders, fiveLevelAlertEqual)
  )
}

export function reconcileStockQuotes(current: StockQuote[], incoming: StockQuote[]): StockQuote[] {
  const currentById = new Map(current.map((quote) => [quote.quoteId, quote]))
  const reconciled = incoming.map((quote) => {
    const previous = currentById.get(quote.quoteId)
    return previous && stockQuoteEqual(previous, quote) ? previous : quote
  })
  const unchanged =
    current.length === reconciled.length &&
    reconciled.every((quote, index) => quote === current[index])
  return unchanged ? current : reconciled
}
