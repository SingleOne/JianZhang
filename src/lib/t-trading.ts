import type {
  StockPosition,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradeSide,
  TSellPlanLevel
} from '../shared/types'
import { currentDateKey } from './portfolio'

export interface TBatchMetrics {
  remainingQuantity: number
  remainingCostBasis: number
  averageCost: number | null
  realizedProfit: number
  floatingProfit: number | null
  buyAmount: number
  sellAmount: number
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
  settings: TTradingFeeSettings
): TTradeFees {
  const handling = feeByRate(amount, settings.handlingRatePerTenThousand)
  const regulatory = feeByRate(amount, settings.regulatoryRatePerTenThousand)
  const transfer = Math.max(
    0.01,
    feeByRate(amount, settings.transferRatePerTenThousand)
  )
  const baseCommission = feeByRate(amount, settings.commissionRatePerTenThousand)
  const minimumCommission = Math.max(
    0,
    roundMoney(settings.minimumCommissionBundle - handling - regulatory - transfer)
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
  latestPrice?: number | null
): TBatchMetrics {
  let remainingQuantity = 0
  let remainingCostBasis = 0
  let realizedProfit = 0
  let buyAmount = 0
  let sellAmount = 0

  for (const trade of batch?.trades ?? []) {
    if (trade.purpose !== 't') continue
    const amount = trade.price * trade.quantity
    const fees = totalTradeFees(trade.fees)

    if (trade.side === 'buy') {
      remainingQuantity += trade.quantity
      remainingCostBasis += amount + fees
      buyAmount += amount
      continue
    }

    const averageCost = remainingQuantity > 0
      ? remainingCostBasis / remainingQuantity
      : 0
    const allocatedCost = averageCost * trade.quantity
    remainingQuantity -= trade.quantity
    remainingCostBasis -= allocatedCost
    realizedProfit += amount - fees - allocatedCost
    sellAmount += amount
  }

  if (Math.abs(remainingQuantity) < 0.000001) {
    remainingQuantity = 0
    remainingCostBasis = 0
  }

  const averageCost = remainingQuantity > 0
    ? remainingCostBasis / remainingQuantity
    : null

  return {
    remainingQuantity,
    remainingCostBasis,
    averageCost,
    realizedProfit,
    floatingProfit: averageCost !== null && latestPrice !== null && latestPrice !== undefined
      ? (latestPrice - averageCost) * remainingQuantity
      : null,
    buyAmount,
    sellAmount
  }
}

export function createDefaultSellLevels(quantity: number): TSellPlanLevel[] {
  const totalLots = Math.floor(quantity / 100)
  const baseLots = Math.floor(totalLots / 5)
  const extraLots = totalLots % 5
  return [1, 2, 3, 4, 5].map((targetPercent, index) => {
    const lots = baseLots + (index < extraLots ? 1 : 0)
    return { targetPercent, quantity: lots * 100 }
  })
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

export function recalculatePositionFromBatch(batch: TTradingBatch): StockPosition | undefined {
  let position = batch.openingPosition
    ? {
        ...batch.openingPosition,
        openedToday: false
      }
    : undefined

  for (const trade of batch.trades) {
    position = applyTradeToPosition(position, trade)
  }
  return position
}

export function calculateCostAdjustedProfit(
  batch: TTradingBatch,
  latestPositionQuantity: number,
  latestPositionCost: number
): number {
  let referenceCostBasis = (batch.openingPosition?.quantity ?? 0)
    * (batch.openingPosition?.cost ?? 0)

  for (const trade of batch.trades) {
    if (trade.purpose !== 'base') continue
    const amount = trade.price * trade.quantity
    const fees = totalTradeFees(trade.fees)
    referenceCostBasis += trade.side === 'buy'
      ? amount + fees
      : -amount + fees
  }

  return referenceCostBasis - latestPositionQuantity * latestPositionCost
}
