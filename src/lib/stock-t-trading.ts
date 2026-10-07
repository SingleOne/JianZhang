import type {
  ExchangeRateSettings,
  StockPosition,
  StockTradingBook,
  TBatchCostCalibration,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingBatch,
  TTradeRecord
} from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import { batchCalibrationProfit, getStockTBatches } from '../shared/stock-t-batches'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { marketDateTimeInput } from '../shared/market-hours'
import { activePortfolioLedgerEntries, calculatePortfolioLedgerPosition } from './portfolio-ledger'
import { appendPositionAdjustment, createInitialPositionAccount } from './position-ledger'
import { getBatchTrades, getTradeAllocations, tradeReferencesBatch } from './trade-records'
import {
  calculateTBatchMetrics,
  rebalanceTBatchPlans,
  roundMoney,
  validateTBatchTrades
} from './t-trading'

export function toStockTradingBook(
  book: StockTradingBook | TTradingAccount | undefined,
  quoteId: string
): StockTradingBook {
  return book && 'accounts' in book
    ? book
    : {
        quoteId,
        accounts: book ? { [book.accountId ?? `default:${marketFromQuoteId(quoteId)}`]: book } : {},
        tBatches: getStockTBatches(book)
      }
}

export function reconcileStockTBatches(
  book: StockTradingBook,
  defaults: TPlanDefaultSettings,
  previousBook?: StockTradingBook | TTradingAccount
): StockTradingBook {
  const market = marketFromQuoteId(book.quoteId)
  const tBatches = getStockTBatches(book).flatMap((storedBatch): TTradingBatch[] => {
    const costCalibrations = storedBatch.costCalibrations?.map((calibration) => {
      let cny: number | null = 0
      const accounts = calibration.accounts.flatMap((item) => {
        if (!item.positionAdjustmentId) return [item]
        const account = book.accounts[item.accountId]
        const entry =
          account &&
          activePortfolioLedgerEntries(account).find(
            (entry) => entry.id === item.positionAdjustmentId
          )
        if (entry?.kind !== 'positionAdjustment') return []
        const quantity = entry.quantityAfter
        const costBefore = entry.costBefore ?? 0
        const costAfter = entry.costAfter ?? 0
        const delta = quantity * (costBefore - costAfter)
        const rate = market === 'CN' ? 1 : entry.exchangeRate
        if (rate === undefined) cny = null
        else if (cny !== null) cny += delta * rate
        return [{ ...item, quantity, costBefore, costAfter }]
      })
      return {
        ...calibration,
        accounts,
        profitAdjustment: roundMoney(
          accounts.reduce(
            (sum, item) => sum + item.quantity * (item.costBefore - item.costAfter),
            0
          )
        ),
        profitAdjustmentCny: cny === null ? null : roundMoney(cny)
      }
    })
    const batch = { ...storedBatch, costCalibrations }
    const trades = getBatchTrades(book, batch)
    if (!trades.length)
      return batch.settlement && !getBatchTrades(previousBook, batch).length ? [batch] : []
    const error = validateTBatchTrades(batch, trades, false)
    if (error) throw new Error(`T 批次 #${batch.sequence}：${error}`)
    if (!batch.settlement) return [rebalanceTBatchPlans(batch, trades, defaults, market)]
    const metrics = calculateTBatchMetrics(batch, trades)
    if (metrics.remainingQuantity > 0.000001)
      throw new Error(`已结算 T 批次 #${batch.sequence} 的买卖数量必须保持平衡`)
    const calibration = batchCalibrationProfit(batch)
    const calibrated = Boolean(batch.costCalibrations?.length || calibration)
    return [
      {
        ...batch,
        legacyCalibrationProfit:
          batch.legacyCalibrationProfit ??
          (batch.costCalibrations?.length
            ? 0
            : batch.settlement.finalProfit - batch.settlement.ledgerProfit),
        settlement: {
          ...batch.settlement,
          ledgerProfit: metrics.realizedProfit,
          finalProfit: roundMoney(metrics.realizedProfit + calibration),
          source: calibrated ? 'position-cost' : 'ledger',
          costAdjustedProfit: calibrated
            ? roundMoney(metrics.realizedProfit + calibration)
            : undefined
        }
      }
    ]
  })
  return { ...book, tBatches }
}

function replayAccount(account: TTradingAccount): TTradingAccount {
  const market = account.market ?? marketFromQuoteId(account.quoteId)
  const replay = calculatePortfolioLedgerPosition(
    account,
    market,
    account.currency ?? currencyForMarket(market)
  )
  if (replay.error) throw new Error(replay.error)
  return { ...account, position: replay.position, activeBatch: undefined, history: [] }
}

