import type { StockOrderBook } from '../../../../shared/types'
import type { IndicatorValue } from '../../shared/types'
import { directionState, indicator } from './shared'

export interface OrderBookIndicatorResult {
  values: IndicatorValue[]
  imbalance: number | null
}

export function calculateOrderBookIndicators(
  orderBook: StockOrderBook | null,
  calculatedAt: string,
  previousImbalance: number | null = null
): OrderBookIndicatorResult {
  const bidVolume = orderBook?.bids.reduce((total, level) => total + (level.volume ?? 0), 0) ?? null
  const askVolume = orderBook?.asks.reduce((total, level) => total + (level.volume ?? 0), 0) ?? null
  const imbalance =
    bidVolume !== null && askVolume !== null && bidVolume + askVolume > 0
      ? (bidVolume - askVolume) / (bidVolume + askVolume)
      : null
  const imbalanceChange =
    imbalance !== null && previousImbalance !== null ? imbalance - previousImbalance : null
  return {
    imbalance,
    values: [
      indicator('bid-volume', '买五档委托量', bidVolume, 'amount', calculatedAt, '盘口'),
      indicator('ask-volume', '卖五档委托量', askVolume, 'amount', calculatedAt, '盘口'),
      indicator(
        'order-book-imbalance',
        '五档委托不平衡',
        imbalance,
        'ratio',
        calculatedAt,
        '盘口',
        directionState(imbalance)
      ),
      indicator(
        'order-book-imbalance-change',
        '委托不平衡短窗变化',
        imbalanceChange,
        'ratio',
        calculatedAt,
        '盘口短窗',
        directionState(imbalanceChange)
      )
    ]
  }
}
