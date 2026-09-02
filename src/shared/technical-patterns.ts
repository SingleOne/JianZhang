import { calculateBollingerBands, type BollingerBandPoint } from './bollinger'
import type { KlineBar, TechnicalPatternSignalType } from './types'

export const LONG_SHADOW_BODY_MULTIPLIER = 1
export const LONG_SHADOW_RANGE_RATIO = 0.4
export const BOLLINGER_TREND_SESSIONS = 4
export const BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT = 10

export const TECHNICAL_PATTERN_SIGNAL_LABELS: Record<TechnicalPatternSignalType, string> = {
  longUpperShadow: '长上影线',
  longLowerShadow: '长下影线',
  bollingerNarrowing: '布林带收窄',
  bollingerExpansion: '布林带扩张'
}

export interface BollingerBandwidthTrendPoint {
  time: string
  bandwidth: number
  changePercent: number | null
  signal: Extract<TechnicalPatternSignalType, 'bollingerNarrowing' | 'bollingerExpansion'> | null
}

export function candlestickShadowSignals(bar: KlineBar): TechnicalPatternSignalType[] {
  const body = Math.abs(bar.close - bar.open)
  const range = bar.high - bar.low
  if (range <= 0) return []

  const upperShadow = bar.high - Math.max(bar.open, bar.close)
  const lowerShadow = Math.min(bar.open, bar.close) - bar.low
  const signals: TechnicalPatternSignalType[] = []
  if (
    upperShadow > 0 &&
    upperShadow >= body * LONG_SHADOW_BODY_MULTIPLIER &&
    upperShadow / range >= LONG_SHADOW_RANGE_RATIO
  ) {
    signals.push('longUpperShadow')
  }
  if (
    lowerShadow > 0 &&
    lowerShadow >= body * LONG_SHADOW_BODY_MULTIPLIER &&
    lowerShadow / range >= LONG_SHADOW_RANGE_RATIO
  ) {
    signals.push('longLowerShadow')
  }
  return signals
}

function bollingerBandwidth(point: BollingerBandPoint): number | null {
  return point.middle === 0 ? null : (point.upper - point.lower) / Math.abs(point.middle)
}

export function calculateBollingerBandwidthTrends(
  bars: readonly KlineBar[]
): BollingerBandwidthTrendPoint[] {
  const bands = calculateBollingerBands(bars)
  const bandwidths = bands.map(bollingerBandwidth)

  return bands.flatMap((point, index): BollingerBandwidthTrendPoint[] => {
    const bandwidth = bandwidths[index]
    if (bandwidth === null) return []

    const startIndex = index - BOLLINGER_TREND_SESSIONS
    const startBandwidth = bandwidths[startIndex]
    if (startIndex < 0 || startBandwidth === null || startBandwidth === 0) {
      return [{ time: point.time, bandwidth, changePercent: null, signal: null }]
    }

    let expanding = true
    let narrowing = true
    for (let currentIndex = startIndex + 1; currentIndex <= index; currentIndex += 1) {
      const previous = bandwidths[currentIndex - 1]
      const current = bandwidths[currentIndex]
      if (previous === null || current === null) {
        expanding = false
        narrowing = false
        break
      }
      expanding &&= current > previous
      narrowing &&= current < previous
    }

    const changePercent = (bandwidth / startBandwidth - 1) * 100
    const signal =
      expanding && changePercent >= BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT
        ? 'bollingerExpansion'
        : narrowing && changePercent <= -BOLLINGER_TREND_MINIMUM_CHANGE_PERCENT
          ? 'bollingerNarrowing'
          : null
    return [{ time: point.time, bandwidth, changePercent, signal }]
  })
}
