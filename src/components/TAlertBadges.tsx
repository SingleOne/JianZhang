import { formatPrice } from '../lib/format'
import type { TAlertBadge } from '../lib/t-alerts'

interface TAlertBadgesProps {
  badges: readonly TAlertBadge[]
  compact?: boolean
  showTitle?: boolean
}

export function TAlertBadges({ badges, compact = false, showTitle = true }: TAlertBadgesProps) {
  if (badges.length === 0) return null

  return (
    <span
      className={`t-alert-badges ${compact ? 'is-compact' : ''}`}
      aria-label="当前 T 仓价格提醒"
    >
      {badges.map((badge) => (
        <span
          className={`t-alert-badge is-${badge.side}`}
          key={`${badge.side}-${badge.index}`}
          title={
            showTitle
              ? `${badge.side === 'buy' ? '买入' : '卖出'} ${badge.label}，目标价 ${formatPrice(badge.targetPrice)}`
              : undefined
          }
        >
          {badge.label}
        </span>
      ))}
    </span>
  )
}