export function mergeStockTAccount(
  book: StockTradingBook,
  account: TTradingAccount,
  position: StockPosition | undefined,
  previousBatchId: string | undefined,
  defaults: TPlanDefaultSettings
): StockTradingBook {
  const active = getStockTBatches(book).filter(
    (batch) =>
      !batch.settlement && batch.id !== previousBatchId && batch.id !== account.activeBatch?.id
  )
  const next = {
    ...book,
    accounts: {
      ...book.accounts,
      [account.accountId!]: { ...account, position, activeBatch: undefined, history: [] }
    },
    tBatches: [...active, ...(account.activeBatch ? [account.activeBatch] : []), ...account.history]
  }
  return reconcileStockTBatches(next, defaults, book)
}

export function updateStockTBatch(book: StockTradingBook, batch: TTradingBatch): StockTradingBook {
  return {
    ...book,
    tBatches: getStockTBatches(book).map((item) => (item.id === batch.id ? batch : item))
  }
}

export function stockBatchAccounts(
  book: StockTradingBook,
  batch: TTradingBatch
): TTradingAccount[] {
  const ids = new Set(getBatchTrades(book, batch).map((trade) => trade.accountId))
  return Object.values(book.accounts).filter((account) => ids.has(account.accountId))
}

export function deleteStockTTrade(
  book: StockTradingBook,
  trade: TTradeRecord,
  defaults: TPlanDefaultSettings
): StockTradingBook {
  const account = book.accounts[trade.accountId!]
  const nextAccount = replayAccount(
    withLedgerTradeRecords(
      account,
      account.tradeRecords.filter((record) => record.id !== trade.id)
    )
  )
  return reconcileStockTBatches(
    {
      ...book,
      accounts: { ...book.accounts, [account.accountId!]: nextAccount }
    },
    defaults,
    book
  )
}

export function deleteStockTBatch(
  book: StockTradingBook,
  batch: TTradingBatch,
  defaults: TPlanDefaultSettings
): StockTradingBook {
  if (
    getBatchTrades(book, batch).some(
      (trade) =>
        new Set(
          getTradeAllocations(trade)
            .filter((item) => item.purpose === 't')
            .map((item) => item.batchId)
        ).size > 1
    )
  )
    throw new Error('该批次与另一 T 批次由同一笔成交连接，不能单独删除')
  const adjustmentIds = new Set(
    [
      batch.settlement?.positionAdjustmentId,
      ...(batch.costCalibrations ?? []).flatMap((calibration) =>
        calibration.accounts.map((account) => account.positionAdjustmentId)
      )
    ].filter((id): id is string => Boolean(id))
  )
  const accounts = Object.fromEntries(
    Object.entries(book.accounts).map(([id, account]) => {
      const affected =
        account.tradeRecords.some((record) => tradeReferencesBatch(record, batch.id)) ||
        account.ledger.entries.some((entry) => adjustmentIds.has(entry.id))
      if (!affected) return [id, account]
      const nextAccount = withLedgerTradeRecords(
        {
          ...account,
          ledger: {
            ...account.ledger,
            entries: account.ledger.entries.filter((entry) => !adjustmentIds.has(entry.id))
          }
        },
        account.tradeRecords.filter((record) => !tradeReferencesBatch(record, batch.id))
      )
      return [id, replayAccount(nextAccount)]
    })
  )
  return reconcileStockTBatches(
    {
      ...book,
      accounts,
      tBatches: getStockTBatches(book).filter((item) => item.id !== batch.id)
    },
    defaults
  )
}

export function settleStockTBatch(
  book: StockTradingBook,
  batch: TTradingBatch,
  note = ''
): StockTradingBook {
  const trades = getBatchTrades(book, batch)
  const metrics = calculateTBatchMetrics(batch, trades)
  if (!trades.length || metrics.remainingQuantity > 0.000001)
    throw new Error('批次买卖数量平衡后才能结算')
  const accounts = stockBatchAccounts(book, batch)
  const quantity = accounts.reduce((sum, account) => sum + (account.position?.quantity ?? 0), 0)
  const costBasis = accounts.reduce(
    (sum, account) => sum + (account.position?.quantity ?? 0) * (account.position?.cost ?? 0),
    0
  )
  const hasCalibration =
    (batch.costCalibrations?.length ?? 0) > 0 || (batch.legacyCalibrationProfit ?? 0) !== 0
  const finalProfit = roundMoney(metrics.realizedProfit + batchCalibrationProfit(batch))
  return updateStockTBatch(book, {
    ...batch,
    legacyCalibrationProfit: batch.legacyCalibrationProfit ?? 0,
    settlement: {
      settledAt: new Date().toISOString(),
      latestPositionQuantity: quantity,
      latestPositionCost: quantity > 0 ? costBasis / quantity : undefined,
      ledgerProfit: metrics.realizedProfit,
      finalProfit,
      costAdjustedProfit: hasCalibration ? finalProfit : undefined,
      source: hasCalibration ? 'position-cost' : 'ledger',
      note
    }
  })
}

