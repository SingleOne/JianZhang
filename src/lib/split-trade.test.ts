import { describe, expect, it } from 'vitest'
import { withLedgerTradeRecords, type TTradeRecord, type TTradingBatch } from '../shared/types'
import { calculatePortfolioLedgerMetrics } from './portfolio-ledger'
import { splitTradeForOverflow } from './split-trade'
import { getTradeBatchAllocationAmounts, roundMoney, totalRecordedTradeFees } from './t-trading'
import { getBatchTrades, isIndependentBaseTrade } from './trade-records'

const closingBatch: TTradingBatch = {
  id: 'closing-batch',
  sequence: 4,
  direction: 'reverse',
  openedAt: '2026-08-20T09:31',
  buyLevels: [],
  sellLevels: []
}

function execution(changes: Partial<TTradeRecord> = {}): TTradeRecord {
  return {
    id: 'execution',
    side: 'buy',
    purpose: 't',
    tradedAt: '2026-08-21T09:59',
    quantity: 2_500,
    price: 6.88,
    fees: { commission: 9.14, handling: 0.59, regulatory: 0.34, transfer: 0.17, stampDuty: 0 },
    note: '保留原备注',
    ...changes
  }
}

function account(records: TTradeRecord[]) {
  return withLedgerTradeRecords(
    {
      quoteId: '0.000876',
      code: '000876',
      name: '新希望',
      activeBatch: closingBatch,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    records
  )
}

describe('split overflow executions', () => {
  it('records the 2100-share T cover and 400-share base purchase separately without changing totals', () => {
    const original = execution()
    const [closing, base] = splitTradeForOverflow(original, closingBatch, 2_100)
    const saved = account([closing, base])

    expect(closing.quantity).toBe(2_100)
    expect(base.quantity).toBe(400)
    expect(closing.id).not.toBe(base.id)
    expect(closing.allocations).toBeUndefined()
    expect(base.allocations).toBeUndefined()
    expect(base.batchId).toBeUndefined()
    expect(saved.ledger.entries).toHaveLength(2)
    expect(getBatchTrades(saved, closingBatch)).toEqual([closing])
    expect(saved.tradeRecords.filter(isIndependentBaseTrade)).toEqual([base])
    expect(totalRecordedTradeFees(closing)).toBe(8.6)
    expect(totalRecordedTradeFees(base)).toBe(1.64)
    const splitMetrics = calculatePortfolioLedgerMetrics(saved, 'CNY')
    const originalMetrics = calculatePortfolioLedgerMetrics(account([original]), 'CNY')
    expect(splitMetrics.quantity).toBe(originalMetrics.quantity)
    expect(splitMetrics.nativeCostBasis).toBe(originalMetrics.nativeCostBasis)
    expect(splitMetrics.averageCost).toBeCloseTo(originalMetrics.averageCost!, 10)
    expect(closing.splitSource).toEqual({ id: original.id, quantity: 2_500 })
    expect(base.splitSource).toEqual(closing.splitSource)
    expect(base.note).toBe(original.note)
    expect(base.tradedAt).toBe(original.tradedAt)
    expect(base.price).toBe(original.price)
  })

  it('keeps an oversized sale outside the T batch and preserves the allocated T fee', () => {
    const original = execution({
      side: 'sell',
      quantity: 1_300,
      price: 4.4,
      fees: { commission: 4.69, handling: 0.2, regulatory: 0.11, transfer: 0.06, stampDuty: 2.86 },
      allocations: [
        { purpose: 't', quantity: 400, batchId: closingBatch.id },
        { purpose: 'base', quantity: 900, batchId: closingBatch.id }
      ]
    })
    const [closing, base] = splitTradeForOverflow(original, closingBatch, 400)
    expect(closing.quantity).toBe(400)
    expect(base.quantity).toBe(900)
    expect(isIndependentBaseTrade(base)).toBe(true)
    expect(totalRecordedTradeFees(closing)).toBe(2.44)
    expect(totalRecordedTradeFees(base)).toBe(5.48)
    expect(getTradeBatchAllocationAmounts(closing, closingBatch).tFees).toBe(
      getTradeBatchAllocationAmounts(original, closingBatch).tFees
    )
  })

  it.each(['buy', 'sell'] as const)('links each part of a %s only to its own T batch', (side) => {
    const previousBatch: TTradingBatch = {
      ...closingBatch,
      direction: side === 'buy' ? 'reverse' : 'forward'
    }
    const nextBatch: TTradingBatch = {
      ...closingBatch,
      id: 'next-batch',
      sequence: 5,
      direction: side === 'buy' ? 'forward' : 'reverse'
    }
    const [closing, opening] = splitTradeForOverflow(
      execution({ side }),
      previousBatch,
      2_100,
      nextBatch
    )
    const saved = account([closing, opening])
    expect(getBatchTrades(saved, closingBatch)).toEqual([closing])
    expect(getBatchTrades(saved, nextBatch)).toEqual([opening])
    expect(closing.batchDirection).toBe(previousBatch.direction)
    expect(opening.batchDirection).toBe(nextBatch.direction)
    expect(saved.tradeRecords.filter(isIndependentBaseTrade)).toEqual([])
    const afterDelete = account(saved.tradeRecords.filter((record) => record.id !== opening.id))
    expect(afterDelete.tradeRecords).toEqual([closing])
    expect(opening.splitSource).toEqual(closing.splitSource)
  })

  it('distributes cent rounding without negative fee items or duplicated minimum fees', () => {
    const original = execution({
      quantity: 200,
      fees: { commission: 0, handling: 0.01, regulatory: 0.01, transfer: 0.01, stampDuty: 0.02 },
      feeItems: [{ code: 'manual', label: '附加费用', amount: 0.01 }]
    })
    const [closing, base] = splitTradeForOverflow(original, closingBatch, 100)
    expect(totalRecordedTradeFees(closing)).toBe(0.03)
    expect(totalRecordedTradeFees(base)).toBe(0.03)
    for (const key of ['commission', 'handling', 'regulatory', 'transfer', 'stampDuty'] as const) {
      expect(closing.fees[key]).toBeGreaterThanOrEqual(0)
      expect(base.fees[key]).toBeGreaterThanOrEqual(0)
      expect(roundMoney(closing.fees[key] + base.fees[key])).toBe(original.fees[key])
    }
    expect(roundMoney(closing.feeItems![0].amount + base.feeItems![0].amount)).toBe(0.01)
  })
})
