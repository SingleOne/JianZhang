import type { KlineBar } from '../shared/types'

export const CHIP_TURNOVER_THRESHOLD = 100
export const CHIP_PRICE_BUCKET_COUNT = 150

export interface ChipPriceBucket {
  price: number
  percent: number
}

export interface ChipCostRange {
  low: number
  high: number
  concentration: number
}

export interface ChipDistributionResult {
  startDate: string
  endDate: string
  barCount: number
  cumulativeTurnover: number
  currentPrice: number
  averageCost: number
  profitPercent: number
  cost70: ChipCostRange
  cost90: ChipCostRange
  buckets: ChipPriceBucket[]
}

export interface ChipAutoRange {
  fromIndex: number
  toIndex: number
  barCount: number
  cumulativeTurnover: number
  reachedThreshold: boolean
}

function turnoverRate(bar: KlineBar): number | null {
  return typeof bar.turnoverRate === 'number' && Number.isFinite(bar.turnoverRate)
    ? Math.max(0, bar.turnoverRate)
    : null
}

export function findChipAutoRange(bars: readonly KlineBar[]): ChipAutoRange | null {
  if (bars.length === 0) return null

  let cumulativeTurnover = 0
  let fromIndex = bars.length - 1

  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const rate = turnoverRate(bars[index])
    if (rate === null) return null
    cumulativeTurnover += rate
    fromIndex = index
    if (cumulativeTurnover >= CHIP_TURNOVER_THRESHOLD) break
  }

  return {
    fromIndex,
    toIndex: bars.length - 1,
    barCount: bars.length - fromIndex,
    cumulativeTurnover,
    reachedThreshold: cumulativeTurnover >= CHIP_TURNOVER_THRESHOLD
  }
}

function quantilePrice(
  chips: readonly number[],
  minPrice: number,
  accuracy: number,
  target: number
): number {
  const total = chips.reduce((sum, value) => sum + value, 0)
  const targetChips = total * target
  let accumulated = 0

  for (let index = 0; index < chips.length; index += 1) {
    accumulated += chips[index]
    if (accumulated >= targetChips) return minPrice + accuracy * index
  }

  return minPrice + accuracy * (chips.length - 1)
}

function costRange(
  chips: readonly number[],
  minPrice: number,
  accuracy: number,
  percent: number
): ChipCostRange {
  const edge = (1 - percent) / 2
  const low = quantilePrice(chips, minPrice, accuracy, edge)
  const high = quantilePrice(chips, minPrice, accuracy, 1 - edge)
  return {
    low,
    high,
    concentration: low + high === 0 ? 0 : (high - low) / (high + low) * 100
  }
}

export function calculateChipDistribution(
  bars: readonly KlineBar[]
): ChipDistributionResult | null {
  if (bars.length === 0 || bars.some((bar) => turnoverRate(bar) === null)) return null

  const minPrice = Math.min(...bars.map((bar) => bar.low))
  const maxPrice = Math.max(...bars.map((bar) => bar.high))
  const accuracy = Math.max(0.01, (maxPrice - minPrice) / (CHIP_PRICE_BUCKET_COUNT - 1))
  const chips = Array.from({ length: CHIP_PRICE_BUCKET_COUNT }, () => 0)
  let cumulativeTurnover = 0

  for (const bar of bars) {
    const rate = turnoverRate(bar) ?? 0
    cumulativeTurnover += rate
    const turnover = Math.min(1, rate / 100)

    for (let index = 0; index < chips.length; index += 1) {
      chips[index] *= 1 - turnover
    }

    const lowIndex = Math.max(0, Math.ceil((bar.low - minPrice) / accuracy))
    const highIndex = Math.min(
      CHIP_PRICE_BUCKET_COUNT - 1,
      Math.floor((bar.high - minPrice) / accuracy)
    )
    const averagePrice = (bar.open + bar.close + bar.high + bar.low) / 4
    const weights: Array<{ index: number; value: number }> = []
    let totalWeight = 0

    if (bar.high === bar.low) {
      const index = Math.max(0, Math.min(
        CHIP_PRICE_BUCKET_COUNT - 1,
        Math.round((bar.close - minPrice) / accuracy)
      ))
      weights.push({ index, value: 1 })
      totalWeight = 1
    } else {
      for (let index = lowIndex; index <= highIndex; index += 1) {
        const price = minPrice + accuracy * index
        const weight = price <= averagePrice
          ? averagePrice === bar.low ? 1 : (price - bar.low) / (averagePrice - bar.low)
          : averagePrice === bar.high ? 1 : (bar.high - price) / (bar.high - averagePrice)
        const normalizedWeight = Math.max(0, weight)
        weights.push({ index, value: normalizedWeight })
        totalWeight += normalizedWeight
      }
    }

    if (totalWeight === 0) {
      const index = Math.max(0, Math.min(
        CHIP_PRICE_BUCKET_COUNT - 1,
        Math.round((averagePrice - minPrice) / accuracy)
      ))
      weights.push({ index, value: 1 })
      totalWeight = 1
    }

    for (const weight of weights) {
      chips[weight.index] += turnover * weight.value / totalWeight
    }
  }

  const totalChips = chips.reduce((sum, value) => sum + value, 0)
  if (totalChips === 0) return null

  const currentPrice = bars.at(-1)?.close ?? 0
  const profitChips = chips.reduce((sum, value, index) => (
    minPrice + accuracy * index <= currentPrice ? sum + value : sum
  ), 0)

  return {
    startDate: bars[0].time.slice(0, 10),
    endDate: bars.at(-1)?.time.slice(0, 10) ?? '',
    barCount: bars.length,
    cumulativeTurnover,
    currentPrice,
    averageCost: quantilePrice(chips, minPrice, accuracy, 0.5),
    profitPercent: profitChips / totalChips * 100,
    cost70: costRange(chips, minPrice, accuracy, 0.7),
    cost90: costRange(chips, minPrice, accuracy, 0.9),
    buckets: chips.map((value, index) => ({
      price: minPrice + accuracy * index,
      percent: value / totalChips * 100
    }))
  }
}
