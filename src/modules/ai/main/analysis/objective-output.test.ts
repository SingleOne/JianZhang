import { describe, expect, it } from 'vitest'
import { assertObjectiveAnalysisOutput } from './objective-output'

describe('objective AI analysis output validator', () => {
  it.each([
    '预计上涨',
    '有望反弹',
    '或将上涨',
    '股价将上涨',
    '预计股价\n上涨',
    '预计股价上行',
    '预计利润改善',
    '明日看涨',
    '短期有回调风险',
    '建议建仓',
    '适合做多',
    '模型估值 19.02 元',
    '合理股价为 19.02 元',
    '建议关注',
    '逢低布局',
    '操作价格区间 10—12 元'
  ])('rejects prohibited wording: %s', (text) => {
    expect(() => assertObjectiveAnalysisOutput({ summary: text })).toThrow(
      '包含预测、评级或投资建议措辞'
    )
  })

  it('checks each field independently', () => {
    expect(() =>
      assertObjectiveAnalysisOutput({ summary: '企业质量为', evidence: ['较高'] })
    ).not.toThrow()
  })
})
