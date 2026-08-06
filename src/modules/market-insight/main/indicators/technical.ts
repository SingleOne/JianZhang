import type { KlineBar } from '../../../../shared/types'
import type { IndicatorState, IndicatorValue } from '../../shared/types'
import { calculateRsi } from './momentum'
import { average, standardDeviation } from './shared'

function clampScore(value: number): number {
  return Math.max(-100, Math.min(100, value))
}

function scoreState(value: number | null): IndicatorState {
  if (value === null) return 'unknown'
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

function momentumStatus(value: number | null): string {
  if (value === null) return '数据不足'
  if (value >= 40) return '上涨动量强，注意偏热'
  if (value >= 10) return '上涨动量偏强'
  if (value > -10) return '多空动量均衡'
  if (value > -40) return '下跌动量偏强'
  return '下跌动量强，注意超跌'
}

function reversalStatus(value: number | null): string {
  if (value === null) return '数据不足'
  if (value >= 40) return '向上反转迹象较强'
  if (value >= 15) return '出现向上反转迹象'
  if (value <= -40) return '向下反转迹象较强'
  if (value <= -15) return '出现向下反转迹象'
  return '无明显反转'
}

function volatilityStatus(value: number | null): string {
  if (value === null) return '数据不足'
  if (value <= 20) return '低波动'
  if (value <= 35) return '波动适中'
  if (value <= 50) return '波动偏高'
  return '高波动'
}

function liquidityStatus(value: number | null): string {
  if (value === null) return '数据不足'
  if (value < 0.6) return '成交清淡'
  if (value < 0.85) return '成交偏清淡'
  if (value <= 1.2) return '活跃度正常'
  if (value <= 1.6) return '成交活跃'
  return '成交显著活跃'
}

function metric(
  id: string,
  label: string,
  value: number | null,
  unit: IndicatorValue['unit'],
  state: IndicatorState,
  status: string,
  calculatedAt: string,
  sourcePeriod: string
): IndicatorValue {
  return { id, label, value, unit, state, status, calculatedAt, sourcePeriod }
}

export function calculateShortTermTechnicalIndicators(
  inputBars: readonly KlineBar[],
  calculatedAt: string
): IndicatorValue[] {
  const bars = inputBars.slice(0, -1)
  const closes = bars.map((bar) => bar.close)
  const rsi6 = calculateRsi(closes, 6)
  const rsi14 = calculateRsi(closes, 14)
  const momentum = rsi14 === null ? null : clampScore((rsi14 - 50) * 2)
  const reversal = rsi6 === null || rsi14 === null
    ? null
    : (rsi14 < 50 && rsi6 > rsi14) || (rsi14 > 50 && rsi6 < rsi14)
      ? clampScore((rsi6 - rsi14) * 4)
      : 0

  const returns: number[] = []
  for (let index = Math.max(1, closes.length - 20); index < closes.length; index += 1) {
    if (closes[index - 1] !== 0) returns.push((closes[index] / closes[index - 1] - 1) * 100)
  }
  const volatility = returns.length === 20
    ? (standardDeviation(returns) ?? 0) * Math.sqrt(252)
    : null

  const turnoverWindow = bars.slice(-20).flatMap((bar) => (
    bar.turnoverRate === undefined ? [] : [bar.turnoverRate]
  ))
  const currentTurnover = turnoverWindow.at(-1) ?? null
  const averageTurnover = turnoverWindow.length === 20 ? average(turnoverWindow) : null
  const liquidity = currentTurnover !== null && averageTurnover !== null && averageTurnover > 0
    ? currentTurnover / averageTurnover
    : null

  return [
    metric(
      'momentum-strength',
      '动量',
      momentum,
      'none',
      scoreState(momentum),
      momentumStatus(momentum),
      calculatedAt,
      'RSI14'
    ),
    metric(
      'reversal-strength',
      '反转',
      reversal,
      'none',
      scoreState(reversal),
      reversalStatus(reversal),
      calculatedAt,
      'RSI6 / RSI14'
    ),
    metric(
      'short-term-volatility-20',
      '低波动',
      volatility,
      'percent',
      volatility === null ? 'unknown' : 'flat',
      volatilityStatus(volatility),
      calculatedAt,
      '20日日K'
    ),
    metric(
      'liquidity-ratio-20',
      '流动性',
      liquidity,
      'ratio',
      liquidity === null ? 'unknown' : 'flat',
      liquidityStatus(liquidity),
      calculatedAt,
      '20日日K'
    )
  ]
}
