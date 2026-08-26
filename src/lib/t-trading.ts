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
import { createDefaultTPlanLevels, normalizeActiveTTradingBatch } from '../shared/types'
import { currentDateKey } from './portfolio'
import { getTradeAllocations } from './trade-records'

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
    fees.commission + fees.handling + fees.regulatory + fees.transfer + fees.stampDuty
  )
}

export function totalRecordedTradeFees(trade: Pick<TTrade, 'fees' | 'feeItems'>): number {
  return roundMoney(
    totalTradeFees(trade.fees) +
      (trade.feeItems ?? []).reduce((total, item) => total + item.amount, 0)
  )
}

export interface TTradeBatchAllocationAmounts {
  quantity: number
  fees: number
  tQuantity: number
  tFees: number
  baseQuantity: number
  baseFees: number
}

function allocatedTradeAmounts(trade: TTrade) {
  const allocations = getTradeAllocations(trade)
  const totalQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
  const totalFees = totalRecordedTradeFees(trade)
  let allocatedFees = 0

  return allocations.map((allocation, index) => {
    const fees =
      index === allocations.length - 1
        ? roundMoney(totalFees - allocatedFees)
        : roundMoney(totalQuantity > 0 ? (totalFees * allocation.quantity) / totalQuantity : 0)
    allocatedFees = roundMoney(allocatedFees + fees)
    return { allocation, fees }
  })
}

export function getTradeBatchAllocationAmounts(
  trade: TTrade,
  batch: Pick<TTradingBatch, 'id'>
): TTradeBatchAllocationAmounts {
  const allocated = allocatedTradeAmounts(trade).filter(({ allocation }) =>
    trade.allocations?.length ? allocation.batchId === batch.id : true
  )
  let quantity = 0
  let fees = 0
  let tQuantity = 0
  let tFees = 0
  let baseQuantity = 0
  let baseFees = 0

  for (const item of allocated) {
    quantity += item.allocation.quantity
    fees += item.fees
    if (item.allocation.purpose === 't') {
      tQuantity += item.allocation.quantity
      tFees += item.fees
    } else {
      baseQuantity += item.allocation.quantity
      baseFees += item.fees
    }
  }

  return {
    quantity,
    fees: roundMoney(fees),
    tQuantity,
    tFees: roundMoney(tFees),
    baseQuantity,
    baseFees: roundMoney(baseFees)
  }
}

function feeByRate(amount: number, ratePerTenThousand: number): number {
  return roundMoney((amount * ratePerTenThousand) / 10_000)
}

export function calculateTradeFees(
  amount: number,
  side: TTradeSide,
  settings: TTradingFeeSettings,
  marketLabel: string
): TTradeFees {
  const handling = feeByRate(amount, settings.handlingRatePerTenThousand)
  const regulatory = feeByRate(amount, settings.regulatoryRatePerTenThousand)
  const transfer = Math.max(0.01, feeByRate(amount, settings.transferRatePerTenThousand))
  const baseCommission = feeByRate(amount, settings.commissionRatePerTenThousand)
  const minimumBundleFees =
    marketLabel === '沪A' ? handling + regulatory : handling + regulatory + transfer
  const minimumCommission = Math.max(
    0,
    roundMoney(settings.minimumCommissionBundle - minimumBundleFees)
  )

  return {
    commission: Math.max(baseCommission, minimumCommission),
    handling,
    regulatory,
    transfer,
    stampDuty: side === 'sell' ? feeByRate(amount, settings.stampDutyRatePerTenThousand) : 0
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
    const allocation = batch
      ? getTradeBatchAllocationAmounts(trade, batch)
      : {
          tQuantity: trade.purpose === 't' ? trade.quantity : 0,
          tFees: trade.purpose === 't' ? totalRecordedTradeFees(trade) : 0
        }
    if (allocation.tQuantity <= 0) continue
    const amount = trade.price * allocation.tQuantity
    const fees = allocation.tFees

    if (trade.side === openingSide) {
      remainingQuantity += allocation.tQuantity
      remainingCostBasis += direction === 'forward' ? amount + fees : amount - fees
      if (trade.side === 'buy') buyAmount += amount
      else sellAmount += amount
      continue
    }

    const averageCost = remainingQuantity > 0 ? remainingCostBasis / remainingQuantity : 0
    const allocatedCost = averageCost * allocation.tQuantity
    remainingQuantity -= allocation.tQuantity
    remainingCostBasis -= allocatedCost
    realizedProfit +=
      direction === 'forward' ? amount - fees - allocatedCost : allocatedCost - amount - fees
    if (trade.side === 'buy') buyAmount += amount
    else sellAmount += amount
  }

  if (Math.abs(remainingQuantity) < 0.000001) {
    remainingQuantity = 0
    remainingCostBasis = 0
  }

  const averageCost = remainingQuantity > 0 ? remainingCostBasis / remainingQuantity : null
  const floatingProfit =
    averageCost !== null && latestPrice !== null && latestPrice !== undefined
      ? (direction === 'forward' ? latestPrice - averageCost : averageCost - latestPrice) *
        remainingQuantity
      : null

  return {
    direction,
    remainingQuantity,
    remainingCostBasis,
    averageCost,
    realizedProfit,
    floatingProfit,
    floatingProfitRate:
      floatingProfit !== null && remainingCostBasis > 0
        ? (floatingProfit / remainingCostBasis) * 100
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
    const allocation = getTradeBatchAllocationAmounts(trade, batch)
    runningPositionQuantity += trade.side === 'buy' ? allocation.quantity : -allocation.quantity
    if (runningPositionQuantity < 0) {
      return '卖出数量不能超过批次内可用持仓数量'
    }
    if (allocation.tQuantity <= 0) continue
    runningTQuantity += trade.side === openingSide ? allocation.tQuantity : -allocation.tQuantity
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
  return applyTradeAmountToPosition(position, trade, trade.quantity, totalRecordedTradeFees(trade))
}

function applyTradeAmountToPosition(
  position: StockPosition | undefined,
  trade: TTrade,
  quantity: number,
  fees: number
): StockPosition | undefined {
  const previousQuantity = position?.quantity ?? 0
  const previousCostBasis = previousQuantity * (position?.cost ?? 0)
  const amount = trade.price * quantity
  const nextQuantity =
    trade.side === 'buy' ? previousQuantity + quantity : previousQuantity - quantity

  if (nextQuantity <= 0) return undefined

  const nextCostBasis =
    trade.side === 'buy' ? previousCostBasis + amount + fees : previousCostBasis - amount + fees

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
    const allocation = getTradeBatchAllocationAmounts(trade, batch)
    if (allocation.quantity <= 0) continue
    position = applyTradeAmountToPosition(position, trade, allocation.quantity, allocation.fees)
  }
  return position
}

export function calculateCostAdjustedProfit(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  latestPositionQuantity: number,
  latestPositionCost: number
): number {
  let referenceCostBasis =
    (batch.openingPosition?.quantity ?? 0) * (batch.openingPosition?.cost ?? 0)

  for (const trade of trades) {
    const allocation = getTradeBatchAllocationAmounts(trade, batch)
    if (allocation.baseQuantity <= 0) continue
    const amount = trade.price * allocation.baseQuantity
    const fees = allocation.baseFees
    referenceCostBasis += trade.side === 'buy' ? amount + fees : -amount + fees
  }

  return referenceCostBasis - latestPositionQuantity * latestPositionCost
}
