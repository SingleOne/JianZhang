import type { KlineBar } from '../../../../shared/types'
import type { IndicatorValue } from '../../shared/types'
import { directionState, indicator } from './shared'

function sma(values: readonly number[], period: number): number | null {
  if (values.length < period) return null
  return values.slice(-period).reduce((total, value) => total + value, 0) / period
}

export function ema(values: readonly number[], period: number): number | null {
  if (values.length < period) return null
  const multiplier = 2 / (period + 1)
  let result = values[0]
  for (let index = 1; index < values.length; index += 1)
    result = (values[index] - result) * multiplier + result
  return result
}

export function calculateTrendIndicators(
  inputBars: readonly KlineBar[],
  calculatedAt: string
): IndicatorValue[] {
  const bars = inputBars.slice(0, -1)
  const closes = bars.map((bar) => bar.close)
  const latest = closes.at(-1) ?? null
  const ma = (period: number) => sma(closes, period)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macd = ema12 !== null && ema26 !== null ? ema12 - ema26 : null
  const macdSeries = closes
    .map((_, index) => {
      const left = ema(closes.slice(0, index + 1), 12)
      const right = ema(closes.slice(0, index + 1), 26)
      return left !== null && right !== null ? left - right : null
    })
    .filter((value): value is number => value !== null)
  const signal = ema(macdSeries, 9)
  const histogram = macd !== null && signal !== null ? (macd - signal) * 2 : null
  const stateAgainst = (value: number | null) =>
    latest !== null && value !== null
      ? latest === value
        ? 'flat'
        : latest > value
          ? 'up'
          : 'down'
      : 'unknown'
  const volumeWindow = bars.slice(-20).map((bar) => bar.volume)
  const currentVolume = volumeWindow.at(-1) ?? null
  const volumePercentile =
    currentVolume !== null && volumeWindow.length === 20
      ? (volumeWindow.filter((volume) => volume <= currentVolume).length / volumeWindow.length) *
        100
      : null
  const turnoverWindow = bars
    .slice(-20)
    .flatMap((bar) => (bar.turnoverRate === undefined ? [] : [bar.turnoverRate]))
  const currentTurnover = turnoverWindow.at(-1) ?? null
  const turnoverPercentile =
    currentTurnover !== null && turnoverWindow.length === 20
      ? (turnoverWindow.filter((turnover) => turnover <= currentTurnover).length /
          turnoverWindow.length) *
        100
      : null

  return [
    indicator('ma5', 'MA5', ma(5), 'price', calculatedAt, '日K', stateAgainst(ma(5))),
    indicator('ma10', 'MA10', ma(10), 'price', calculatedAt, '日K', stateAgainst(ma(10))),
    indicator('ma20', 'MA20', ma(20), 'price', calculatedAt, '日K', stateAgainst(ma(20))),
    indicator('ma60', 'MA60', ma(60), 'price', calculatedAt, '日K', stateAgainst(ma(60))),
    indicator('ema12', 'EMA12', ema12, 'price', calculatedAt, '日K', stateAgainst(ema12)),
    indicator('ema26', 'EMA26', ema26, 'price', calculatedAt, '日K', stateAgainst(ema26)),
    indicator('macd', 'MACD', macd, 'price', calculatedAt, '日K', directionState(macd)),
    indicator(
      'macd-signal',
      'MACD 信号线',
      signal,
      'price',
      calculatedAt,
      '日K',
      directionState(signal)
    ),
    indicator(
      'macd-histogram',
      'MACD 柱',
      histogram,
      'price',
      calculatedAt,
      '日K',
      directionState(histogram)
    ),
    indicator(
      'daily-volume-percentile-20',
      '20日成交量分位',
      volumePercentile,
      'percent',
      calculatedAt,
      '日K',
      volumePercentile === null
        ? 'unknown'
        : volumePercentile > 50
          ? 'up'
          : volumePercentile < 50
            ? 'down'
            : 'flat'
    ),
    indicator(
      'daily-turnover-percentile-20',
      '20日换手率分位',
      turnoverPercentile,
      'percent',
      calculatedAt,
      '日K',
      turnoverPercentile === null
        ? 'unknown'
        : turnoverPercentile > 50
          ? 'up'
          : turnoverPercentile < 50
            ? 'down'
            : 'flat'
    )
  ]
}
