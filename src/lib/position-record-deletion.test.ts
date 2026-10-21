import { describe, expect, it } from 'vitest'
import type {
  StockTradingBook,
  TTradingAccount,
  TTradingBatch,
  TTradeRecord
} from '../shared/types'
import { DEFAULT_T_PLAN_SETTINGS, withLedgerTradeRecords } from '../shared/types'
import { appendPositionAdjustment } from './position-ledger'
import { previewStockPositionRecordDeletion } from './position-record-deletion'

const QUOTE_ID = '0.000625'

function trade(
  id: string,
  accountId: string,
  side: 'buy' | 'sell',
  quantity: number,
  tradedAt: string,
  batchId?: string
): TTradeRecord {
  return {
    id,
    accountId,
    side,
    quantity,
    price: 7,
    tradedAt,
    purpose: batchId ? 't' : 'base',
    batchId,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    market: 'CN',
    currency: 'CNY',
    exchangeRate: 1,
    note: ''
  }
}

function account(id: string, trades: TTradeRecord[]): TTradingAccount {
  return withLedgerTradeRecords(
    {
      accountId: id,
      accountName: id,
      quoteId: QUOTE_ID,
      code: '000625',
      name: '长安汽车',
      market: 'CN',
      currency: 'CNY',
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    trades
  )
}

function batch(id = 'reverse', sequence = 3): TTradingBatch {
  return {
    id,
    sequence,
    direction: 'reverse',
    openedAt: '2026-09-09T09:44',
    sellLevels: [],
    settlement: {
      settledAt: '2026-10-14T13:37',
      latestPositionQuantity: 1500,
      ledgerProfit: 0,
      finalProfit: 0,
      source: 'ledger',
      note: ''
    }
  }
}

function fixture(): StockTradingBook {
  const first = account('first', [
    trade('base-first', 'first', 'buy', 1000, '2026-07-16T10:07'),
    trade('reverse-sell', 'first', 'sell', 900, '2026-09-09T09:44', 'reverse'),
    trade('reverse-buy-first', 'first', 'buy', 600, '2026-09-11T10:30', 'reverse')
  ])
  const position = {
    quantity: 1000,
    cost: 7,
    openedOn: '2026-07-16',
    openedToday: false,
    currency: 'CNY' as const,
    costExchangeRate: 1
  }
  return {
    quoteId: QUOTE_ID,
    accounts: {
      first: appendPositionAdjustment(
        first,
        position,
        { ...position, cost: 7.44 },
        '2026-09-07T10:51',
        '2026-09-07T02:51:00Z',
        true,
        '修改持仓',
        'target'
      ),
      second: account('second', [
        trade('base-second', 'second', 'buy', 500, '2026-10-14T13:36'),
        trade('reverse-buy-second-a', 'second', 'buy', 200, '2026-10-08T15:11', 'reverse'),
        trade('reverse-buy-second-b', 'second', 'buy', 100, '2026-10-14T13:36', 'reverse')
      ]),
      unrelated: account('unrelated', [
        trade('unrelated-buy', 'unrelated', 'buy', 100, '2026-10-15T10:00')
      ])
    },
    tBatches: [batch()]
  }
}

describe('stock position record deletion', () => {
  it('previews and removes cross-account reverse-T buybacks together, preserving unrelated trades', () => {
    const book = fixture()
    const before = structuredClone(book)
    const result = previewStockPositionRecordDeletion(
      book,
      'first',
      'target',
      DEFAULT_T_PLAN_SETTINGS
    )!

    expect(result.entryCount).toBe(5)
    expect(result.accounts).toMatchObject([
      { accountId: 'first', buyQuantity: 600, sellQuantity: 900 },
      { accountId: 'second', buyQuantity: 300, sellQuantity: 0 }
    ])
    expect(result.batches.map((item) => item.sequence)).toEqual([3])
    expect(result.nextBook.tBatches).toEqual([])
    expect(result.nextBook.accounts.first.position?.quantity).toBe(1000)
    expect(result.nextBook.accounts.second.position?.quantity).toBe(500)
    expect(result.nextBook.accounts.second.tradeRecords.map((item) => item.id)).toEqual([
      'base-second'
    ])
    expect(result.nextBook.accounts.unrelated).toBe(book.accounts.unrelated)
    expect(book).toEqual(before)
  })

  it('includes earlier trades when the target is inside a settled batch', () => {
    const book = fixture()
    book.accounts.first = withLedgerTradeRecords(book.accounts.first, [
      ...book.accounts.first.tradeRecords,
      trade('early-sell', 'first', 'sell', 100, '2026-09-01T10:00', 'early'),
      trade('late-buy', 'first', 'buy', 100, '2026-09-08T10:00', 'early')
    ])
    book.tBatches!.push(batch('early', 2))
    const result = previewStockPositionRecordDeletion(
      book,
      'first',
      'target',
      DEFAULT_T_PLAN_SETTINGS
    )!

    expect(result.accounts[0].entries.map((entry) => entry.id)).toContain('trade:early-sell')
    expect(result.nextBook.accounts.first.tradeRecords.map((item) => item.id)).toEqual([
      'base-first'
    ])
    expect(result.nextBook.tBatches).toEqual([])
  })

  it('expands through executions shared by multiple batches and removes their calibration entries', () => {
    const book = fixture()
    const shared = {
      ...trade('shared', 'second', 'buy', 200, '2026-10-15T10:00'),
      allocations: [
        { purpose: 't' as const, quantity: 100, batchId: 'reverse' },
        { purpose: 't' as const, quantity: 100, batchId: 'linked' }
      ]
    }
    book.accounts.second = withLedgerTradeRecords(book.accounts.second, [
      ...book.accounts.second.tradeRecords.filter((item) => item.id !== 'reverse-buy-second-b'),
      shared
    ])
    const third = appendPositionAdjustment(
      book.accounts.unrelated,
      undefined,
      undefined,
      '2026-10-16T10:00',
      '2026-10-16T02:00:00Z',
      false,
      '成本校准',
      'batch-calibration'
    )
    book.accounts.unrelated = withLedgerTradeRecords(third, [
      ...third.tradeRecords.map((item) => ({ ...item, tradedAt: '2026-10-13T10:00' })),
      trade('linked-sell', 'unrelated', 'sell', 100, '2026-10-14T10:00', 'linked')
    ])
    book.tBatches!.unshift({
      ...batch('linked', 4),
      settlement: { ...batch().settlement!, positionAdjustmentId: 'batch-calibration' }
    })
    const result = previewStockPositionRecordDeletion(
      book,
      'first',
      'target',
      DEFAULT_T_PLAN_SETTINGS
    )!

    expect(result.batches.map((item) => item.id)).toEqual(['linked', 'reverse'])
    expect(
      result.nextBook.accounts.unrelated.ledger.entries.some(
        (entry) => entry.id === 'batch-calibration'
      )
    ).toBe(false)
    expect(result.nextBook.accounts.unrelated.tradeRecords.map((item) => item.id)).toEqual([
      'unrelated-buy'
    ])
  })

  it('rejects remaining dependent sales with an account and time, without expanding or mutating the deletion', () => {
    const book = fixture()
    book.accounts.second = withLedgerTradeRecords(book.accounts.second, [
      ...book.accounts.second.tradeRecords,
      trade('dependent-sale', 'second', 'sell', 600, '2026-10-17T10:00')
    ])
    const before = structuredClone(book)

    expect(() =>
      previewStockPositionRecordDeletion(book, 'first', 'target', DEFAULT_T_PLAN_SETTINGS)
    ).toThrow('second · 2026-10-17 10:00：second在 2026-10-17 的可卖数量不足')
    expect(book).toEqual(before)
  })

  it('keeps single-account deletion available when there are no linked batches', () => {
    const book = fixture()
    book.tBatches = []
    book.accounts.first = withLedgerTradeRecords(
      book.accounts.first,
      book.accounts.first.tradeRecords.filter((item) => !item.batchId)
    )
    book.accounts.second = account('second', [
      trade('base-second', 'second', 'buy', 500, '2026-10-14T13:36')
    ])
    const result = previewStockPositionRecordDeletion(
      book,
      'first',
      'target',
      DEFAULT_T_PLAN_SETTINGS
    )!

    expect(result.entryCount).toBe(1)
    expect(result.accounts.map((item) => item.accountId)).toEqual(['first'])
    expect(result.nextBook.accounts.first.position?.cost).toBe(7)
    expect(result.nextBook.accounts.second).toBe(book.accounts.second)
  })
})
