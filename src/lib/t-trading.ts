import type {
  StockPosition,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradeSide,
  TTradingDirection,
  TPlanDefaultLevel,
  TPlanDefaultSettings,
  TPlanLevel,
  TSellPlanLevel
} from '../shared/types'
import {
  createDefaultTPlanLevels,
  normalizeActiveTTradingBatch
} from '../shared/types'
import { currentDateKey } from './portfolio'

export interface TBatchMetrics {
  direction: TTradingDirection
  remainingQuantity: number
  remainingCostBasis: number
  averageCost: number | null
  realizedProfit: number
  floatingProfit: number | null
  floatingProfitRate: number | null
  buyAmount: number
  sellAmount: number
}

export function getTBatchDirection(
  batch: Pick<TTradingBatch, 'direction'> | undefined
): TTradingDirection {
  return batch?.direction ?? 'forward'
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function totalTradeFees(fees: TTradeFees): number {
  return roundMoney(
    fees.commission
    + fees.handling
    + fees.regulatory
    + fees.transfer
    + fees.stampDuty
  )
}

function feeByRate(amount: number, ratePerTenThousand: number): number {
  return roundMoney(amount * ratePerTenThousand / 10_000)
}

export function calculateTradeFees(
  amount: number,
  side: TTradeSide,
  settings: TTradingFeeSettings,
  marketLabel: string
): TTradeFees {
  const handling = feeByRate(amount, settings.handlingRatePerTenThousand)
  const regulatory = feeByRate(amount, settings.regulatoryRatePerTenThousand)
  const transfer = Math.max(
    0.01,
    feeByRate(amount, settings.transferRatePerTenThousand)
  )
  const baseCommission = feeByRate(amount, settings.commissionRatePerTenThousand)
  const minimumBundleFees = marketLabel === '沪A'
    ? handling + regulatory
    : handling + regulatory + transfer
  const minimumCommission = Math.max(
    0,
    roundMoney(settings.minimumCommissionBundle - minimumBundleFees)
  )

  return {
    commission: Math.max(baseCommission, minimumCommission),
    handling,
    regulatory,
    transfer,
    stampDuty: side === 'sell'
      ? feeByRate(amount, settings.stampDutyRatePerTenThousand)
      : 0
  }
}

export function calculateTBatchMetrics(
  batch: TTradingBatch | undefined,
  trades: readonly TTrade[],
  latestPrice?: number | null
): TBatchMetrics {
  const direction = getTBatchDirection(batch)
  const openingSide: TTradeSide = direction === 'forward' ? 'buy' : 'sell'
  let remainingQuantity = 0
  let remainingCostBasis = 0
  let realizedProfit = 0
  let buyAmount = 0
  let sellAmount = 0

  for (const trade of trades) {
    if (trade.purpose !== 't') continue
    const amount = trade.price * trade.quantity
    const fees = totalTradeFees(trade.fees)

    if (trade.side === openingSide) {
      remainingQuantity += trade.quantity
      remainingCostBasis += direction === 'forward'
        ? amount + fees
        : amount - fees
      if (trade.side === 'buy') buyAmount += amount
      else sellAmount += amount
      continue
    }

    const averageCost = remainingQuantity > 0
      ? remainingCostBasis / remainingQuantity
      : 0
    const allocatedCost = averageCost * trade.quantity
    remainingQuantity -= trade.quantity
    remainingCostBasis -= allocatedCost
    realizedProfit += direction === 'forward'
      ? amount - fees - allocatedCost
      : allocatedCost - amount - fees
    if (trade.side === 'buy') buyAmount += amount
    else sellAmount += amount
  }

  if (Math.abs(remainingQuantity) < 0.000001) {
    remainingQuantity = 0
    remainingCostBasis = 0
  }

  const averageCost = remainingQuantity > 0
    ? remainingCostBasis / remainingQuantity
    : null
  const floatingProfit = averageCost !== null && latestPrice !== null && latestPrice !== undefined
    ? (direction === 'forward'
      ? latestPrice - averageCost
      : averageCost - latestPrice) * remainingQuantity
    : null

  return {
    direction,
    remainingQuantity,
    remainingCostBasis,
    averageCost,
    realizedProfit,
    floatingProfit,
    floatingProfitRate: floatingProfit !== null && remainingCostBasis > 0
      ? floatingProfit / remainingCostBasis
      : null,
    buyAmount,
    sellAmount
  }
}

export function validateTBatchTrades(
  batch: TTradingBatch,
  trades: readonly TTrade[]
): string | undefined {
  const direction = getTBatchDirection(batch)
  const openingSide: TTradeSide = direction === 'forward' ? 'buy' : 'sell'
  let runningTQuantity = 0
  let runningPositionQuantity = batch.openingPosition?.quantity ?? 0

  for (const trade of trades) {
    runningPositionQuantity += trade.side === 'buy' ? trade.quantity : -trade.quantity
    if (runningPositionQuantity < 0) {
      return '卖出数量不能超过批次内可用持仓数量'
    }
    if (trade.purpose !== 't') continue
    runningTQuantity += trade.side === openingSide ? trade.quantity : -trade.quantity
    if (runningTQuantity < 0) {
      return direction === 'forward'
        ? '交易顺序或数量会导致T仓卖超，请检查买卖流水'
        : '交易顺序或数量会导致反T回补超额，请检查买卖流水'
    }
  }

  return undefined
}

export function createDefaultSellLevels(quantity: number): TSellPlanLevel[] {
  return createDefaultTPlanLevels(quantity)
}

export function createTPlanLevelsFromDefaults(
  defaults: readonly TPlanDefaultLevel[]
): TPlanLevel[] {
  return defaults.map((level) => ({
    ...level,
    alertStatus: 'armed'
  }))
}

export function rebalanceTPlanLevels(
  levels: readonly TPlanLevel[] | undefined,
  defaults: readonly TPlanDefaultLevel[]
): TPlanLevel[] {
  return createTPlanLevelsFromDefaults(defaults).map((fallback, index) => {
    const level = levels?.[index]
    return level ? { ...level, quantity: fallback.quantity } : fallback
  })
}

export function rebalanceTBatchPlans(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  defaults: TPlanDefaultSettings
): TTradingBatch {
  const normalized = normalizeActiveTTradingBatch(batch, trades)
  return {
    ...normalized,
    buyLevels: rebalanceTPlanLevels(normalized.buyLevels, defaults.buyLevels),
    sellLevels: rebalanceTPlanLevels(normalized.sellLevels, defaults.sellLevels)
  }
}

export function resetTBatchPlans(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  defaults: TPlanDefaultSettings
): TTradingBatch {
  const normalized = normalizeActiveTTradingBatch(batch, trades)
  return {
    ...normalized,
    buyLevels: createTPlanLevelsFromDefaults(defaults.buyLevels),
    sellLevels: createTPlanLevelsFromDefaults(defaults.sellLevels)
  }
}

export function applyTradeToPosition(
  position: StockPosition | undefined,
  trade: TTrade
): StockPosition | undefined {
  const previousQuantity = position?.quantity ?? 0
  const previousCostBasis = previousQuantity * (position?.cost ?? 0)
  const amount = trade.price * trade.quantity
  const fees = totalTradeFees(trade.fees)
  const nextQuantity = trade.side === 'buy'
    ? previousQuantity + trade.quantity
    : previousQuantity - trade.quantity

  if (nextQuantity <= 0) return undefined

  const nextCostBasis = trade.side === 'buy'
    ? previousCostBasis + amount + fees
    : previousCostBasis - amount + fees

  return {
    quantity: nextQuantity,
    cost: nextCostBasis / nextQuantity,
    openedToday: position?.openedToday ?? trade.tradedAt.slice(0, 10) === currentDateKey(),
    openedOn: position?.openedOn ?? trade.tradedAt.slice(0, 10)
  }
}

export function recalculatePositionFromBatch(
  batch: TTradingBatch,
  trades: readonly TTrade[]
): StockPosition | undefined {
  let position = batch.openingPosition
    ? {
        ...batch.openingPosition,
        openedToday: false
      }
    : undefined

  for (const trade of trades) {
    position = applyTradeToPosition(position, trade)
  }
  return position
}

export function calculateCostAdjustedProfit(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  latestPositionQuantity: number,
  latestPositionCost: number
): number {
  let referenceCostBasis = (batch.openingPosition?.quantity ?? 0)
    * (batch.openingPosition?.cost ?? 0)

  for (const trade of trades) {
    if (trade.purpose !== 'base') continue
    const amount = trade.price * trade.quantity
    const fees = totalTradeFees(trade.fees)
    referenceCostBasis += trade.side === 'buy'
      ? amount + fees
      : -amount + fees
  }

  return referenceCostBasis - latestPositionQuantity * latestPositionCost
}
