import type {
  TTradingAccount,
  TTradingBatch,
  TTrade,
  TTradeRecord
} from '../shared/types'

export function sortTradeRecords(
  records: readonly TTradeRecord[],
  direction: 'ascending' | 'descending' = 'descending'
): TTradeRecord[] {
  return [...records].sort((left, right) => (
    direction === 'ascending'
      ? left.tradedAt.localeCompare(right.tradedAt)
      : right.tradedAt.localeCompare(left.tradedAt)
  ))
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
    (account?.tradeRecords ?? []).filter((record) => record.batchId === batchId),
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
  return sortTradeRecords(records.map((record) => {
    if (record.batchId !== batchId) return record
    const {
      batchId: _batchId,
      batchSequence: _batchSequence,
      batchDirection: _batchDirection,
      ...independentTrade
    } = record
    return independentTrade
  }))
}
