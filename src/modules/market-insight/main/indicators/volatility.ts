import type { KlineBar } from '../../../../shared/types'
import { calculateBollingerBands } from '../../../../shared/bollinger'
import type { IndicatorValue } from '../../shared/types'
import { indicator, standardDeviation } from './shared'

export function calculateVolatilityIndicators(inputBars: readonly KlineBar[], calculatedAt: string): IndicatorValue[] {
  const bars = inputBars.slice(0, -1)
  const closes = bars.map((bar) => bar.close)
  const bollinger = calculateBollingerBands(bars).at(-1)
  const middle = bollinger?.middle ?? null
  const upper = bollinger?.upper ?? null
  const lower = bollinger?.lower ?? null
  const bandwidth = middle !== null && upper !== null && lower !== null && middle !== 0 ? (upper - lower) / middle * 100 : null
  const last15 = bars.slice(-15)
  const atr = last15.length === 15
    ? last15.slice(1).reduce((total, bar, index) => {
        const previousClose = last15[index].close
        return total + Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose))
      }, 0) / 14
    : null
  const returns: number[] = []
  for (let index = Math.max(1, closes.length - 20); index < closes.length; index += 1) {
    if (closes[index - 1] !== 0) returns.push((closes[index] / closes[index - 1] - 1) * 100)
  }
  const realizedVolatility = returns.length === 20 ? (standardDeviation(returns) ?? 0) * Math.sqrt(252) : null
  return [
    indicator('bollinger-middle', '布林中轨', middle, 'price', calculatedAt, '日K'),
    indicator('bollinger-upper', '布林上轨', upper, 'price', calculatedAt, '日K'),
    indicator('bollinger-lower', '布林下轨', lower, 'price', calculatedAt, '日K'),
    indicator('bollinger-bandwidth', '布林带宽', bandwidth, 'percent', calculatedAt, '日K'),
    indicator('atr14', 'ATR14', atr, 'price', calculatedAt, '日K'),
    indicator('realized-volatility-20', '20日实现波动率', realizedVolatility, 'percent', calculatedAt, '日K')
  ]
}
