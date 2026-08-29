import type { KlineBar } from '../../../../shared/types'
import type { IndicatorValue } from '../../shared/types'
import { directionState, indicator, median } from './shared'

export interface IntradayIndicatorResult {
  values: IndicatorValue[]
  vwap: number | null
  openingRange15: { high: number | null; low: number | null }
}

function minuteOfDay(bar: KlineBar): number {
  const [hour, minute] = bar.time.slice(11, 16).split(':').map(Number)
  return hour * 60 + minute
}

function isRegularBar(bar: KlineBar): boolean {
  const minute = minuteOfDay(bar)
  return (
    (minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) || (minute >= 13 * 60 && minute <= 15 * 60)
  )
}

function percentageChange(
  previous: number | undefined,
  current: number | undefined
): number | null {
  return previous === undefined || current === undefined || previous === 0
    ? null
    : (current / previous - 1) * 100
}

function rangeForMinutes(
  bars: readonly KlineBar[],
  endMinute: number
): { high: number | null; low: number | null } {
  const items = bars.filter((bar) => {
    const minute = minuteOfDay(bar)
    return minute >= 9 * 60 + 30 && minute <= endMinute
  })
  if (items.length === 0) return { high: null, low: null }
  let high = items[0].high
  let low = items[0].low
  for (let index = 1; index < items.length; index += 1) {
    high = Math.max(high, items[index].high)
    low = Math.min(low, items[index].low)
  }
  return { high, low }
}

export function calculateIntradayIndicators(
  inputBars: readonly KlineBar[],
  latest: number | null,
  calculatedAt: string
): IntradayIndicatorResult {
  const bars = inputBars.filter(isRegularBar)
  const closedBars = bars.slice(0, -1)
  const last = closedBars.at(-1)
  const displayLatest = latest ?? last?.close ?? null
  let cumulativeAmount = 0
  let cumulativeShares = 0
  for (const bar of closedBars) {
    cumulativeAmount += bar.amount
    cumulativeShares += bar.volume * 100
  }
  const vwap = cumulativeShares > 0 ? cumulativeAmount / cumulativeShares : null
  const vwapDeviation =
    displayLatest !== null && vwap !== null && vwap !== 0 ? (displayLatest / vwap - 1) * 100 : null
  const priceReturns = [1, 3, 5, 15].map((window) => ({
    window,
    value: percentageChange(closedBars.at(-(window + 1))?.close, displayLatest ?? undefined)
  }))
  const high = closedBars.length > 0 ? Math.max(...closedBars.map((bar) => bar.high)) : null
  const low = closedBars.length > 0 ? Math.min(...closedBars.map((bar) => bar.low)) : null
  const dayPosition =
    displayLatest !== null && high !== null && low !== null && high !== low
      ? ((displayLatest - low) / (high - low)) * 100
      : null
  const openingRange15 = rangeForMinutes(closedBars, 9 * 60 + 44)
  const openingRange30 = rangeForMinutes(closedBars, 9 * 60 + 59)
  const currentWindowVolume =
    closedBars.length >= 5
      ? closedBars.slice(-5).reduce((total, bar) => total + bar.volume, 0)
      : null
  const previousWindowVolumes: number[] = []
  for (let end = closedBars.length - 5; end >= 5 && previousWindowVolumes.length < 20; end -= 5) {
    previousWindowVolumes.push(
      closedBars.slice(end - 5, end).reduce((total, bar) => total + bar.volume, 0)
    )
  }
  const medianWindowVolume = median(previousWindowVolumes)
  const volumeRatio =
    currentWindowVolume !== null && medianWindowVolume !== null && medianWindowVolume > 0
      ? currentWindowVolume / medianWindowVolume
      : null
  const recentPriceChange = percentageChange(closedBars.at(-6)?.close, last?.close)
  const volumeDirection =
    volumeRatio === null || recentPriceChange === null
      ? 'unknown'
      : volumeRatio >= 1 && recentPriceChange > 0
        ? 'up'
        : volumeRatio >= 1 && recentPriceChange < 0
          ? 'down'
          : 'flat'

  return {
    vwap,
    openingRange15,
    values: [
      indicator('vwap', '当日 VWAP', vwap, 'price', calculatedAt, '分时'),
      indicator(
        'vwap-deviation',
        '相对 VWAP',
        vwapDeviation,
        'percent',
        calculatedAt,
        '分时',
        directionState(vwapDeviation)
      ),
      ...priceReturns.map(({ window, value }) =>
        indicator(
          `return-${window}m`,
          `${window} 分钟收益`,
          value,
          'percent',
          calculatedAt,
          '分时',
          directionState(value)
        )
      ),
      indicator(
        'intraday-position',
        '当日高低点位置',
        dayPosition,
        'percent',
        calculatedAt,
        '分时',
        dayPosition === null
          ? 'unknown'
          : dayPosition > 50
            ? 'up'
            : dayPosition < 50
              ? 'down'
              : 'flat'
      ),
      indicator(
        'opening-range-15-high',
        '开盘 15 分钟高点',
        openingRange15.high,
        'price',
        calculatedAt,
        '分时'
      ),
      indicator(
        'opening-range-15-low',
        '开盘 15 分钟低点',
        openingRange15.low,
        'price',
        calculatedAt,
        '分时'
      ),
      indicator(
        'opening-range-30-high',
        '开盘 30 分钟高点',
        openingRange30.high,
        'price',
        calculatedAt,
        '分时'
      ),
      indicator(
        'opening-range-30-low',
        '开盘 30 分钟低点',
        openingRange30.low,
        'price',
        calculatedAt,
        '分时'
      ),
      indicator(
        'volume-ratio-5m',
        '5 分钟成交量倍数',
        volumeRatio,
        'ratio',
        calculatedAt,
        '分时',
        volumeRatio === null
          ? 'unknown'
          : volumeRatio > 1
            ? 'up'
            : volumeRatio < 1
              ? 'down'
              : 'flat'
      ),
      indicator(
        'price-volume-state',
        '量价状态',
        volumeRatio === null || recentPriceChange === null ? null : volumeRatio,
        'ratio',
        calculatedAt,
        '分时',
        volumeDirection
      )
    ]
  }
}
