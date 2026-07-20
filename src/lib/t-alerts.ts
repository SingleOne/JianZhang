import {
  calculateTBatchMetrics,
  calculateTradeFees,
  totalTradeFees
} from './t-trading'
import type {
  StockQuote,
  TPlanLevel,
  TTradingAccount,
  TTradingAccounts,
  TTradingBatch,
  TTradingFeeSettings
} from '../shared/types'

export type TAlertSide = 'buy' | 'sell'

export interface TPlanRow extends TPlanLevel {
  index: number
  targetPrice: number | null
  expectedProfit: number | null
  cumulativeProfit: number | null
  fullPositionProfit: number | null
  projectedQuantity: number | null
  projectedCost: number | null
}

export interface TAlertBadge {
  side: TAlertSide
  index: number
  label: string
  targetPrice: number | null
}

function levelsForSide(batch: TTradingBatch, side: TAlertSide): TPlanLevel[] {
  return side === 'buy' ? (batch.buyLevels ?? []) : batch.sellLevels
}

function replaceLevels(
  batch: TTradingBatch,
  side: TAlertSide,
  levels: TPlanLevel[]
): TTradingBatch {
  return side === 'buy' ? { ...batch, buyLevels: levels } : { ...batch, sellLevels: levels }
}

export function tPlanTargetPrice(
  averageCost: number | null,
  side: TAlertSide,
  targetPercent: number
): number | null {
  if (averageCost === null) return null
  return averageCost * (side === 'buy' ? 1 - targetPercent / 100 : 1 + targetPercent / 100)
}

export function getTPlanRows(
  batch: TTradingBatch | undefined,
  side: TAlertSide,
  feeSettings: TTradingFeeSettings,
  marketLabel: string
): TPlanRow[] {
  if (!batch) return []

  const metrics = calculateTBatchMetrics(batch)
  const averageCost = metrics.averageCost
  let cumulativeProfit = metrics.realizedProfit
  const isOpeningPlan = (
    (metrics.direction === 'forward' && side === 'buy')
    || (metrics.direction === 'reverse' && side === 'sell')
  )

  return levelsForSide(batch, side).map((level, index) => {
    const targetPrice = tPlanTargetPrice(averageCost, side, level.targetPercent)
    const hasQuantity = level.quantity >= 100
    const fees = targetPrice === null || !hasQuantity
      ? 0
      : totalTradeFees(calculateTradeFees(targetPrice * level.quantity, side, feeSettings, marketLabel))
    const difference = targetPrice === null || averageCost === null
      ? null
      : side === 'buy' ? averageCost - targetPrice : targetPrice - averageCost
    const expectedProfit = isOpeningPlan || difference === null || !hasQuantity
      ? null
      : difference * level.quantity - fees
    const fullPositionFees = targetPrice === null
      ? 0
      : totalTradeFees(calculateTradeFees(
        targetPrice * metrics.remainingQuantity,
        side,
        feeSettings,
        marketLabel
      ))
    const fullPositionProfit = isOpeningPlan || difference === null
      ? null
      : metrics.realizedProfit + difference * metrics.remainingQuantity - fullPositionFees
    const projectedQuantity = isOpeningPlan && targetPrice !== null && hasQuantity
      ? metrics.remainingQuantity + level.quantity
      : null
    const projectedCostBasis = projectedQuantity === null || targetPrice === null
      ? null
      : metrics.remainingCostBasis + (
          side === 'buy'
            ? targetPrice * level.quantity + fees
            : targetPrice * level.quantity - fees
        )
    const projectedCost = projectedQuantity && projectedCostBasis !== null
      ? projectedCostBasis / projectedQuantity
      : null

    if (expectedProfit !== null) cumulativeProfit += expectedProfit
    return {
      ...level,
      index,
      targetPrice,
      expectedProfit,
      cumulativeProfit: expectedProfit === null ? null : cumulativeProfit,
      fullPositionProfit,
      projectedQuantity,
      projectedCost
    }
  })
}

export function getTriggeredTAlertBadges(batch: TTradingBatch | undefined): TAlertBadge[] {
  if (!batch?.alertEnabled) return []
  const averageCost = calculateTBatchMetrics(batch).averageCost
  return (['buy', 'sell'] as const).flatMap((side) => {
    const levels = levelsForSide(batch, side)
    let index = levels.length - 1
    while (index >= 0 && levels[index].alertStatus !== 'triggered') index -= 1
    if (index < 0) return []

    const level = levels[index]
    return [{
      side,
      index,
      label: `T${index + 1}`,
      targetPrice: tPlanTargetPrice(averageCost, side, level.targetPercent)
    }]
  })
}

