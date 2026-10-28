import { describe, expect, it } from 'vitest'
import { LONG_TERM_VALUE_PROMPT } from './long-term-value'

describe('long-term value prompt', () => {
  it('allows only parameter-bound DCF ranges without ratings or timing', () => {
    expect(LONG_TERM_VALUE_PROMPT).toContain('绝对禁止给出单一、绝对、确定性的合理股价')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得输出 valuation.dcf.fairValuePerShare')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得自行重算或猜测 DCF')
    expect(LONG_TERM_VALUE_PROMPT).toContain('模型输入不包含 valuation.strictDcf')
    expect(LONG_TERM_VALUE_PROMPT).toContain('应用程序会在模型调用之外读取严格 DCF')
    expect(LONG_TERM_VALUE_PROMPT).toContain('该句不由你生成或改写')
    expect(LONG_TERM_VALUE_PROMPT).toContain('在假设折现率X%、未来增长率Y%')
    expect(LONG_TERM_VALUE_PROMPT).toContain('数学区间约为[最小值]元至[最大值]元')
    expect(LONG_TERM_VALUE_PROMPT).toContain('模型计算值不代表对该股票的未来实际定价或投资建议')
    expect(LONG_TERM_VALUE_PROMPT).toContain('为空时直接忽略，不得据此作负面判断')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不是财报原文')
    expect(LONG_TERM_VALUE_PROMPT).toContain(
      '不得输出 conclusion、level、longTermValue、priceTiming'
    )
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得改写为“高估”“低估”“便宜”“昂贵”')
  })

  it('requires readable Chinese in evidence and limitations while preserving JSON keys', () => {
    expect(LONG_TERM_VALUE_PROMPT).toContain(
      'summary、observation、每条 evidence、riskFacts 和 uncertainties'
    )
    expect(LONG_TERM_VALUE_PROMPT).toContain(
      '不得直接复制内部字段名、JSON 路径、数组下标或英文枚举值'
    )
    expect(LONG_TERM_VALUE_PROMPT).toContain('JSON 结构的键名和 sections 的 id 仍严格遵守')
    expect(LONG_TERM_VALUE_PROMPT).toContain('报告期＋中文指标名＋数值＋单位')
    expect(LONG_TERM_VALUE_PROMPT).toContain('"parentNetProfit":"归母净利润"')
    expect(LONG_TERM_VALUE_PROMPT).toContain('roeRange 是百分点')
    expect(LONG_TERM_VALUE_PROMPT).toContain('并不表示连续年数')
  })
})
