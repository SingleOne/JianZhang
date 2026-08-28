import type {
  TTradingAccount,
  TTradingBatch,
  TTrade,
  TTradeAllocation,
  TTradeRecord
} from '../shared/types'

type TradeWithLegacyBatch = TTrade &
  Partial<Pick<TTradeRecord, 'batchId' | 'batchSequence' | 'batchDirection'>>

export function getTradeAllocations(trade: TradeWithLegacyBatch): TTradeAllocation[] {
  if (trade.allocations?.length) {
    return trade.allocations.map((allocation) => {
      if (allocation.purpose === 't') return allocation
      const {
        batchId: _batchId,
        batchSequence: _batchSequence,
        batchDirection: _batchDirection,
        ...independentAllocation
      } = allocation
      return independentAllocation
    })
  }
  return [
    {
      purpose: trade.purpose,
      quantity: trade.quantity,
      batchId: trade.purpose === 't' ? trade.batchId : undefined,
      batchSequence: trade.purpose === 't' ? trade.batchSequence : undefined,
      batchDirection: trade.purpose === 't' ? trade.batchDirection : undefined
    }
  ]
}

export function getTradeAllocationsForBatch(
  trade: TradeWithLegacyBatch,
  batchId: string
): TTradeAllocation[] {
  return getTradeAllocations(trade).filter(
    (allocation) => allocation.purpose === 't' && allocation.batchId === batchId
  )
}

export function tradeReferencesBatch(trade: TradeWithLegacyBatch, batchId: string): boolean {
  return getTradeAllocations(trade).some(
    (allocation) => allocation.purpose === 't' && allocation.batchId === batchId
  )
}

export function hasTAllocationForBatch(trade: TradeWithLegacyBatch, batchId: string): boolean {
  return getTradeAllocationsForBatch(trade, batchId).some(
    (allocation) => allocation.purpose === 't' && allocation.quantity > 0
  )
}

export function isIndependentBaseTrade(trade: TradeWithLegacyBatch): boolean {
  return (
    trade.purpose === 'base' && !getTradeAllocations(trade).some((item) => item.purpose === 't')
  )
}

export function sortTradeRecords(
  records: readonly TTradeRecord[],
  direction: 'ascending' | 'descending' = 'descending'
): TTradeRecord[] {
  return [...records].sort((left, right) =>
    direction === 'ascending'
      ? left.tradedAt.localeCompare(right.tradedAt)
      : right.tradedAt.localeCompare(left.tradedAt)
  )
}

export function getAccountTrades(
  account: TTradingAccount | undefined,
  direction: 'ascending' | 'descending' = 'ascending'
): TTradeRecord[] {
  return sortTradeRecords(account?.tradeRecords ?? [], direction)
}

export function getBatchTrades(
  account: TTradingAccount | undefined,
  batch: Pick<TTradingBatch, 'id'> | string | undefined
): TTradeRecord[] {
  const batchId = typeof batch === 'string' ? batch : batch?.id
  if (!batchId) return []
  return sortTradeRecords(
    (account?.tradeRecords ?? []).filter((record) => tradeReferencesBatch(record, batchId)),
    'ascending'
  )
}

export function toTradeRecord(trade: TTrade, batch?: TTradingBatch): TTradeRecord {
  return batch
    ? {
        ...trade,
        batchId: batch.id,
        batchSequence: batch.sequence,
        batchDirection: batch.direction ?? 'forward'
      }
    : { ...trade }
}

export function upsertTradeRecord(
  records: readonly TTradeRecord[] | undefined,
  trade: TTrade,
  batch?: TTradingBatch
): TTradeRecord[] {
  return sortTradeRecords([
    ...(records ?? []).filter((record) => record.id !== trade.id),
    toTradeRecord(trade, batch)
  ])
}

export function detachTradeRecordsFromBatch(
  records: readonly TTradeRecord[],
  batchId: string
): TTradeRecord[] {
  return sortTradeRecords(
    records.map((record) => {
      if (!tradeReferencesBatch(record, batchId)) return record
      const {
        batchId: _batchId,
        batchSequence: _batchSequence,
        batchDirection: _batchDirection,
        ...independentTrade
      } = record
      return {
        ...independentTrade,
        allocations: record.allocations?.map((allocation) => {
          if (allocation.batchId !== batchId) return allocation
          const {
            batchId: _allocationBatchId,
            batchSequence: _allocationBatchSequence,
            batchDirection: _allocationBatchDirection,
            ...independentAllocation
          } = allocation
          return independentAllocation
        })
      }
    })
  )
}
