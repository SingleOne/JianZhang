import { describe, expect, it } from 'vitest'
import type { TTradingAccount, TTrade } from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import { deleteIndependentBaseTrade, upsertIndependentBaseTrade } from './base-trades'
import { getBatchTrades, isIndependentBaseTrade } from './trade-records'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function trade(changes: Partial<TTrade> = {}): TTrade {
  return {
    id: 'opening',
    side: 'buy',
    purpose: 'base',
    tradedAt: '2026-07-01T09:30',
    price: 10,
    quantity: 100,
    fees: EMPTY_FEES,
    market: 'CN',
    currency: 'CNY',
    marketDate: '2026-07-01',
    exchangeRate: 1,
    origin: 'opening-balance',
    note: '期初持仓',
    ...changes
  }
}

function account(): TTradingAccount {
  const batch = {
    id: 'batch-1',
    sequence: 1,
    openedAt: '2026-07-02T09:30',
    direction: 'reverse' as const,
    buyLevels: [],
    sellLevels: []
  }
  return withLedgerTradeRecords(
    {
      quoteId: '1.600000',
      code: '600000',
      name: '浦发银行',
      market: 'CN',
      currency: 'CNY',
      activeBatch: batch,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    [
      {
        ...trade({
          id: 'batch-sell',
          side: 'sell',
          purpose: 't',
          tradedAt: '2026-07-02T09:30',
          marketDate: '2026-07-02',
          price: 11,
          origin: 'execution',
          note: ''
        }),
        allocations: [
          {
            purpose: 't',
            quantity: 100,
            batchId: batch.id,
            batchSequence: batch.sequence,
            batchDirection: batch.direction
          }
        ]
      }
    ]
  )
}

describe('independent base trades', () => {
  it('repairs a zero-start ledger without adding the base trade to the active T batch', () => {
    const current = account()
    const result = upsertIndependentBaseTrade(current, trade(), 'CN', 'CNY')

    expect(result.error).toBeUndefined()
    expect(result.position).toBeUndefined()
    expect(result.account.activeBatch).toEqual(current.activeBatch)
    expect(getBatchTrades(result.account, 'batch-1').map((item) => item.id)).toEqual(['batch-sell'])
    expect(
      isIndependentBaseTrade(result.account.tradeRecords.find((item) => item.id === 'opening')!)
    ).toBe(true)
  })

  it('rejects an independent reduction that still leaves a chronological oversell', () => {
    const result = upsertIndependentBaseTrade(
      account(),
      trade({ id: 'extra-sell', side: 'sell', tradedAt: '2026-07-03T09:30' }),
      'CN',
      'CNY'
    )

    expect(result.error).toBe('卖出数量不能超过组合账本中的可用持仓数量')
  })

  it('prevents deleting an opening balance when later T trades depend on it', () => {
    const repaired = upsertIndependentBaseTrade(account(), trade(), 'CN', 'CNY')
    const result = deleteIndependentBaseTrade(repaired.account, 'opening', 'CN', 'CNY')

    expect(result.error).toBe('卖出数量不能超过组合账本中的可用持仓数量')
  })
})
