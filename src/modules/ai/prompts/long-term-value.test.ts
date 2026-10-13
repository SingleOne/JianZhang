import { describe, expect, it } from 'vitest'
import { LONG_TERM_VALUE_PROMPT } from './long-term-value'

describe('long-term value prompt', () => {
  it('keeps DCF as an objective model result without ratings or timing', () => {
    expect(LONG_TERM_VALUE_PROMPT).toContain('valuation.dcf.available=true')
    expect(LONG_TERM_VALUE_PROMPT).toContain('priceToFairValuePercent')
    expect(LONG_TERM_VALUE_PROMPT).toContain('DCF/现价低于70%')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得自行重算或猜测 DCF')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得修改输入中的 DCF 假设')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得将 DCF 值表述为目标价')
    expect(LONG_TERM_VALUE_PROMPT).toContain('模型场景计算下限/上限')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得合并包装成建议价格区间')
    expect(LONG_TERM_VALUE_PROMPT).toContain('companyReportSummaries 为空时直接忽略')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不是财报原文')
    expect(LONG_TERM_VALUE_PROMPT).toContain('PCF/PE 剪刀差')
    expect(LONG_TERM_VALUE_PROMPT).toContain('persistent-gap')
    expect(LONG_TERM_VALUE_PROMPT).toContain('经营现金流不为正或金融企业时 PCF 不适用')
    expect(LONG_TERM_VALUE_PROMPT).toContain(
      '不得输出 conclusion、level、longTermValue、priceTiming'
    )
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得改写为高估、低估、便宜、昂贵或买卖时机')
  })
})
