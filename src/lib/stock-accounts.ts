import { getActiveStockTBatches } from '../shared/stock-t-batches'
import { accountFeeSettings } from '../shared/stock-accounts'
import { calculateMarketTradeFeeItems, marketFeeTemplateForTradeDate } from './market-trades'
import {
  listStockAccountBooks,
  getStockAccountBook,
  upsertStockAccount
} from '../shared/stock-accounts'
import {
  marketFromQuoteId,
  stockMarketIdentity,
  marketLabelForQuoteId
} from '../shared/stock-market'
import { appendPortfolioLedgerEntries } from '../shared/types'
import type {
  AppState,
  CorporateActionRecord,
  TTradingAccount,
  StockTradingBook,
  PositionAdjustmentLedgerEntry
} from '../shared/types'
import { createInitialPositionAccount } from './position-ledger'
import { calculateTradeFees, calculateTBatchMetrics } from './t-trading'
import { getBatchTrades } from './trade-records'
import {
  getTriggeredTAlertBadges,
  getTriggeredTFloatingProfitAlert,
  type TPlanFeeOptions
} from './t-alerts'
import {
  calculatePortfolioLedgerMetrics,
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from './portfolio-ledger'

export function moveAccountLedgerEntry(
  state: AppState,
  quoteId: string,
  sourceId: string,
  targetId: string,
  entryId: string,
  recalculateFees = false
): AppState {
  const source = getStockAccountBook(state.stockTradingBooks, quoteId, sourceId)
  const owner = state.securitiesAccounts?.[targetId]
  const entry = source?.ledger.entries.find((item) => item.id === entryId)
  if (
    !source ||
    !entry ||
    !owner?.enabled ||
    owner.market !== source.market ||
    targetId === sourceId
  )
    throw new Error('请选择同市场的其他启用账户')
  const movable =
    entry.kind === 'trade'
      ? entry.record.purpose === 'base' &&
        !entry.record.batchId &&
        !entry.record.allocations?.some((item) => item.purpose === 't') &&
        !entry.record.splitSource &&
        !entry.record.brokerImport
      : (entry.kind === 'cashDividend' || entry.kind === 'withholdingTax') &&
        entry.source === 'manual'
  if (!movable) throw new Error('批次、拆分成交或来源管理记录不能逐条更正账户')
  if (
    source.ledger.entries.some(
      (item) => item.kind === 'reversal' && item.reversesEntryId === entry.id
    )
  )
    throw new Error('已撤销记录不能移动')
  const sourceLedger = {
    ...source.ledger,
    entries: source.ledger.entries.filter((item) => item.id !== entryId)
  }
  const sourceBook = {
    ...source,
    ledger: sourceLedger,
    tradeRecords: source.tradeRecords.filter(
      (item) => entry.kind !== 'trade' || item.id !== entry.record.id
    )
  }
  const target = getStockAccountBook(state.stockTradingBooks, quoteId, targetId) ?? {
    ...source,
    accountId: targetId,
    accountName: owner.name,
    position: undefined,
    positionSnapshots: [],
    performanceAdjustmentCny: 0,
    activeBatch: undefined,
    history: [],
    ledger: { schemaVersion: 1 as const, entries: [] },
    tradeRecords: []
  }
  if (target.ledger.entries.some((item) => item.id === entryId))
    throw new Error('目标账户已有相同流水')
  let moved = {
    ...entry,
    accountId: targetId,
    ...(entry.kind === 'trade' ? { record: { ...entry.record, accountId: targetId } } : {})
  }
  if (recalculateFees && entry.kind === 'trade' && entry.record.origin !== 'opening-balance') {
    const date = entry.record.marketDate ?? entry.record.tradedAt.slice(0, 10)
    const fees = accountFeeSettings(owner, state.settings, state.feeSchemes, quoteId)
    const stock = state.watchlist.find((item) => item.quoteId === quoteId)!
    const template = marketFeeTemplateForTradeDate(owner.market, date)
    if (owner.market !== 'CN' && !template)
      throw new Error('该成交日期没有内置费用模板，请保留原费用')
    const record = {
      ...entry.record,
      accountId: targetId,
      accountFeeSnapshot: structuredClone(fees.accountFees),
      fees:
        owner.market === 'CN'
          ? calculateTradeFees(
              entry.record.price * entry.record.quantity,
              entry.record.side,
              fees.tTradingFees,
              stock.marketLabel
            )
          : { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
      feeItems:
        owner.market === 'CN'
          ? undefined
          : calculateMarketTradeFeeItems(
              owner.market,
              entry.record.price * entry.record.quantity,
              entry.record.quantity,
              entry.record.side,
              fees.marketTradeFees,
              { tradeDate: date, stampDutyExempt: stock.instrumentType === 'etf' }
            ),
      feeSource: owner.market === 'CN' ? undefined : ('estimated' as const),
      feeTemplate: template
    }
    moved = { ...entry, accountId: targetId, record }
  }
  const targetBook = appendPortfolioLedgerEntries(target, [moved])
  const before = calculatePortfolioLedgerPosition(sourceBook, source.market!, source.currency!)
  const after = calculatePortfolioLedgerPosition(targetBook, target.market!, target.currency!)
  if (before.error || after.error) throw new Error(before.error ?? after.error)
  return upsertStockAccount(
    upsertStockAccount(state, sourceBook, before.position, false),
    targetBook,
    after.position,
    false
  )
}

export function stockTOverview(
  book: StockTradingBook | TTradingAccount | undefined,
  latest?: number | null,
  options?: Pick<TPlanFeeOptions, 'market' | 'instrumentType'>
) {
  const summaries = getActiveStockTBatches(book).map((batch) => {
    const trades = getBatchTrades(book, batch)
    const first = listStockAccountBooks(book)[0]
    const account = { ...first, accountId: batch.id, accountName: `批次 #${batch.sequence}` }
    return {
      account,
      batch,
      metrics: calculateTBatchMetrics(batch, trades, latest),
      badges: getTriggeredTAlertBadges(batch, trades, options).map((badge) => ({
        ...badge,
        accountId: batch.id,
        accountName: account.accountName
      })),
      floatingAlert: getTriggeredTFloatingProfitAlert(batch)
    }
  })
  const triggered = summaries.find((summary) => summary.floatingAlert)
  const single = summaries.length === 1 ? summaries[0] : undefined
  const profits = summaries.map((summary) => summary.metrics.floatingProfit)
  return {
    summaries,
    activeBatch: (triggered ?? single)?.batch,
    singleMetrics: single?.metrics ?? null,
    floatingProfit:
      !profits.length || profits.some((value) => value === null)
        ? null
        : profits.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    badges: summaries.flatMap((summary) => summary.badges),
    floatingAlerts: summaries.filter((summary) => summary.floatingAlert),
    floatingAlert: triggered?.floatingAlert ?? null
  }
}

export function applyAccountSecurityConversion(
  state: AppState,
  account: TTradingAccount,
  record: CorporateActionRecord
): AppState {
  const conversion = account.ledger.entries.find(
    (entry) => entry.kind === 'securityConversion' && entry.corporateActionId === record.id
  )
  if (
    !conversion ||
    conversion.kind !== 'securityConversion' ||
    !conversion.targetQuoteId ||
    conversion.targetQuoteId === account.quoteId
  )
    return state
  const accountId = account.accountId!
  const targetQuoteId = conversion.targetQuoteId
  if (marketFromQuoteId(targetQuoteId) !== account.market)
    throw new Error('证券转换跨市场，请分别在目标市场账户处理持仓')
  let next = state
  let source = account
  let target = getStockAccountBook(state.stockTradingBooks, targetQuoteId, accountId)
  if (record.status === 'reversed') {
    if (target) {
      const ids = new Set(
        target.ledger.entries
          .filter((entry) => entry.corporateActionId === record.id && entry.kind !== 'reversal')
          .map((entry) => entry.id)
      )
      target = appendPortfolioLedgerEntries(
        target,
        [...ids].map((id) => ({
          id: `reversal:${id}`,
          accountId,
          quoteId: targetQuoteId,
          kind: 'reversal' as const,
          reversesEntryId: id,
          corporateActionId: record.id,
          source: 'corporateAction' as const,
          occurredAt: new Date().toISOString(),
          marketDate: new Date().toISOString().slice(0, 10)
        }))
      )
    }
  } else {
    if (
      target &&
      activePortfolioLedgerEntries(target).some(
        (entry) => entry.id === `${conversion.id}:target-credit`
      )
    )
      return state
    const oldSource = getStockAccountBook(state.stockTradingBooks, account.quoteId, accountId)
    const sourceAtEvent = calculatePortfolioLedgerMetrics(
      {
        ...account,
        ledger: {
          schemaVersion: 1,
          entries: account.ledger.entries.filter(
            (entry) =>
              entry.corporateActionId !== record.id && entry.occurredAt <= conversion.occurredAt
          )
        }
      },
      account.currency!
    )
    if (sourceAtEvent.error) throw new Error(sourceAtEvent.error)
    const transferCost = sourceAtEvent.nativeCostBasis
    const targetStock = state.watchlist.find((stock) => stock.quoteId === targetQuoteId)
    target ??= {
      quoteId: targetQuoteId,
      accountId,
      accountName: account.accountName,
      code: targetQuoteId.split('.').slice(1).join('.'),
      name: targetStock?.name ?? targetQuoteId,
      market: account.market,
      currency: account.currency,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    }
    if (activePortfolioLedgerEntries(target).some((entry) => entry.corporateActionId === record.id))
      throw new Error('请先撤销原证券转换，再确认修订结果')
    if (!target.ledger.entries.length && target.position)
      target = createInitialPositionAccount(
        target,
        {
          quoteId: targetQuoteId,
          code: target.code,
          name: target.name,
          market: target.market!,
          currency: target.currency!
        },
        target.position,
        `${target.position.openedOn ?? conversion.marketDate}T00:00`
      )
    const targetAtEvent = calculatePortfolioLedgerMetrics(
      {
        ...target,
        ledger: {
          schemaVersion: 1,
          entries: target.ledger.entries.filter(
            (entry) =>
              entry.corporateActionId !== record.id && entry.occurredAt <= conversion.occurredAt
          )
        }
      },
      target.currency!
    )
    if (targetAtEvent.error) throw new Error(targetAtEvent.error)
    const targetQuantity = targetAtEvent.quantity + conversion.quantityAfter
    const targetCost = targetAtEvent.nativeCostBasis + transferCost
    const combinedRate =
      targetCost > 0 && targetAtEvent.cnyCostBasis !== null && sourceAtEvent.cnyCostBasis !== null
        ? (targetAtEvent.cnyCostBasis + sourceAtEvent.cnyCostBasis) / targetCost
        : undefined
    const base = {
      accountId,
      occurredAt: conversion.occurredAt,
      marketDate: conversion.marketDate,
      recordedAt: conversion.recordedAt,
      source: 'corporateAction' as const,
      corporateActionId: record.id,
      currency: account.currency,
      exchangeRate: conversion.exchangeRate,
      exchangeRateDate: conversion.exchangeRateDate
    }
    const debit: PositionAdjustmentLedgerEntry = {
      ...base,
      id: `${conversion.id}:source-close`,
      quoteId: account.quoteId,
      kind: 'positionAdjustment',
      quantityBefore: conversion.quantityAfter,
      quantityAfter: 0,
      costBefore: oldSource?.position?.cost ?? null,
      costAfter: null
    }
    const credit: PositionAdjustmentLedgerEntry = {
      ...base,
      id: `${conversion.id}:target-credit`,
      quoteId: targetQuoteId,
      kind: 'positionAdjustment',
      exchangeRate: combinedRate,
      quantityBefore: targetAtEvent.quantity,
      quantityAfter: targetQuantity,
      costBefore: targetAtEvent.averageCost,
      costAfter: targetQuantity > 0 ? targetCost / targetQuantity : null,
      openedOnAfter: target.position?.openedOn ?? oldSource?.position?.openedOn
    }
    source = appendPortfolioLedgerEntries(
      {
        ...source,
        ledger: {
          ...source.ledger,
          entries: source.ledger.entries.filter(
            (entry) => entry.kind !== 'reversal' || entry.reversesEntryId !== debit.id
          )
        }
      },
      [debit]
    )
    target = appendPortfolioLedgerEntries(
      {
        ...target,
        ledger: {
          ...target.ledger,
          entries: target.ledger.entries.filter(
            (entry) => entry.kind !== 'reversal' || entry.reversesEntryId !== credit.id
          )
        }
      },
      [credit]
    )
    record.appliedEntryIds = [...new Set([...(record.appliedEntryIds ?? []), debit.id, credit.id])]
    if (!targetStock)
      next = {
        ...next,
        watchlist: [
          ...next.watchlist,
          {
            quoteId: targetQuoteId,
            code: target.code,
            name: target.name,
            ...stockMarketIdentity(targetQuoteId),
            marketLabel: marketLabelForQuoteId(targetQuoteId),
            showInTaskbar: false,
            isPriority: true,
            showRadarSignals: true,
            groupIds: []
          }
        ]
      }
  }
  const sourcePosition = calculatePortfolioLedgerPosition(source, source.market!, source.currency!)
  if (sourcePosition.error) throw new Error(sourcePosition.error)
  next = upsertStockAccount(next, source, sourcePosition.position, false)
  if (target) {
    const targetPosition = calculatePortfolioLedgerPosition(
      target,
      target.market!,
      target.currency!
    )
    if (targetPosition.error) throw new Error(targetPosition.error)
    next = upsertStockAccount(next, target, targetPosition.position, false)
  }
  return next
}
