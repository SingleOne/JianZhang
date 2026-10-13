import { describe, expect, it } from 'vitest'
import { parseLongTermInterpretation } from './long-term-interpretation'

function completeResult() {
  return {
    summary: '数据覆盖五个完整年度，以下内容仅说明历史指标与模型计算结果。',
    sections: [
      {
        id: 'operatingMetrics',
        observation: 'ROE 在五个报告年度间保持连续',
        evidence: [' 五年最低 ROE 18% ']
      },
      {
        id: 'financialStructure',
        observation: '报告期净负债为负值',
        evidence: ['净负债 -80 亿元']
      },
      {
        id: 'valuationMetrics',
        observation: '当前价格位于 250 日历史区间的 18% 位置',
        evidence: ['250 日位置 18%']
      }
    ],
    riskFacts: ['最近两个年度自由现金流数值方向不同'],
    uncertainties: ['缺少金融行业专用指标']
  }
}

describe('long-term AI interpretation validator', () => {
  it('keeps the fixed objective sections and trims evidence', () => {
    const result = parseLongTermInterpretation(
      JSON.stringify(completeResult()),
      '2026-10-13T15:00:00+08:00'
    )

    expect(result.schemaVersion).toBe(2)
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0].evidence).toEqual(['五年最低 ROE 18%'])
    expect(result.sections[0].observation).toBe('ROE 在五个报告年度间保持连续')
    expect(result.generatedAt).toBe('2026-10-13T15:00:00+08:00')
  })

  it('accepts sections keyed by the required ids', () => {
    const payload = completeResult()
    const sections = Object.fromEntries(payload.sections.map(({ id, ...section }) => [id, section]))

    const result = parseLongTermInterpretation(
      JSON.stringify({ ...payload, sections }),
      '2026-10-13T15:00:00+08:00'
    )

    expect(result.sections.map((section) => section.id)).toEqual([
      'operatingMetrics',
      'financialStructure',
      'valuationMetrics'
    ])
  })

  it('rejects output missing a fixed metric section', () => {
    const payload = completeResult()
    payload.sections.pop()
    expect(() =>
      parseLongTermInterpretation(JSON.stringify(payload), '2026-10-13T15:00:00+08:00')
    ).toThrow('缺少经营、财务结构或估值指标')
  })

  it('rejects investment timing language', () => {
    const payload = completeResult()
    payload.summary = '当前买入时机有利。'
    expect(() =>
      parseLongTermInterpretation(JSON.stringify(payload), '2026-10-13T15:00:00+08:00')
    ).toThrow('包含预测、评级或投资建议措辞')
  })
})
