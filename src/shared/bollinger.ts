import type { KlineBar } from './types'

export const BOLLINGER_PERIOD = 20
export const BOLLINGER_MULTIPLIER = 2

export interface BollingerBandPoint {
  time: string
  upper: number
  middle: number
  lower: number
}

export function calculateBollingerBands(
  bars: readonly KlineBar[],
  period = BOLLINGER_PERIOD,
  multiplier = BOLLINGER_MULTIPLIER
): BollingerBandPoint[] {
  if (bars.length < period) return []

  const points: BollingerBandPoint[] = []
  let sum = 0
  let squaredSum = 0

  for (let index = 0; index < bars.length; index += 1) {
    const close = bars[index].close
    sum += close
    squaredSum += close * close

    if (index >= period) {
      const expiredClose = bars[index - period].close
      sum -= expiredClose
      squaredSum -= expiredClose * expiredClose
    }

    if (index < period - 1) continue

    const middle = sum / period
    const variance = Math.max(0, squaredSum / period - middle * middle)
    const deviation = Math.sqrt(variance) * multiplier
    points.push({
      time: bars[index].time,
      upper: middle + deviation,
      middle,
      lower: middle - deviation
    })
  }

  return points
}
