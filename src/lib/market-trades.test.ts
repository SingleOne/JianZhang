import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKET_TRADE_FEE_SETTINGS,
  DEFAULT_TRADING_CALENDAR_SETTINGS,
  type TTradeRecord
} from '../shared/types'
import {
  calculateMarketLedgerMetrics,
  calculateMarketTradeFeeItems,
  estimateSettlementDate,
  marketTradeQuantityError,
  totalTradeFeeItems
} from './market-trades'

function record(changes: Partial<TTradeRecord>): TTradeRecord {
  return {
    id: crypto.randomUUID(),
    side: 'buy',
    purpose: 'base',
    tradedAt: '2026-08-24T10:00',
    price: 100,
    quantity: 10,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    market: 'US',
    currency: 'USD',
    marketDate: '2026-08-24',
    exchangeRate: 7,
    exchangeRateDate: '2026-08-24',
    note: '',
    ...changes
  }
}

describe('market trade rules', () => {
  it('calculates the current Hong Kong fee template', () => {
    const items = calculateMarketTradeFeeItems(
      'HK',
      10_000,
      100,
      'buy',
      DEFAULT_MARKET_TRADE_FEE_SETTINGS
    )
    expect(totalTradeFeeItems(items)).toBe(10.86)
    expect(items.find((item) => item.code === 'stamp-duty')?.amount).toBe(10)
  })

  it('applies US regulatory fees only to sells', () => {
    const buy = calculateMarketTradeFeeItems(
      'US',
      100_000,
      1_000,
      'buy',
      DEFAULT_MARKET_TRADE_FEE_SETTINGS
    )
    const sell = calculateMarketTradeFeeItems(
      'US',
      100_000,
      1_000,
      'sell',
      DEFAULT_MARKET_TRADE_FEE_SETTINGS
    )
    expect(totalTradeFeeItems(buy)).toBe(0)
    expect(totalTradeFeeItems(sell)).toBe(2.26)
  })

  it('calculates settlement dates from each market calendar', () => {
    expect(estimateSettlementDate('US', '2026-08-24', DEFAULT_TRADING_CALENDAR_SETTINGS)).toBe(
      '2026-08-25'
    )
    expect(estimateSettlementDate('HK', '2026-08-24', DEFAULT_TRADING_CALENDAR_SETTINGS)).toBe(
      '2026-08-26'
    )
  })

  it('uses market-specific quantity validation', () => {
    expect(marketTradeQuantityError('CN', 1)).toBeTruthy()
    expect(marketTradeQuantityError('HK', 1)).toBeUndefined()
    expect(marketTradeQuantityError('US', 1)).toBeUndefined()
  })
})

describe('market trade ledger', () => {
  it('calculates moving-average position and realized profit in native and CNY currency', () => {
    const records = [
      record({ id: 'buy', price: 100, quantity: 10, exchangeRate: 7 }),
      record({
        id: 'sell',
        side: 'sell',
        tradedAt: '2026-08-25T10:00',
        marketDate: '2026-08-25',
        price: 120,
        quantity: 4,
        exchangeRate: 7.1
      })
    ]
    const metrics = calculateMarketLedgerMetrics(records, 'US', 'USD')
    expect(metrics.position?.quantity).toBe(6)
    expect(metrics.position?.cost).toBe(100)
    expect(metrics.realizedProfit).toBe(80)
    expect(metrics.realizedProfitCny).toBe(608)
  })

  it('rejects a sell that exceeds ledger holdings', () => {
    const metrics = calculateMarketLedgerMetrics(
      [record({ side: 'sell', quantity: 1 })],
      'US',
      'USD'
    )
    expect(metrics.error).toContain('可用持仓')
  })
})
