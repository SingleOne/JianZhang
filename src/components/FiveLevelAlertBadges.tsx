import { formatPrice } from '../lib/format'
import type { FiveLevelLargeOrderAlert } from '../shared/types'

interface FiveLevelAlertBadgesProps {
  alerts: readonly FiveLevelLargeOrderAlert[] | undefined
  compact?: boolean
}

function formatVolume(volume: number): string {
  return volume >= 10_000 ? `${(volume / 10_000).toFixed(2)}万` : volume.toLocaleString('zh-CN')
}

export function FiveLevelAlertBadges({ alerts, compact = false }: FiveLevelAlertBadgesProps) {
  if (!alerts?.length) return null

  return (
    <span
      className={`t-alert-badges five-level-alert-badges ${compact ? 'is-compact' : ''}`}
      aria-label="五档盘口明显大单提醒"
    >
      {alerts.map((alert) => {
        const sideLabel = alert.side === 'buy' ? '买' : '卖'
        return (
          <span
            className={`t-alert-badge five-level-alert-badge is-${alert.side}`}
            key={alert.side}
            title={`${sideLabel}${alert.level}明显大单，价格 ${formatPrice(alert.price)}，该档挂单量 ${formatVolume(alert.volume)}，其余四档合计 ${formatVolume(alert.otherLevelsVolume)}`}
          >
            五
          </span>
        )
      })}
    </span>
  )
}