export function previewStockTCostCalibration(
  book: StockTradingBook,
  batch: TTradingBatch,
  costs: Readonly<Record<string, string>>
): { accounts: TBatchCostCalibration['accounts']; profitAdjustment: number } {
  const accounts = stockBatchAccounts(book, batch).map((account) => {
    const quantity = account.position?.quantity ?? 0
    const value = costs[account.accountId!]
    const costAfter = quantity > 0 ? Number(value) : 0
    if (
      quantity > 0 &&
      (value?.trim() === '' || value === undefined || !Number.isFinite(costAfter) || costAfter < 0)
    )
      throw new Error(`请填写 ${account.accountName ?? '账户'} 的有效成本`)
    return {
      accountId: account.accountId!,
      accountName: account.accountName ?? account.accountId!,
      quantity,
      costBefore: account.position?.cost ?? 0,
      costAfter
    }
  })
  return {
    accounts,
    profitAdjustment: roundMoney(
      accounts.reduce(
        (sum, account) => sum + account.quantity * (account.costBefore - account.costAfter),
        0
      )
    )
  }
}

export function calibrateStockTCosts(
  book: StockTradingBook,
  batch: TTradingBatch,
  costs: Readonly<Record<string, string>>,
  exchangeRates: ExchangeRateSettings,
  defaults: TPlanDefaultSettings
): StockTradingBook {
  const preview = previewStockTCostCalibration(book, batch, costs)
  const market = marketFromQuoteId(book.quoteId)
  const currency = currencyForMarket(market)
  const createdAt = new Date().toISOString()
  const currentTime = marketDateTimeInput(market)
  const accounts = { ...book.accounts }
  let profitAdjustmentCny: number | null = 0
  let changed = false
  const calibratedAccounts = preview.accounts.map((item) => {
    if (item.quantity === 0 || Math.abs(item.costAfter - item.costBefore) < 0.00000001) return item
    changed = true
    let account = accounts[item.accountId]
    const position = account.position!
    const occurredAt = activePortfolioLedgerEntries(account).reduce(
      (latest, entry) => (entry.occurredAt > latest ? entry.occurredAt : latest),
      currentTime
    )
    if (!account.ledger.entries.length)
      account = createInitialPositionAccount(
        account,
        { ...account, market, currency },
        position,
        occurredAt
      )
    const rate =
      currency === 'CNY'
        ? 1
        : (position.costExchangeRate ?? exchangeRateForCurrency(exchangeRates, currency))
    const delta = item.quantity * (item.costBefore - item.costAfter)
    if (rate === null || rate === undefined) profitAdjustmentCny = null
    else if (profitAdjustmentCny !== null) profitAdjustmentCny += delta * rate
    const positionAdjustmentId = `position-adjustment:${crypto.randomUUID()}`
    accounts[item.accountId] = replayAccount(
      appendPositionAdjustment(
        account,
        position,
        { ...position, cost: item.costAfter, costExchangeRate: rate ?? undefined },
        occurredAt,
        createdAt,
        false,
        `T批次 #${batch.sequence} 收益成本校准`,
        positionAdjustmentId
      )
    )
    return { ...item, positionAdjustmentId }
  })
  if (!changed) return book
  const calibration: TBatchCostCalibration = {
    id: crypto.randomUUID(),
    createdAt,
    accounts: calibratedAccounts,
    profitAdjustment: preview.profitAdjustment,
    profitAdjustmentCny: profitAdjustmentCny === null ? null : roundMoney(profitAdjustmentCny)
  }
  const nextBatch = {
    ...batch,
    legacyCalibrationProfit:
      batch.legacyCalibrationProfit ??
      (batch.costCalibrations?.length ? 0 : batchCalibrationProfit(batch)),
    costCalibrations: [...(batch.costCalibrations ?? []), calibration]
  }
  return reconcileStockTBatches(updateStockTBatch({ ...book, accounts }, nextBatch), defaults)
}
