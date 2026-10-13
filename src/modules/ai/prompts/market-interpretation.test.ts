import { describe, expect, it } from 'vitest'
import { MARKET_INTERPRETATION_PROMPT } from './market-interpretation'

describe('market interpretation prompt', () => {
  it('keeps the analysis objective, historical scope and fixed risk notice', () => {
    expect(MARKET_INTERPRETATION_PROMPT).toContain('日 K 尺度')
    expect(MARKET_INTERPRETATION_PROMPT).toContain(
      '排除分时走势、VWAP、开盘区间、盘口、日内资金流和即时相对强弱'
    )
    expect(MARKET_INTERPRETATION_PROMPT).toContain(
      '不要仅因它们未提供就在 uncertainties 中列为数据缺失'
    )
    expect(MARKET_INTERPRETATION_PROMPT).toContain('chipDistribution 是应用根据前复权日 K')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不得外推未来走势')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('绝对禁止对未来的股价走势进行任何预测')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不得补充外部行情、新闻、公告')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('对企业、股票、投资价值或技术形态')
    expect(MARKET_INTERPRETATION_PROMPT).toContain(
      '历史技术指标存在严重的滞后性，量价特征仅代表过去'
    )
  })
})
