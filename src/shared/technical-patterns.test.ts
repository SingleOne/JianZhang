import { describe, expect, it } from 'vitest'
import type { KlineBar } from './types'
import {
  BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT,
  calculateBollingerBandwidthTrends,
  candlestickShadowSignals
} from './technical-patterns'

function bar(day: number, close: number, overrides: Partial<KlineBar> = {}): KlineBar {
  return {
    time: `2026-08-${String(day).padStart(2, '0')}`,
    open: close,
    close,
    high: close,
    low: close,
    volume: 100,
    amount: close * 100,
    ...overrides
  }
}

describe('technical patterns', () => {
  it('requires a shadow at least as long as the body and 40 percent of the full range', () => {
    expect(
      candlestickShadowSignals(
        bar(1, 11, {
          open: 10,
          high: 12,
          low: 9.5
        })
      )
    ).toEqual(['longUpperShadow'])
    expect(
      candlestickShadowSignals(
        bar(1, 11, {
          open: 10,
          high: 12,
          low: 8
        })
      )
    ).not.toContain('longUpperShadow')
  })

  it('recognizes upper and lower shadows independently on a doji', () => {
    expect(
      candlestickShadowSignals(
        bar(1, 10, {
          high: 11,
          low: 9
        })
      )
    ).toEqual(['longUpperShadow', 'longLowerShadow'])
  })

  it('requires four consecutive bandwidth moves and a 10 percent cumulative expansion', () => {
    const bars = [
      ...Array.from({ length: 19 }, (_, index) => bar(index + 1, 10)),
      bar(20, 9.9),
      bar(21, 10.5),
      bar(22, 11),
      bar(23, 11.5),
      bar(24, 12)
    ]
    const trend = calculateBollingerBandwidthTrends(bars).at(-1)

    expect(trend?.changePercent).toBeGreaterThan(BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT)
    expect(trend?.signal).toBe('bollingerExpansion')
    expect(calculateBollingerBandwidthTrends(bars.slice(1)).at(-1)?.signal).toBeNull()
  })

  it('requires four consecutive bandwidth moves for narrowing', () => {
    const bars = [
      bar(1, 12),
      bar(2, 11.5),
      bar(3, 11),
      bar(4, 10.5),
      ...Array.from({ length: 20 }, (_, index) => bar(index + 5, 10))
    ]
    const trend = calculateBollingerBandwidthTrends(bars).at(-1)

    expect(trend?.changePercent).toBeLessThan(-BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT)
    expect(trend?.signal).toBe('bollingerNarrowing')
  })
})
