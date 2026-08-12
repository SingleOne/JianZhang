import { BarChart3 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { formatPercent, formatPrice } from '../lib/format'
import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS,
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  latestStockTrackingMetric,
  stockTrackingPriceVolumeState
} from '../lib/stock-tracking-metrics'
import type { StockTrackingMetricSnapshot } from '../shared/types'
import type { StockTrackingMarketData } from './useStockTrackingMarketData'

const StockTrackingMetricsChart = lazy(() => import('./StockTrackingMetricsChart'))
const StockTrackingPriceVolumeChart = lazy(() => import('./StockTrackingPriceVolumeChart'))
const StockTrackingRealtimeVolumeRatioChart = lazy(
  () => import('./StockTrackingRealtimeVolumeRatioChart')
)

type TrackingChart = 'priceVolume' | 'volumeRatio' | 'realtimeVolumeRatio'

interface StockTrackingMetricsPanelProps {
  snapshots: StockTrackingMetricSnapshot[]
  marketData?: StockTrackingMarketData
}

const CARDS = [
  { period: 5, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[5] },
  { period: 10, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[10] },
  { period: 20, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[20] }
] as const

function ratioText(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}x`
}

function directionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function StockTrackingMetricsPanel({
  snapshots,
  marketData
}: StockTrackingMetricsPanelProps) {
  const [activeChart, setActiveChart] = useState<TrackingChart>('priceVolume')
  const latestSnapshot = snapshots.at(-1)
  const latestDate = latestSnapshot?.tradingDate
  const priceVolumeState = stockTrackingPriceVolumeState(latestSnapshot)
  const latestChange = latestSnapshot?.metrics[STOCK_TRACKING_BASE_METRICS.changePercent]
  const hasPriceVolumeData = snapshots.some(
    (snapshot) => snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close] !== undefined
  )
  const latestRealtimePoint = marketData?.realtimeVolumeRatioPoints.at(-1)

  return (
    <section className="stock-tracking-section stock-tracking-metrics-section">
      <div className="stock-tracking-section-title">
        <BarChart3 size={16} />
        <strong>量价与量比追踪</strong>
        <small>{latestDate ? `更新至 ${latestDate}` : '等待首条日 K 记录'}</small>
      </div>
      <div className="stock-tracking-metric-cards">
        <article className={`is-state-${priceVolumeState}`}>
          <small>当前量价状态</small>
          <strong>{STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS[priceVolumeState]}</strong>
          <span>
            {formatPrice(latestSnapshot?.metrics[STOCK_TRACKING_BASE_METRICS.close] ?? null)}{' '}
            <em className={directionClass(latestChange)}>{formatPercent(latestChange)}</em>
          </span>
        </article>
        {CARDS.map(({ period, metricId }) => (
          <article key={period}>
            <small>{period}日量比</small>
            <strong>{ratioText(latestStockTrackingMetric(snapshots, metricId))}</strong>
            <span>当日成交量 ÷ 前 {period} 日均量</span>
          </article>
        ))}
        <article className="is-realtime-volume-ratio">
          <small>实时量比</small>
          <strong>{ratioText(latestRealtimePoint?.ratio ?? null)}</strong>
          <span>
            {latestRealtimePoint
              ? `${marketData?.realtimeTradingDate} ${latestRealtimePoint.time.slice(11, 16)}`
              : marketData?.realtimeLoading
                ? '实时数据加载中…'
                : '等待当日分时数据'}
          </span>
        </article>
      </div>
      <div className="stock-tracking-chart-tabs" role="tablist" aria-label="追踪指标图表">
        <button
          className={activeChart === 'priceVolume' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeChart === 'priceVolume'}
          onClick={() => setActiveChart('priceVolume')}
        >
          量价趋势
        </button>
        <button
          className={activeChart === 'volumeRatio' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeChart === 'volumeRatio'}
          onClick={() => setActiveChart('volumeRatio')}
        >
          量比趋势
        </button>
        <button
          className={activeChart === 'realtimeVolumeRatio' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeChart === 'realtimeVolumeRatio'}
          onClick={() => setActiveChart('realtimeVolumeRatio')}
        >
          实时量比
        </button>
      </div>
      <Suspense fallback={<div className="stock-tracking-metrics-loading">追踪趋势加载中…</div>}>
        {activeChart === 'realtimeVolumeRatio' ? (
          marketData?.realtimeVolumeRatioPoints.length ? (
            <StockTrackingRealtimeVolumeRatioChart
              points={marketData.realtimeVolumeRatioPoints}
              intervalMinutes={marketData.realtimeIntervalMinutes}
              fallbackReason={marketData.realtimeFallbackReason}
            />
          ) : (
            <div className="stock-tracking-metrics-empty">
              {marketData?.realtimeLoading
                ? '正在加载当日分时数据与近5日成交量…'
                : marketData?.realtimeError || '暂无可计算的当日实时量比数据。'}
            </div>
          )
        ) : snapshots.length === 0 ? (
          <div className="stock-tracking-metrics-empty">
            开始追踪后自动补取日 K，并按交易日保存价格、成交量和 5日、10日、20日量比。
          </div>
        ) : activeChart === 'priceVolume' ? (
          hasPriceVolumeData ? (
            <StockTrackingPriceVolumeChart snapshots={snapshots} />
          ) : (
            <div className="stock-tracking-metrics-empty">正在补齐量价历史数据…</div>
          )
        ) : (
          <StockTrackingMetricsChart snapshots={snapshots} />
        )}
      </Suspense>
      <p className="stock-tracking-metrics-note">
        日级追踪每 30 分钟更新；实时量比按交易时段每 30 秒刷新，计算口径为累计成交量 ÷
        近5日平均成交量按已交易分钟折算值，午休不计时。连续三日量价背离会写入时间线并发送系统提醒。
      </p>
    </section>
  )
}
