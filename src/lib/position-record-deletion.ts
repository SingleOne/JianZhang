import type {
  PortfolioLedgerEntry,
  StockTradingBook,
  TPlanDefaultSettings,
  TTradingBatch
} from '../shared/types'
import { getStockTBatches } from '../shared/stock-t-batches'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { calculatePortfolioLedgerPosition } from './portfolio-ledger'
import { previewPositionRecordDeletion, removePositionRecordEntries } from './position-ledger'
import { reconcileStockTBatches } from './stock-t-trading'
import { getBatchTrades } from './trade-records'

export interface StockPositionDeletionAccount {
  accountId: string
  entries: PortfolioLedgerEntry[]
  buyQuantity: number
  sellQuantity: number
}

export function previewStockPositionRecordDeletion(
  book: StockTradingBook,
  accountId: string,
  entryId: string,
  defaults: TPlanDefaultSettings
) {
  const account = book.accounts[accountId]
  const preview = previewPositionRecordDeletion(account, entryId)
  if (!preview) return undefined

  const entryIds = new Map<string, Set<string>>([
    [accountId, new Set(preview.entries.map((entry) => entry.id))]
  ])
  const batches = getStockTBatches(book)
  const deletedBatches = new Set<string>()
  const adjustmentIdsFor = (batch: TTradingBatch) =>
    new Set(
      [
        batch.settlement?.positionAdjustmentId,
        ...(batch.costCalibrations ?? []).flatMap((calibration) =>
          calibration.accounts.map((item) => item.positionAdjustmentId)
        )
      ].filter((id): id is string => Boolean(id))
    )

  // 一笔拆分成交可能连接多个批次；预览必须覆盖整笔成交关联的全部批次。
  let expanded = true
  while (expanded) {
    expanded = false
    for (const batch of batches) {
      if (deletedBatches.has(batch.id)) continue
      const trades = getBatchTrades(book, batch)
      const adjustmentIds = adjustmentIdsFor(batch)
      const affected =
        trades.some((trade) => entryIds.get(trade.accountId!)?.has(`trade:${trade.id}`)) ||
        Object.values(book.accounts).some((child) =>
          child.ledger.entries.some(
            (entry) => adjustmentIds.has(entry.id) && entryIds.get(child.accountId!)?.has(entry.id)
          )
        )
      if (!affected) continue
      deletedBatches.add(batch.id)
      expanded = true
      for (const [id, child] of Object.entries(book.accounts)) {
        const ids = entryIds.get(id) ?? new Set<string>()
        for (const trade of trades) if (trade.accountId === id) ids.add(`trade:${trade.id}`)
        for (const entry of child.ledger.entries) if (adjustmentIds.has(entry.id)) ids.add(entry.id)
        if (ids.size) entryIds.set(id, ids)
      }
    }
  }

  const accounts: StockPositionDeletionAccount[] = []
  const nextAccounts = { ...book.accounts }
  const market = marketFromQuoteId(book.quoteId)
  for (const [id, ids] of entryIds) {
    const child = book.accounts[id]
    for (const entry of child.ledger.entries)
      if (entry.kind === 'reversal' && ids.has(entry.reversesEntryId)) ids.add(entry.id)
    const entries = child.ledger.entries.filter((entry) => ids.has(entry.id))
    const name = child.accountName ?? id
    if (entries.some((entry) => entry.corporateActionId))
      throw new Error(`${name}：待删除记录包含公司行动流水，请先在公司行动中撤销`)
    const remaining = removePositionRecordEntries(child, ids)
    const replay = calculatePortfolioLedgerPosition(
      remaining,
      market,
      child.currency ?? currencyForMarket(market)
    )
    if (replay.error) {
      const failedEntry = remaining.ledger.entries.find((entry) => entry.id === replay.errorEntryId)
      throw new Error(
        `${name}${failedEntry ? ` · ${failedEntry.occurredAt.replace('T', ' ')}` : ''}：${replay.error}。请先处理该后续记录`
      )
    }
    nextAccounts[id] = {
      ...remaining,
      position: replay.position,
      activeBatch: undefined,
      history: []
    }
    accounts.push({
      accountId: id,
      entries,
      buyQuantity: entries.reduce(
        (sum, entry) =>
          sum + (entry.kind === 'trade' && entry.record.side === 'buy' ? entry.record.quantity : 0),
        0
      ),
      sellQuantity: entries.reduce(
        (sum, entry) =>
          sum +
          (entry.kind === 'trade' && entry.record.side === 'sell' ? entry.record.quantity : 0),
        0
      )
    })
  }
  const nextBook = reconcileStockTBatches(
    {
      ...book,
      accounts: nextAccounts,
      tBatches: batches.filter((batch) => !deletedBatches.has(batch.id))
    },
    defaults,
    book
  )
  return {
    target: preview.target,
    laterRecordCount: preview.laterRecordCount,
    accounts,
    batches: batches.filter((batch) => deletedBatches.has(batch.id)),
    entryCount: accounts.reduce((sum, item) => sum + item.entries.length, 0),
    nextBook
  }
}
