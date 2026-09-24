import { describe, expect, it } from 'vitest'
import { tPlanTradablePrice } from './t-plan-prices'

describe('Hong Kong T plan prices', () => {
  it('snaps buy down and sell up across the phase 2 stock spread boundary', () => {
    const stock = { market: 'HK' as const, instrumentType: 'stock' as const }
    expect(tPlanTradablePrice(0.2501, 'buy', stock)).toBe(0.25)
    expect(tPlanTradablePrice(0.2501, 'sell', stock)).toBe(0.255)
    expect(tPlanTradablePrice(10.001, 'buy', stock)).toBe(10)
    expect(tPlanTradablePrice(10.001, 'sell', stock)).toBe(10.01)
  })

  it('uses the ETP spread table for ETFs', () => {
    const etf = { market: 'HK' as const, instrumentType: 'etf' as const }
    expect(tPlanTradablePrice(0.251, 'buy', etf)).toBe(0.25)
    expect(tPlanTradablePrice(0.251, 'sell', etf)).toBe(0.255)
    expect(tPlanTradablePrice(0.501, 'buy', etf)).toBe(0.5)
    expect(tPlanTradablePrice(0.501, 'sell', etf)).toBe(0.51)
    expect(tPlanTradablePrice(1.001, 'buy', etf)).toBe(1)
    expect(tPlanTradablePrice(1.001, 'sell', etf)).toBe(1.002)
    expect(tPlanTradablePrice(7001, 'buy', etf)).toBe(7000)
    expect(tPlanTradablePrice(7001, 'sell', etf)).toBe(7005)
  })

  it('leaves US prices unchanged and does not invent a Hong Kong price outside the table', () => {
    expect(tPlanTradablePrice(10.001, 'buy', { market: 'US' })).toBe(10.001)
    expect(tPlanTradablePrice(0, 'buy', { market: 'US' })).toBeNull()
    expect(tPlanTradablePrice(-1, 'buy', { market: 'US' })).toBeNull()
    expect(tPlanTradablePrice(0.009, 'sell', { market: 'HK' })).toBeNull()
    expect(tPlanTradablePrice(10_000, 'sell', { market: 'HK' })).toBeNull()
  })
})
