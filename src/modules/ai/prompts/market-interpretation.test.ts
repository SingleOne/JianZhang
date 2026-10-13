import { describe, expect, it } from 'vitest'
import { MARKET_INTERPRETATION_PROMPT } from './market-interpretation'

describe('market interpretation prompt', () => {
  it('keeps the analysis objective and at daily K-line scale', () => {
    expect(MARKET_INTERPRETATION_PROMPT).toContain('日 K 尺度')
    expect(MARKET_INTERPRETATION_PROMPT).toContain(
      '排除分时走势、VWAP、开盘区间、盘口、日内资金流和即时相对强弱'
    )
    expect(MARKET_INTERPRETATION_PROMPT).toContain(
      '不要仅因它们未提供就在 uncertainties 中列为数据缺失'
    )
    expect(MARKET_INTERPRETATION_PROMPT).toContain('chipDistribution 是应用根据前复权日 K')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不得外推未来走势')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不得输出或暗示以下内容')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('对企业、股票、投资价值或技术形态')
  })
})
