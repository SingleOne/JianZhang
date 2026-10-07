import type { TTradingBatch, TTrade } from '../shared/types'
import { calculateAccountTradeFees, type AccountTradeFeeContext } from './account-trade-fees'
import { calculateTBatchMetrics } from './t-trading'
import { tPlanTradablePrice } from './t-plan-prices'

/** 预测平仓时的费用来自预测账户，批次已发生成交费用仍使用真实流水。 */
export function calculateTBatchForecastMetrics(
  batch: TTradingBatch | undefined,
  trades: readonly TTrade[],
  latest: number | null | undefined,
  context: AccountTradeFeeContext,
  stampDutyExempt = false
) {
  const metrics = calculateTBatchMetrics(batch, trades, latest)
  const closingFee =
    metrics.remainingQuantity > 0 && latest != null && latest > 0
      ? calculateAccountTradeFees(context, {
          price: latest,
          quantity: metrics.remainingQuantity,
          side: metrics.direction === 'reverse' ? 'buy' : 'sell',
          stampDutyExempt
        }).total
      : 0
  const floatingProfit =
    metrics.floatingProfit === null ? null : metrics.floatingProfit - closingFee
  return {
    ...metrics,
    closingFee,
    floatingProfit,
    floatingProfitRate:
      floatingProfit !== null && metrics.remainingCostBasis > 0
        ? (floatingProfit / metrics.remainingCostBasis) * 100
        : null
  }
}

export function estimateTBreakEvenPrice(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  context: AccountTradeFeeContext,
  instrumentType?: 'stock' | 'etf'
): number | null {
  const metrics = calculateTBatchMetrics(batch, trades)
  if (metrics.averageCost === null || metrics.remainingQuantity <= 0) return null
  const side = metrics.direction === 'reverse' ? 'buy' : 'sell'
  const tick =
    context.scheme.market === 'HK'
      ? 0.001
      : instrumentType === 'etf' && context.scheme.market === 'CN'
        ? 0.001
        : 0.01
  const netProfit = (price: number) => {
    const fee = calculateAccountTradeFees(context, {
      price,
      quantity: metrics.remainingQuantity,
      side,
      stampDutyExempt: instrumentType === 'etf'
    }).total
    return (
      metrics.realizedProfit +
      (side === 'sell' ? price - metrics.averageCost! : metrics.averageCost! - price) *
        metrics.remainingQuantity -
      fee
    )
  }
  let low = 0
  let high = Math.max(metrics.averageCost * 2, 1)
  if (side === 'buy' && netProfit(0) < 0) return null
  for (
    let iteration = 0;
    iteration < 24 && (side === 'sell' ? netProfit(high) < 0 : netProfit(high) >= 0);
    iteration += 1
  )
    high *= 2
  if ((side === 'sell' && netProfit(high) < 0) || (side === 'buy' && netProfit(high) >= 0))
    return null
  // 单调区间搜索，避免见分进位边界让反 T 固定点迭代在两个价格之间振荡。
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2
    if (side === 'sell' ? netProfit(middle) >= 0 : netProfit(middle) < 0) high = middle
    else low = middle
  }
  const units = (side === 'sell' ? high : low) / tick
  const price = tPlanTradablePrice(
    (side === 'sell' ? Math.ceil(units - 1e-9) : Math.floor(units + 1e-9)) * tick,
    side,
    { market: context.scheme.market, instrumentType }
  )
  return price !== null && price > 0 && netProfit(price) >= -1e-7 ? price : null
}
