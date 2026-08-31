import { describe, expect, it } from 'vitest'
import type { StockPosition, TTradingAccount, TTradeRecord } from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import { calculatePortfolioLedgerPosition } from './portfolio-ledger'
import {
  appendPositionAdjustment,
  createInitialPositionAccount,
  hasInitialPositionRecord,
  positionRecordLedgerEntries,
  previewPositionRecordDeletion,
  removePositionRecordEntries,
  shouldCreateInitialPositionRecord
} from './position-ledger'

const IDENTITY = {
  quoteId: '0.000876',
  code: '000876',
  name: '新希望',
  market: 'CN' as const,
  currency: 'CNY' as const
}

function position(quantity: number, cost: number): StockPosition {
  return {
    quantity,
    cost,
    openedToday: false,
    openedOn: '2024-10-08',
    currency: 'CNY',
    costExchangeRate: 1,
    costExchangeRateDate: '2024-10-08'
  }
}

function account(records: TTradeRecord[] = []): TTradingAccount {
  return withLedgerTradeRecords(
    {
      ...IDENTITY,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    records
  )
}

describe('position ledger', () => {
  it('only creates an initial position record for a genuinely new position', () => {
    const existingPosition = position(1_000, 4.28)
    const recordedTrade: TTradeRecord = {
      id: 'recorded-buy',
      side: 'buy',
      purpose: 'base',
      tradedAt: '2026-07-01T10:07',
      price: 4.28,
      quantity: 1_000,
      fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
      market: 'CN',
      currency: 'CNY',
      marketDate: '2026-07-01',
      exchangeRate: 1,
      note: ''
    }

    expect(shouldCreateInitialPositionRecord(undefined, existingPosition, account())).toBe(true)
    expect(
      shouldCreateInitialPositionRecord(undefined, existingPosition, account([recordedTrade]))
    ).toBe(false)
    expect(
      shouldCreateInitialPositionRecord(existingPosition, position(1_000, 4.1), account())
    ).toBe(false)
  })

  it('uses the first manually entered position as the initial balance even when trades exist', () => {
    const sell: TTradeRecord = {
      id: 'final-sell',
      side: 'sell',
      purpose: 'base',
      tradedAt: '2026-08-25T09:39',
      price: 6.8447,
      quantity: 2_600,
      fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
      market: 'CN',
      currency: 'CNY',
      marketDate: '2026-08-25',
      exchangeRate: 1,
      note: ''
    }
    const result = createInitialPositionAccount(
      account([sell]),
      IDENTITY,
      position(2_600, 10.6662),
      '2026-08-29T00:30'
    )

    expect(hasInitialPositionRecord(result)).toBe(true)
    expect(result.tradeRecords.find((record) => record.origin === 'opening-balance')).toMatchObject(
      {
        quantity: 2_600,
        price: 10.6662,
        note: '初始持仓'
      }
    )
    expect(calculatePortfolioLedgerPosition(result, 'CN', 'CNY')).toEqual({})
  })

  it('replaces quantity and cost basis with a manual position adjustment', () => {
    const initial = createInitialPositionAccount(
      account(),
      IDENTITY,
      position(2_600, 10),
      '2026-08-29T00:30'
    )
    const nextPosition = position(3_000, 9.5)
    const adjusted = appendPositionAdjustment(
      initial,
      position(2_600, 10),
      nextPosition,
      '2026-08-29T00:31',
      '2026-08-28T16:31:00.000Z',
      true
    )

    expect(adjusted.ledger.entries[0]).toMatchObject({
      kind: 'positionAdjustment',
      quantityBefore: 2_600,
      quantityAfter: 3_000,
      costBefore: 10,
      costAfter: 9.5,
      resetsPerformance: true
    })
    expect(calculatePortfolioLedgerPosition(adjusted, 'CN', 'CNY').position).toMatchObject({
      quantity: 3_000,
      cost: 9.5,
      openedOn: '2024-10-08'
    })
  })

  it('records clearing a position as an adjustment to zero', () => {
    const initial = createInitialPositionAccount(
      account(),
      IDENTITY,
      position(2_600, 10),
      '2026-08-29T00:30'
    )
    const adjusted = appendPositionAdjustment(
      initial,
      position(2_600, 10),
      undefined,
      '2026-08-29T00:31',
      '2026-08-28T16:31:00.000Z'
    )

    expect(calculatePortfolioLedgerPosition(adjusted, 'CN', 'CNY')).toEqual({})
  })

  it('lists position adjustments with trades and previews deleting all later records', () => {
    const initial = createInitialPositionAccount(
      account(),
      IDENTITY,
      position(1_000, 4.28),
      '2026-07-01T10:00'
    )
    const adjusted = appendPositionAdjustment(
      initial,
      position(1_000, 4.28),
      position(900, 4.1),
      '2026-08-01T10:00',
      '2026-08-01T02:00:00.000Z'
    )
    const laterTrade: TTradeRecord = {
      id: 'later-buy',
      side: 'buy',
      purpose: 'base',
      tradedAt: '2026-08-02T10:00',
      price: 4,
      quantity: 100,
      fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
      market: 'CN',
      currency: 'CNY',
      marketDate: '2026-08-02',
      exchangeRate: 1,
      origin: 'execution',
      note: ''
    }
    const withLaterTrade = withLedgerTradeRecords(adjusted, [...adjusted.tradeRecords, laterTrade])
    const records = positionRecordLedgerEntries(withLaterTrade)
    const adjustment = records.find((entry) => entry.kind === 'positionAdjustment')!
    const preview = previewPositionRecordDeletion(withLaterTrade, adjustment.id)!

    expect(records.map((entry) => entry.kind)).toEqual(['trade', 'positionAdjustment', 'trade'])
    expect(preview.laterRecordCount).toBe(1)
    expect(preview.entries.map((entry) => entry.id)).toEqual(['trade:later-buy', adjustment.id])

    const removed = removePositionRecordEntries(
      withLaterTrade,
      new Set(preview.entries.map((entry) => entry.id))
    )
    expect(removed.tradeRecords.map((record) => record.id)).toEqual([
      `opening-balance:${IDENTITY.quoteId}`
    ])
    expect(positionRecordLedgerEntries(removed).map((entry) => entry.id)).toEqual([
      `trade:opening-balance:${IDENTITY.quoteId}`
    ])
  })
})
