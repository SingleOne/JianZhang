import { formatProfit } from '../lib/format'
import { getTriggeredTFloatingProfitAlert } from '../lib/t-alerts'
import type { TTradingBatch } from '../shared/types'

interface TFloatingProfitAlertBadgeProps {
  batch: TTradingBatch | undefined
  floatingProfit: number | null | undefined
  compact?: boolean
  showTitle?: boolean
}

export function TFloatingProfitAlertBadge({
  batch,
  floatingProfit,
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
            ? `当前浮动收益 ${formatProfit(floatingProfit)}，已达到 ${formatProfit(target)} 提醒值`
            : undefined
        }
      >
        {label}
      </span>
    </span>
  )
}
