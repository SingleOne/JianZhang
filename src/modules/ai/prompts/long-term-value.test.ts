import { describe, expect, it } from 'vitest'
import { LONG_TERM_VALUE_PROMPT } from './long-term-value'

describe('long-term value prompt', () => {
  it('requires the model to use the application DCF without recalculating it', () => {
    expect(LONG_TERM_VALUE_PROMPT).toContain('valuation.dcf.available=true')
    expect(LONG_TERM_VALUE_PROMPT).toContain('priceToFairValuePercent')
    expect(LONG_TERM_VALUE_PROMPT).toContain('DCF/现价低于70%')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得自行重算或猜测 DCF')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不得修改输入中的 DCF 假设')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不是目标价')
    expect(LONG_TERM_VALUE_PROMPT).toContain('companyReportSummaries 为空时直接忽略')
    expect(LONG_TERM_VALUE_PROMPT).toContain('不是财报原文')
    expect(LONG_TERM_VALUE_PROMPT).toContain('PCF/PE 剪刀差')
    expect(LONG_TERM_VALUE_PROMPT).toContain('persistent-gap')
    expect(LONG_TERM_VALUE_PROMPT).toContain('经营现金流不为正或金融企业时 PCF 不适用')
  })
})
