import { describe, expect, it } from 'vitest'
import { MARKET_INTERPRETATION_PROMPT } from './market-interpretation'

describe('market interpretation prompt', () => {
  it('keeps the analysis at daily K-line scale and retains chip distribution', () => {
    expect(MARKET_INTERPRETATION_PROMPT).toContain('日 K 尺度')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('排除分时走势、VWAP、开盘区间、盘口、日内资金流和即时相对强弱')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不要仅因它们未提供就在 uncertainties 中列为数据缺失')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('chipDistribution 属于短期行情数据')
    expect(MARKET_INTERPRETATION_PROMPT).toContain('不得写成盘中盯盘或做 T 参考')
  })
})