export function hasTriggeredTAlerts(batch: TTradingBatch | undefined): boolean {
  return getTriggeredTAlertBadges(batch).length > 0
}

function priceTriggersLevel(
  latest: number,
  targetPrice: number | null,
  side: TAlertSide
): boolean {
  if (targetPrice === null) return false
  return side === 'buy' ? latest <= targetPrice : latest >= targetPrice
}

export function applyTAlertTriggers(
  batch: TTradingBatch,
  latest: number | null | undefined
): { batch: TTradingBatch; changed: boolean } {
  if (!batch.alertEnabled || latest === null || latest === undefined) {
    return { batch, changed: false }
  }

  const averageCost = calculateTBatchMetrics(batch).averageCost
  let changed = false
  let nextBatch = batch

  for (const side of ['buy', 'sell'] as const) {
    const nextLevels = levelsForSide(nextBatch, side).map((level) => {
      const targetPrice = tPlanTargetPrice(averageCost, side, level.targetPercent)
      if (targetPrice === null) {
        return level
      }

      const status = level.alertStatus ?? 'armed'
      const isTriggered = priceTriggersLevel(latest, targetPrice, side)
      if (!isTriggered) {
        if (status === 'armed') return level
        changed = true
        return { ...level, alertStatus: 'armed' as const, triggeredAt: undefined }
      }

      if (status !== 'armed') return level
      changed = true
      return { ...level, alertStatus: 'triggered' as const, triggeredAt: new Date().toISOString() }
    })
    nextBatch = replaceLevels(nextBatch, side, nextLevels)
  }

  return { batch: changed ? nextBatch : batch, changed }
}

export function applyTAlertTriggersToAccounts(
  accounts: TTradingAccounts,
  quotes: readonly StockQuote[]
): { accounts: TTradingAccounts; changed: boolean } {
  const quotesById = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  let changed = false
  const nextAccounts: TTradingAccounts = {}

  for (const [quoteId, account] of Object.entries(accounts)) {
    const batch = account.activeBatch
    const result = batch
      ? applyTAlertTriggers(batch, quotesById.get(quoteId)?.latest)
      : { batch, changed: false }
    nextAccounts[quoteId] = result.changed
      ? { ...account, activeBatch: result.batch }
      : account
    changed ||= result.changed
  }

  return { accounts: changed ? nextAccounts : accounts, changed }
}

export function setTAlertEnabled(batch: TTradingBatch, enabled: boolean): TTradingBatch {
  if (!enabled) return { ...batch, alertEnabled: false }

  const rearm = (levels: TPlanLevel[]) => levels.map((level) => (
    level.alertStatus === 'handled'
      ? level
      : { ...level, alertStatus: 'armed' as const, triggeredAt: undefined }
  ))
  return {
    ...batch,
    alertEnabled: true,
    buyLevels: rearm(batch.buyLevels ?? []),
    sellLevels: rearm(batch.sellLevels)
  }
}

export function updateTPlanLevel(
  batch: TTradingBatch,
  side: TAlertSide,
  index: number,
  key: 'targetPercent' | 'quantity',
  value: number
): TTradingBatch {
  const levels = levelsForSide(batch, side).map((level, levelIndex) => (
    levelIndex === index
      ? {
          ...level,
          [key]: Math.max(0, value || 0),
          alertStatus: 'armed' as const,
          triggeredAt: undefined
        }
      : level
  ))
  return replaceLevels(batch, side, levels)
}

export function handleTPlanAlert(
  batch: TTradingBatch,
  side: TAlertSide,
  index?: number
): TTradingBatch {
  const levels = levelsForSide(batch, side).map((level, levelIndex) => (
    level.alertStatus === 'triggered' && (index === undefined || index === levelIndex)
      ? { ...level, alertStatus: 'handled' as const }
      : level
  ))
  return replaceLevels(batch, side, levels)
}

export function restoreTPlanAlert(
  batch: TTradingBatch,
  side: TAlertSide,
  index: number
): TTradingBatch {
  const levels = levelsForSide(batch, side).map((level, levelIndex) => (
    levelIndex === index
      ? { ...level, alertStatus: 'armed' as const, triggeredAt: undefined }
      : level
  ))
  return replaceLevels(batch, side, levels)
}

export function handleTriggeredTPlanAlertsForTrade(
  batch: TTradingBatch,
  side: TAlertSide
): TTradingBatch {
  return handleTPlanAlert(batch, side)
}

export function accountHasTriggeredTAlerts(account: TTradingAccount | undefined): boolean {
  return hasTriggeredTAlerts(account?.activeBatch)
}
