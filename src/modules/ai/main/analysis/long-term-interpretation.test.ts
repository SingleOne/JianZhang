import { describe, expect, it } from 'vitest'
import { parseLongTermInterpretation } from './long-term-interpretation'

function completeResult() {
  return {
    summary: '经营质量稳定，价格仍偏弱。',
    sections: [
      { id: 'enterpriseQuality', conclusion: 'ROE保持稳定', evidence: [' 五年最低ROE 18% '] },
      { id: 'financialSafety', conclusion: '净负债较低', evidence: ['净负债 -80 亿元'] },
      { id: 'currentPrice', conclusion: '价格位于年度区间低位', evidence: ['250日位置 18%'] }
    ],
    conclusion: {
      longTermValue: { level: 'high', reason: '资本回报和现金质量较好' },
      priceTiming: { level: 'favorable', reason: '估值和价格位置均处于相对低位' }
    },
    risks: ['自由现金流波动'],
    uncertainties: ['缺少金融行业专用指标']
  }
}

describe('long-term AI interpretation validator', () => {
  it('keeps the fixed four-part structure and trims evidence', () => {
    const result = parseLongTermInterpretation(
      JSON.stringify(completeResult()),
      '2026-08-05T15:00:00+08:00'
    )

    expect(result.summary).toBe('经营质量稳定，价格仍偏弱。')
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0].evidence).toEqual(['五年最低ROE 18%'])
    expect(result.conclusion.longTermValue.level).toBe('high')
    expect(result.conclusion.priceTiming.level).toBe('favorable')
    expect(result.generatedAt).toBe('2026-08-05T15:00:00+08:00')
  })

  it('accepts sections keyed by the required ids', () => {
    const payload = completeResult()
    const sections = Object.fromEntries(payload.sections.map(({ id, ...section }) => [id, section]))

    const result = parseLongTermInterpretation(
      JSON.stringify({ ...payload, sections }),
      '2026-08-05T15:00:00+08:00'
    )

    expect(result.sections.map((section) => section.id)).toEqual([
      'enterpriseQuality',
      'financialSafety',
      'currentPrice'
    ])
    expect(result.sections[0].conclusion).toBe('ROE保持稳定')
  })

  it('rejects output missing a fixed analysis section', () => {
    const payload = completeResult()
    payload.sections.pop()
    expect(() =>
      parseLongTermInterpretation(JSON.stringify(payload), '2026-08-05T15:00:00+08:00')
    ).toThrow('缺少企业质量、财务安全或当前价格')
  })

  it('rejects output without separate value and timing conclusions', () => {
    const payload = completeResult()
    payload.conclusion.priceTiming.level = 'invented'
    expect(() =>
      parseLongTermInterpretation(JSON.stringify(payload), '2026-08-05T15:00:00+08:00')
    ).toThrow('缺少长期价值或当前时机结论')
  })
})
