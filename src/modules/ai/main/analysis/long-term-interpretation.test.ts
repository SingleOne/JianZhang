import { describe, expect, it } from 'vitest'
import { parseLongTermInterpretation } from './long-term-interpretation'

describe('long-term AI interpretation validator', () => {
  it('keeps supported dimensions and trims textual evidence', () => {
    const result = parseLongTermInterpretation(JSON.stringify({
      summary: ' 经营质量稳定，价格仍偏弱。 ',
      dimensions: [
        { id: 'businessQuality', conclusion: 'ROE保持稳定', evidence: [' 五年最低ROE 18% '] },
        { id: 'priceTiming', conclusion: '价格位于年度区间低位', evidence: ['250日位置 18%'] },
        { id: 'invented', conclusion: '无效维度', evidence: [] }
      ],
      risks: ['自由现金流波动'],
      uncertainties: ['缺少行业估值分位']
    }), '2026-08-05T15:00:00+08:00')

    expect(result.summary).toBe('经营质量稳定，价格仍偏弱。')
    expect(result.dimensions).toHaveLength(2)
    expect(result.dimensions[0].evidence).toEqual(['五年最低ROE 18%'])
    expect(result.generatedAt).toBe('2026-08-05T15:00:00+08:00')
  })

  it('rejects output without a supported analysis dimension', () => {
    expect(() => parseLongTermInterpretation(JSON.stringify({
      summary: '摘要',
      dimensions: [{ id: 'invented', conclusion: '无效维度' }]
    }), '2026-08-05T15:00:00+08:00')).toThrow('缺少有效维度')
  })
})
