import type {
  FiveLevelLargeOrderAlert,
  FiveLevelLargeOrderSide,
  OrderBookLevel,
  StockOrderBook
} from '../shared/types'

function detectSideLargeOrder(
  side: FiveLevelLargeOrderSide,
  levels: readonly OrderBookLevel[]
): FiveLevelLargeOrderAlert | null {
  const fiveLevels = levels.slice(0, 5)
  if (fiveLevels.length !== 5 || fiveLevels.some((level) => level.volume === null)) return null

  let largestIndex = 0
  for (let index = 1; index < fiveLevels.length; index += 1) {
    if (fiveLevels[index].volume! > fiveLevels[largestIndex].volume!) largestIndex = index
  }

  const largest = fiveLevels[largestIndex]
  const volume = largest.volume!
  const otherLevelsVolume = fiveLevels.reduce(
    (total, level, index) => (index === largestIndex ? total : total + level.volume!),
    0
  )
  if (volume <= otherLevelsVolume) return null

  return {
    side,
    level: largestIndex + 1,
    price: largest.price,
    volume,
    otherLevelsVolume
  }
}

export function detectFiveLevelLargeOrders(orderBook: StockOrderBook): FiveLevelLargeOrderAlert[] {
  return [
    detectSideLargeOrder('buy', orderBook.bids),
    detectSideLargeOrder('sell', orderBook.asks)
  ].filter((alert): alert is FiveLevelLargeOrderAlert => alert !== null)
}
