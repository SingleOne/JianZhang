import type { KlineBar } from './types'

export const MOVING_AVERAGE_PERIODS = [5, 10, 20, 60] as const

export type MovingAveragePeriod = (typeof MOVING_AVERAGE_PERIODS)[number]
export type MovingAverageValues = Partial<Record<MovingAveragePeriod, number>>

export interface MovingAveragePoint {
  time: string
  values: MovingAverageValues
}

export function calculateMovingAverages(bars: readonly KlineBar[]): MovingAveragePoint[] {
  const sums: Record<MovingAveragePeriod, number> = {
    5: 0,
    10: 0,
    20: 0,
    60: 0
  }

  return bars.map((bar, index) => {
    const values: MovingAverageValues = {}

    for (const period of MOVING_AVERAGE_PERIODS) {
      sums[period] += bar.close
      if (index >= period) sums[period] -= bars[index - period].close
      if (index >= period - 1) values[period] = sums[period] / period
    }

    return { time: bar.time, values }
  })
}
