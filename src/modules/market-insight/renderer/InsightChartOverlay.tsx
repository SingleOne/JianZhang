import type { MarketInsightChartOverlay } from '../shared/types'

interface InsightChartOverlayProps {
  overlay: MarketInsightChartOverlay | null
}

export function InsightChartOverlay({ overlay }: InsightChartOverlayProps) {
  if (!overlay) return null
  return (
    <div className="insight-chart-overlay-legend" aria-label="市场观察图表叠加说明">
      <span>VWAP</span>
      {overlay.openingRange15.high !== null ? <span>开盘 15 分钟区间</span> : null}
      {overlay.tPlanLevels.length > 0 ? <span>既有 T 档位</span> : null}
    </div>
  )
}
