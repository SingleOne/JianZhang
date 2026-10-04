import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  withLedgerTradeRecords,
  type AppState,
  type TTradingAccount,
  type TTradeRecord,
  type StockQuote
} from '../shared/types'
import {
  createDefaultAccounts,
  normalizeAccountState,
  getStockAccountBook,
  upsertStockAccount
} from '../shared/stock-accounts'
import { calculatePortfolioLedgerPosition } from './portfolio-ledger'
import { calculatePortfolioPerformanceReport } from './portfolio-performance'
import { moveAccountLedgerEntry } from './stock-accounts'

function book(id: string, records: TTradeRecord[]): TTradingAccount {
  const account = withLedgerTradeRecords(
    {
      accountId: id,
      quoteId: '1.600000',
      code: '600000',
      name: '股票',
      market: 'CN',
      currency: 'CNY',
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    records
  )
  return { ...account, position: calculatePortfolioLedgerPosition(account, 'CN', 'CNY').position }
}
function trade(id: string, side: 'buy' | 'sell', price: number, date: string): TTradeRecord {
  return {
    id,
    accountId: id.startsWith('a') ? 'default:CN' : 'second',
    purpose: 'base',
    side,
    price,
    quantity: 100,
    tradedAt: date,
    market: 'CN',
    currency: 'CNY',
    exchangeRate: 1,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    note: ''
  }
}
function state(a: TTradingAccount, b: TTradingAccount): AppState {
  const owners = createDefaultAccounts()
  return normalizeAccountState({
    watchlist: [
      {
        quoteId: '1.600000',
        code: '600000',
        name: '股票',
        marketLabel: '沪A',
        showInTaskbar: true,
        isPriority: true,
        showRadarSignals: true
      }
    ],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    securitiesAccounts: {
      ...owners,
      second: { ...owners['default:CN'], id: 'second', name: '第二账户', isSystemDefault: false }
    },
    stockTradingBooks: {
      '1.600000': { quoteId: '1.600000', accounts: { 'default:CN': a, second: b } }
    },
    corporateActionApplications: {},
    portfolioSchemaVersion: 2
  })
}
const quote: StockQuote = {
  quoteId: '1.600000',
  code: '600000',
  name: '股票',
  latest: 30,
  change: 0,
  changePercent: 0,
  open: 30,
  high: 30,
  low: 30,
  previousClose: 30,
  volume: 0,
  amount: 0,
  turnoverRate: 0,
  updatedAt: '2026-03-03T10:00',
  currency: 'CNY'
}

describe('independent account ledgers', () => {
  it('adds realized and unrealized results independently and counts the security once', () => {
    const current = state(
      book('default:CN', [
        trade('a-buy', 'buy', 10, '2026-01-02T10:00'),
        trade('a-sell', 'sell', 30, '2026-03-02T10:00')
      ]),
      book('second', [trade('b-buy', 'buy', 20, '2026-01-02T10:00')])
    )
    const report = calculatePortfolioPerformanceReport(
      current.watchlist,
      [quote],
      current.stockTradingBooks,
      current.settings.exchangeRates
    )
    expect(report.stockRows[0].cumulative.stockCount).toBe(1)
    expect(report.stockRows[0].cumulative.cny.realizedProfit).toBe(2000)
    expect(report.stockRows[0].cumulative.cny.unrealizedProfit).toBe(1000)
    expect(report.stockRows[0].cumulative.cny.totalProfit).toBe(3000)
    expect(report.accountRows).toHaveLength(2)
  })

  it('moves one independent record atomically and keeps its saved fee', () => {
    const buy = {
      ...trade('a-buy', 'buy', 10, '2026-01-02T10:00'),
      fees: { commission: 5, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
    }
    const current = state(book('default:CN', [buy]), book('second', []))
    const moved = moveAccountLedgerEntry(current, '1.600000', 'default:CN', 'second', 'trade:a-buy')
    expect(
      getStockAccountBook(moved.stockTradingBooks, '1.600000', 'default:CN')?.position
    ).toBeUndefined()
    expect(
      getStockAccountBook(moved.stockTradingBooks, '1.600000', 'second')?.position?.quantity
    ).toBe(100)
    expect(
      getStockAccountBook(moved.stockTradingBooks, '1.600000', 'second')?.tradeRecords[0].fees
        .commission
    ).toBe(5)
    expect(
      getStockAccountBook(current.stockTradingBooks, '1.600000', 'default:CN')?.tradeRecords
    ).toHaveLength(1)
  })

  it('rejects a move that would leave a later sell without its source holdings', () => {
    const current = state(
      book('default:CN', [
        trade('a-buy', 'buy', 10, '2026-01-02T10:00'),
        trade('a-sell', 'sell', 30, '2026-03-02T10:00')
      ]),
      book('second', [])
    )
    expect(() =>
      moveAccountLedgerEntry(current, '1.600000', 'default:CN', 'second', 'trade:a-buy')
    ).toThrow('可卖数量不足')
    expect(
      getStockAccountBook(current.stockTradingBooks, '1.600000', 'default:CN')?.tradeRecords
    ).toHaveLength(2)
  })

  it('does not allow another account to fund a sell or an A share purchase to be sold the same day', () => {
    const current = state(
      book('default:CN', [trade('a-buy', 'buy', 10, '2026-01-02T10:00')]),
      book('second', [])
    )
    const empty = getStockAccountBook(current.stockTradingBooks, '1.600000', 'second')!
    const oversold = withLedgerTradeRecords(empty, [
      trade('b-sell', 'sell', 30, '2026-03-02T10:00')
    ])
    expect(calculatePortfolioLedgerPosition(oversold, 'CN', 'CNY').error).toContain('可卖数量不足')
    const sameDay = book('second', [
      trade('b-buy', 'buy', 10, '2026-01-02T10:00'),
      trade('b-sell', 'sell', 12, '2026-01-02T11:00')
    ])
    expect(calculatePortfolioLedgerPosition(sameDay, 'CN', 'CNY').error).toContain(
      '当日买入不能卖出'
    )
    expect(current.watchlist[0].position?.quantity).toBe(100)
    expect(() =>
      upsertStockAccount(current, { ...empty, accountId: 'default:HK' }, undefined)
    ).toThrow('该市场')
  })
})
