import {
  calculateAccountTradeFees,
  getAccountTradeFeeContext,
  type AccountFeeState
} from '../../../lib/account-trade-fees'
import type { WatchStock } from '../../../shared/types'
import { marketFromQuoteId, type StockMarket } from '../../../shared/stock-market'
import type { AiTradeImportItem } from './types'

export function tradeImportItemMarket(item: AiTradeImportItem): StockMarket | undefined {
  if (item.quoteId) return marketFromQuoteId(item.quoteId)
  if (item.currency === 'CNY') return 'CN'
  if (item.currency === 'HKD') return 'HK'
  if (item.currency === 'USD') return 'US'
  return undefined
}

export function defaultTradeImportTime(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(' ', 'T')
  if (normalized && /^\d{4}-\d{2}-\d{2}T?$/.test(normalized)) {
    return `${normalized.slice(0, 10)}T09:30`
  }
  return normalized
}

export function fillTradeImportDefaults(
  state: AccountFeeState & { watchlist: WatchStock[] },
  item: AiTradeImportItem,
  recalculateFees = false
): AiTradeImportItem {
  const next = { ...item, occurredAt: defaultTradeImportTime(item.occurredAt) }
  if (next.kind !== 'trade') return next
  if (!recalculateFees && next.fees !== undefined) {
    next.feeSource ??= 'actual'
    return next
  }
  next.fees = undefined
  next.feeSource = undefined
  next.feeEstimate = undefined
  if (
    !next.quoteId ||
    !next.accountId ||
    !next.side ||
    !Number.isFinite(next.price) ||
    (next.price ?? 0) <= 0 ||
    !Number.isFinite(next.quantity) ||
    (next.quantity ?? 0) <= 0
  )
    return next

  try {
    const result = calculateAccountTradeFees(
      getAccountTradeFeeContext(state, next.accountId, next.quoteId),
      {
        price: next.price!,
        quantity: next.quantity!,
        side: next.side,
        tradeDate:
          next.occurredAt && /^\d{4}-\d{2}-\d{2}T/.test(next.occurredAt)
            ? next.occurredAt.slice(0, 10)
            : '',
        stampDutyExempt:
          state.watchlist.find((stock) => stock.quoteId === next.quoteId)?.instrumentType === 'etf'
      }
    )
    next.fees = result.total
    next.feeSource = 'estimated'
    next.feeEstimate = {
      fees: result.fees,
      feeItems: result.feeItems,
      feeTemplate: result.feeTemplate
    }
  } catch (reason) {
    next.issues = [
      ...next.issues,
      {
        severity: 'warning',
        field: 'fees',
        message: `费用模板计算失败，请手动填写实际费用：${reason instanceof Error ? reason.message : '无法计算'}`
      }
    ]
  }
  return next
}
