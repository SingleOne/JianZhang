import { formatShares } from '../lib/format'
import type { TTrade } from '../shared/types'

export function TradeSplitSource({
  trade,
  showTitle = true
}: {
  trade: TTrade
  showTitle?: boolean
}) {
  if (!trade.splitSource) return null
  return (
    <span title={showTitle ? `原成交编号：${trade.splitSource.id}` : undefined}>
      同笔成交拆分 · 原成交 {formatShares(trade.splitSource.quantity)}
    </span>
  )
}
