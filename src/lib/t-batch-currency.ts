import type { StockMarket } from '../shared/stock-market'
import type { TTrade, TTradingBatch } from '../shared/types'
import { getTBatchDirection, getTradeBatchAllocationAmounts, roundMoney } from './t-trading'

export interface TBatchCnyMetrics {
  realizedProfit: number | null
  floatingProfit: number | null
  totalProfit: number | null
  priceContribution: number | null
  exchangeRateContribution: number | null
  missingHistoricalRate: boolean
  missingCurrentRate: boolean
  missingQuote: boolean
}

export function calculateTBatchCnyMetrics(
  batch: TTradingBatch,
  trades: readonly TTrade[],
  market: StockMarket,
  latestPrice: number | null | undefined,
  currentRate: number | null | undefined
): TBatchCnyMetrics {
  const direction = getTBatchDirection(batch)
  const openingSide = direction === 'forward' ? 'buy' : 'sell'
  const sign = direction === 'forward' ? 1 : -1
  let remainingQuantity = 0
  let nativeBasis = 0
  let cnyBasis = 0
  let cnyBasisComplete = true
  let realizedCny = 0
  let realizedPriceContribution = 0
  let realizedComplete = true
  let missingHistoricalRate = false

  for (const trade of trades) {
    const { tQuantity, tFees } = getTradeBatchAllocationAmounts(trade, batch)
    if (tQuantity <= 0) continue
    const gross = trade.price * tQuantity
    const opening = trade.side === openingSide
    const netAmount = opening ? gross + sign * tFees : gross - sign * tFees
    const rate = market === 'CN' ? 1 : trade.exchangeRate
    const validRate = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
    if (validRate === null) missingHistoricalRate = true

    if (opening) {
      remainingQuantity += tQuantity
      nativeBasis += netAmount
      if (validRate !== null) cnyBasis += netAmount * validRate
      else cnyBasisComplete = false
      continue
    }

    const allocatedNativeBasis = (nativeBasis / remainingQuantity) * tQuantity
    const allocatedCnyBasis = (cnyBasis / remainingQuantity) * tQuantity
    const nativeProfit = sign * (netAmount - allocatedNativeBasis)
    if (validRate !== null && cnyBasisComplete) {
      const cnyProfit = sign * (netAmount * validRate - allocatedCnyBasis)
      realizedCny += cnyProfit
      if (nativeBasis !== 0) {
        realizedPriceContribution += nativeProfit * (cnyBasis / nativeBasis)
      } else {
        realizedComplete = false
      }
    } else {
      realizedComplete = false
    }
    remainingQuantity -= tQuantity
    nativeBasis -= allocatedNativeBasis
    cnyBasis -= allocatedCnyBasis
    if (remainingQuantity <= 0.000_001) {
      remainingQuantity = 0
      nativeBasis = 0
      cnyBasis = 0
      cnyBasisComplete = true
    }
  }

  const missingQuote =
    remainingQuantity > 0 &&
    (latestPrice === null ||
      latestPrice === undefined ||
      !Number.isFinite(latestPrice) ||
      latestPrice <= 0)
  const missingCurrentRate =
    remainingQuantity > 0 &&
    (currentRate === null ||
      currentRate === undefined ||
      !Number.isFinite(currentRate) ||
      currentRate <= 0)
  const floatingComplete =
    remainingQuantity === 0 || (!missingQuote && !missingCurrentRate && cnyBasisComplete)
  const marketValue = (latestPrice ?? 0) * remainingQuantity
  const floatingCny =
    remainingQuantity === 0 ? 0 : sign * (marketValue * (currentRate ?? 0) - cnyBasis)
  const acquisitionRate = nativeBasis !== 0 ? cnyBasis / nativeBasis : null
  const floatingPriceContribution =
    remainingQuantity === 0
      ? 0
      : acquisitionRate === null
        ? null
        : sign * (marketValue - nativeBasis) * acquisitionRate
  const realizedProfit = realizedComplete ? roundMoney(realizedCny) : null
  const floatingProfit = floatingComplete ? roundMoney(floatingCny) : null
  const totalProfit =
    realizedProfit !== null && floatingProfit !== null
      ? roundMoney(realizedCny + floatingCny)
      : null
  const priceContribution =
    totalProfit !== null && floatingPriceContribution !== null
      ? roundMoney(realizedPriceContribution + floatingPriceContribution)
      : null

  return {
    realizedProfit,
    floatingProfit,
    totalProfit,
    priceContribution,
    exchangeRateContribution:
      totalProfit !== null && priceContribution !== null
        ? roundMoney(totalProfit - priceContribution)
        : null,
    missingHistoricalRate,
    missingCurrentRate,
    missingQuote
  }
}
