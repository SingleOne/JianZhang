import { describe, expect, it } from 'vitest'
import type { KlineBar } from '../../../../shared/types'
import { calculateShortTermTechnicalIndicators } from './technical'

const CALCULATED_AT = '2026-08-06T08:00:00.000Z'

function barsFromChanges(changes: readonly number[]): KlineBar[] {
  let close = 100
  return [0, ...changes].map((change, index) => {
    close += change
    return {
      time: `2026-07-${String(index + 1).padStart(2, '0')}`,
      open: close,
      close,
      high: close + 0.5,
      low: close - 0.5,
      volume: 10_000,
      amount: close * 1_000_000,
      turnoverRate: index === changes.length - 1 ? 2 : 1
    }
  })
}

function values(changes: readonly number[]) {
  return new Map(
    calculateShortTermTechnicalIndicators(barsFromChanges(changes), CALCULATED_AT).map((item) => [
      item.id,
      item
    ])
  )
}

describe('calculateShortTermTechnicalIndicators', () => {
  it('reports strong upward momentum from RSI14', () => {
    const result = values(Array.from({ length: 25 }, () => 1))

    expect(result.get('momentum-strength')).toMatchObject({
      value: 100,
      state: 'up',
      status: '上涨动量强，注意偏热'
    })
    expect(result.get('reversal-strength')).toMatchObject({
      value: 0,
      state: 'flat',
      status: '无明显反转'
    })
  })

  it('detects a fast upward turn inside weaker RSI14 momentum', () => {
    const result = values([
      ...Array.from({ length: 18 }, () => -1),
      ...Array.from({ length: 7 }, () => 0.3)
    ])

    expect(result.get('momentum-strength')?.value).toBeLessThan(0)
    expect(result.get('reversal-strength')?.value).toBeGreaterThan(40)
    expect(result.get('reversal-strength')).toMatchObject({
      state: 'up',
      status: '向上反转迹象较强'
    })
  })

  it('uses neutral direction colors for volatility and liquidity', () => {
    const result = values(Array.from({ length: 25 }, () => 0))

    expect(result.get('short-term-volatility-20')).toMatchObject({
      value: 0,
      state: 'flat',
      status: '低波动'
    })
    expect(result.get('liquidity-ratio-20')).toMatchObject({
      state: 'flat',
      status: '成交显著活跃'
    })
    expect(result.get('liquidity-ratio-20')?.value).toBeCloseTo(2 / 1.05)
  })
})
