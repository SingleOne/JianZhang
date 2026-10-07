import type { StockTradingBook, TTradingAccount, TTradingBatch } from './types'

export function getStockTBatches(
  book: StockTradingBook | TTradingAccount | undefined
): TTradingBatch[] {
  if (!book) return []
  if ('accounts' in book && book.tBatches) return book.tBatches
  const accounts = 'accounts' in book ? Object.values(book.accounts) : [book]
  return accounts.flatMap((account) => [
    ...(account.activeBatch ? [account.activeBatch] : []),
    ...account.history
  ])
}

export function getActiveStockTBatches(
  book: StockTradingBook | TTradingAccount | undefined
): TTradingBatch[] {
  return getStockTBatches(book).filter((batch) => !batch.settlement)
}

export function batchCalibrationProfit(batch: TTradingBatch): number {
  return (
    (batch.legacyCalibrationProfit ??
      (batch.costCalibrations?.length
        ? 0
        : batch.settlement
          ? batch.settlement.finalProfit - batch.settlement.ledgerProfit
          : 0)) +
    (batch.costCalibrations ?? []).reduce((sum, item) => sum + item.profitAdjustment, 0)
  )
}

export function batchCalibrationProfitCny(batch: TTradingBatch): number | null {
  if (
    (batch.legacyCalibrationProfit ?? 0) !== 0 ||
    (!batch.costCalibrations?.length && batchCalibrationProfit(batch) !== 0)
  )
    return null
  let total = 0
  for (const calibration of batch.costCalibrations ?? []) {
    if (calibration.profitAdjustmentCny === null) return null
    total += calibration.profitAdjustmentCny
  }
  return total
}
