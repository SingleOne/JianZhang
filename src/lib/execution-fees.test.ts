import { describe, expect, it } from 'vitest'
import { allocateExecutionFees } from './execution-fees'
import { totalRecordedTradeFees } from './t-trading'

describe('whole execution cent allocation', () => {
  it('allocates a one yuan execution as 0.77 and 0.23 for 1000 and 300 shares', () => {
    const fees = {
      commission: 0.42,
      handling: 0.31,
      regulatory: 0.18,
      transfer: 0.09,
      stampDuty: 0
    }
    const parts = allocateExecutionFees(fees, undefined, [1000, 300])
    expect(parts.map(totalRecordedTradeFees)).toEqual([0.77, 0.23])
    for (const key of Object.keys(fees) as (keyof typeof fees)[]) {
      expect(Math.round(parts.reduce((sum, part) => sum + part.fees[key], 0) * 100)).toBe(
        Math.round(fees[key] * 100)
      )
    }
  })
  it('conserves each fee and never creates negative cents with three batches and tiny fee items', () => {
    const fees = {
      commission: 0.01,
      handling: 0.01,
      regulatory: 0.02,
      transfer: 0.01,
      stampDuty: 0.03
    }
    const items = [{ code: 'manual' as const, label: '实际费用', amount: 0.02 }]
    const parts = allocateExecutionFees(fees, items, [100, 100, 100])
    expect(parts.map(totalRecordedTradeFees)).toEqual([0.03, 0.04, 0.03])
    for (const key of Object.keys(fees) as (keyof typeof fees)[]) {
      expect(parts.every((part) => part.fees[key] >= 0)).toBe(true)
      expect(Math.round(parts.reduce((sum, part) => sum + part.fees[key], 0) * 100)).toBe(
        Math.round(fees[key] * 100)
      )
    }
    expect(Math.round(parts.reduce((sum, part) => sum + part.feeItems![0].amount, 0) * 100)).toBe(2)
  })
})
