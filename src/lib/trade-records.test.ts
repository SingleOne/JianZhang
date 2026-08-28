import { describe, expect, it } from 'vitest'
import type { TTradingAccount, TTradeRecord } from '../shared/types'
import {
  getBatchTrades,
  getTradeAllocations,
  getTradeAllocationsForBatch,
  isIndependentBaseTrade
} from './trade-records'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

describe('allocated trade records', () => {
  it('returns one execution from each batch referenced by its allocations', () => {
    const record: TTradeRecord = {
      id: 'transition',
      side: 'sell',
      purpose: 't',
      tradedAt: '2026-08-26T10:00',
      price: 12,
      quantity: 1_000,
      fees: EMPTY_FEES,
      allocations: [
        {
          purpose: 't',
          quantity: 400,
          batchId: 'batch-1',
          batchSequence: 1,
          batchDirection: 'forward'
        },
        {
          purpose: 't',
          quantity: 600,
          batchId: 'batch-2',
          batchSequence: 2,
          batchDirection: 'reverse'
        }
      ],
      note: ''
    }
    const account: TTradingAccount = {
      quoteId: '1.600000',
      code: '600000',
      name: '浦发银行',
      activeBatch: {
        id: 'batch-2',
        sequence: 2,
        openedAt: record.tradedAt,
        direction: 'reverse',
        buyLevels: [],
        sellLevels: []
      },
      history: [
        {
          id: 'batch-1',
          sequence: 1,
          openedAt: record.tradedAt,
          direction: 'forward',
          buyLevels: [],
          sellLevels: []
        }
      ],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: [record]
    }

    expect(getBatchTrades(account, 'batch-1')).toEqual([record])
    expect(getBatchTrades(account, 'batch-2')).toEqual([record])
    expect(getTradeAllocationsForBatch(record, 'batch-1')[0].quantity).toBe(400)
    expect(getTradeAllocationsForBatch(record, 'batch-2')[0].quantity).toBe(600)
  })

  it('treats legacy base allocations as account-level trades outside T batches', () => {
    const record: TTradeRecord = {
      id: 'legacy-base',
      side: 'buy',
      purpose: 'base',
      tradedAt: '2026-08-27T10:00',
      price: 12,
      quantity: 500,
      fees: EMPTY_FEES,
      batchId: 'batch-1',
      batchSequence: 1,
      batchDirection: 'forward',
      allocations: [
        {
          purpose: 'base',
          quantity: 500,
          batchId: 'batch-1',
          batchSequence: 1,
          batchDirection: 'forward'
        }
      ],
      note: ''
    }
    const account: TTradingAccount = {
      quoteId: '1.600000',
      code: '600000',
      name: '浦发银行',
      activeBatch: {
        id: 'batch-1',
        sequence: 1,
        openedAt: record.tradedAt,
        direction: 'forward',
        buyLevels: [],
        sellLevels: []
      },
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: [record]
    }

    expect(getTradeAllocations(record)).toEqual([{ purpose: 'base', quantity: 500 }])
    expect(getBatchTrades(account, 'batch-1')).toEqual([])
    expect(isIndependentBaseTrade(record)).toBe(true)
  })
})
