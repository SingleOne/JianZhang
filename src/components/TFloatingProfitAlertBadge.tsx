import { formatMoneyProfit } from '../lib/format'
import { getTriggeredTFloatingProfitAlert } from '../lib/t-alerts'
import type { TTradingBatch } from '../shared/types'
import type { StockCurrency } from '../shared/stock-market'

interface TFloatingProfitAlertBadgeProps {
  batch: TTradingBatch | undefined
  floatingProfit: number | null | undefined
  currency?: StockCurrency
  compact?: boolean
  showTitle?: boolean
}

export function TFloatingProfitAlertBadge({
  batch,
  floatingProfit,
  currency = 'CNY',
  compact = false,
  showTitle = true
}: TFloatingProfitAlertBadgeProps) {
  const direction = getTriggeredTFloatingProfitAlert(batch)
  if (!direction || !batch?.floatingProfitAlert) return null

  const label = direction === 'profit' ? '盈' : '亏'
  const target =
    direction === 'profit'
      ? batch.floatingProfitAlert.threshold
      : -batch.floatingProfitAlert.threshold
  return (
    <span
      className={`t-alert-badges t-floating-profit-alert-badges ${compact ? 'is-compact' : ''}`}
      aria-label={`T仓${direction === 'profit' ? '浮盈' : '浮亏'}提醒`}
    >
      <span
        className={`t-alert-badge is-${direction}`}
        title={
          showTitle
            ? `当前浮动收益 ${formatMoneyProfit(floatingProfit, currency)}，已达到 ${formatMoneyProfit(target, currency)} 提醒值`
            : undefined
        }
      >
        {label}
      </span>
    </span>
  )
}
