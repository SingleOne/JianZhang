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
    expect(LONG_TERM_VALUE_PROMPT).toContain('companyReportSummaries 为空时直接忽略')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不是财报原文')
    expect(LONG_TERM_VALUE_PROMPT).toContain(
      '不得输出 conclusion、level、longTermValue、priceTiming'
    )
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得改写为“高估”“低估”“便宜”“昂贵”')
  })
})
