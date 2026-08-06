import type { KlineBar } from '../../../../shared/types'
import type { IndicatorValue } from '../../shared/types'
import { indicator } from './shared'

export function calculateRsi(closes: readonly number[], period: number): number | null {
  if (closes.length <= period) return null
  let gains = 0
  let losses = 0
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1]
    if (change > 0) gains += change
    else losses -= change
  }
  if (losses === 0) return gains === 0 ? 50 : 100
  const relativeStrength = gains / losses
  return 100 - 100 / (1 + relativeStrength)
}

export function calculateMomentumIndicators(inputBars: readonly KlineBar[], calculatedAt: string): IndicatorValue[] {
  const bars = inputBars.slice(0, -1)
  const closes = bars.map((bar) => bar.close)
  let kValue = 50
  let dValue = 50
  let hasKdj = false
  for (let index = 8; index < bars.length; index += 1) {
    const window = bars.slice(index - 8, index + 1)
    const high = Math.max(...window.map((bar) => bar.high))
    const low = Math.min(...window.map((bar) => bar.low))
    const rsv = high === low ? 50 : (bars[index].close - low) / (high - low) * 100
    kValue = kValue * 2 / 3 + rsv / 3
    dValue = dValue * 2 / 3 + kValue / 3
    hasKdj = true
  }
  const k = hasKdj ? kValue : null
  const d = hasKdj ? dValue : null
  const j = k === null || d === null ? null : 3 * k - 2 * d
  const rsi6 = calculateRsi(closes, 6)
  const rsi14 = calculateRsi(closes, 14)
  return [
    indicator('rsi6', 'RSI6', rsi6, 'none', calculatedAt, '日K', rsi6 === null ? 'unknown' : rsi6 > 50 ? 'up' : rsi6 < 50 ? 'down' : 'flat'),
    indicator('rsi14', 'RSI14', rsi14, 'none', calculatedAt, '日K', rsi14 === null ? 'unknown' : rsi14 > 50 ? 'up' : rsi14 < 50 ? 'down' : 'flat'),
    indicator('kdj-k', 'KDJ K', k, 'none', calculatedAt, '日K', k === null ? 'unknown' : k > 50 ? 'up' : k < 50 ? 'down' : 'flat'),
    indicator('kdj-d', 'KDJ D', d, 'none', calculatedAt, '日K', d === null ? 'unknown' : d > 50 ? 'up' : d < 50 ? 'down' : 'flat'),
    indicator('kdj-j', 'KDJ J', j, 'none', calculatedAt, '日K', j === null ? 'unknown' : j > 50 ? 'up' : j < 50 ? 'down' : 'flat')
  ]
}
