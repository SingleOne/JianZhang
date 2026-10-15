import { formatShares } from '../lib/format'
import type { TTrade } from '../shared/types'

export function TradeSplitSource({ trade }: { trade: TTrade }) {
  if (!trade.splitSource) return null
  return (
    <span title={`原成交编号：${trade.splitSource.id}`}>
      同笔成交拆分 · 原成交 {formatShares(trade.splitSource.quantity)}
    </span>
  )
}
