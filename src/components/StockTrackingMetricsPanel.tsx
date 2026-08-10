import { BarChart3 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import {
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  latestStockTrackingMetric
} from '../lib/stock-tracking-metrics'
import type { StockTrackingMetricSnapshot } from '../shared/types'

const StockTrackingMetricsChart = lazy(() => import('./StockTrackingMetricsChart'))

interface StockTrackingMetricsPanelProps {
  snapshots: StockTrackingMetricSnapshot[]
}

const CARDS = [
  { period: 5, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[5] },
  { period: 10, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[10] },
  { period: 20, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[20] }
] as const

function ratioText(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}x`
}

export function StockTrackingMetricsPanel({ snapshots }: StockTrackingMetricsPanelProps) {
  const latestDate = snapshots.at(-1)?.tradingDate

  return (
    <section className="stock-tracking-section stock-tracking-metrics-section">
      <div className="stock-tracking-section-title">
        <BarChart3 size={16} />
        <strong>量比追踪</strong>
        <small>{latestDate ? `更新至 ${latestDate}` : '等待首条日 K 记录'}</small>
      </div>
      <div className="stock-tracking-metric-cards">
        {CARDS.map(({ period, metricId }) => (
          <article key={period}>
            <small>{period}日量比</small>
            <strong>{ratioText(latestStockTrackingMetric(snapshots, metricId))}</strong>
            <span>当日成交量 ÷ 前 {period} 日均量</span>
          </article>
        ))}
      </div>
      {snapshots.length > 0 ? (
        <Suspense fallback={<div className="stock-tracking-metrics-loading">量比趋势加载中…</div>}>
          <StockTrackingMetricsChart snapshots={snapshots} />
        </Suspense>
      ) : (
        <div className="stock-tracking-metrics-empty">
          开始追踪后自动补取日 K，并按交易日保存 5日、10日、20日量比。
        </div>
      )}
      <p className="stock-tracking-metrics-note">
        追踪中每 30 分钟更新一次；应用重启后会根据日 K 补齐追踪期间的缺失日期。
      </p>
    </section>
  )
}
