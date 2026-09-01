import { BarChart3 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '../lib/format'
import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS,
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  latestStockTrackingMetric,
  stockTrackingPriceVolumeState
} from '../lib/stock-tracking-metrics'
import type {
  DailyKlineIndicator,
  KlineBar,
  StockMarket,
  StockTrackingMetricSnapshot
} from '../shared/types'
import { volumeUnitForMarket } from '../shared/stock-market'
import type { StockTrackingMarketData } from './useStockTrackingMarketData'

const StockTrackingMetricsChart = lazy(() => import('./StockTrackingMetricsChart'))
const StockTrackingPriceVolumeChart = lazy(() => import('./StockTrackingPriceVolumeChart'))
const StockTrackingRealtimeVolumeRatioChart = lazy(
  () => import('./StockTrackingRealtimeVolumeRatioChart')
)
const PeriodKlineChart = lazy(() => import('./PeriodKlineChart'))

type TrackingChart = 'priceVolume' | 'volumeRatio' | 'realtimeVolumeRatio' | 'dailyKline'

interface StockTrackingMetricsPanelProps {
  snapshots: StockTrackingMetricSnapshot[]
  market: StockMarket
  marketData?: StockTrackingMarketData
  showDailyKline?: boolean
  trackingStartedAt?: string
  trackingStoppedAt?: string
  bollingerBandsEnabled?: boolean
  onBollingerBandsEnabledChange?: (enabled: boolean) => void
  dailyKlineIndicator?: DailyKlineIndicator
  onDailyKlineIndicatorChange?: (indicator: DailyKlineIndicator) => void
}

const CARDS = [
  { period: 5, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[5] },
  { period: 10, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[10] },
  { period: 20, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[20] }
] as const

const ignoreBollingerChange = () => undefined
const ignoreDailyKlineIndicatorChange = () => undefined

function ratioText(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}x`
}

function directionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function dailyChangePercent(bars: readonly KlineBar[], bar: KlineBar | undefined): number | null {
  if (!bar) return null
  const index = bars.findIndex((item) => item.time === bar.time)
  if (index <= 0 || bars[index - 1].close === 0) return null
  return ((bar.close - bars[index - 1].close) / bars[index - 1].close) * 100
}

export function StockTrackingMetricsPanel({
  snapshots,
  market,
  marketData,
  showDailyKline = false,
  trackingStartedAt,
  trackingStoppedAt,
  bollingerBandsEnabled = false,
  onBollingerBandsEnabledChange,
  dailyKlineIndicator = 'none',
  onDailyKlineIndicatorChange
}: StockTrackingMetricsPanelProps) {
  const volumeUnit = volumeUnitForMarket(market)
  const [activeChart, setActiveChart] = useState<TrackingChart>('priceVolume')
  const [hoveredDailyBar, setHoveredDailyBar] = useState<KlineBar | null>(null)
  const latestSnapshot = snapshots.at(-1)
  const latestDate = latestSnapshot?.tradingDate
  const priceVolumeState = stockTrackingPriceVolumeState(latestSnapshot)
  const latestChange = latestSnapshot?.metrics[STOCK_TRACKING_BASE_METRICS.changePercent]
  const hasPriceVolumeData = snapshots.some(
    (snapshot) => snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close] !== undefined
  )
  const latestRealtimePoint = marketData?.realtimeVolumeRatioPoints.at(-1)
  const dailyBars = marketData?.dailyBars ?? []
  const displayedDailyBar = hoveredDailyBar ?? dailyBars.at(-1)
  const displayedDailyChange = dailyChangePercent(dailyBars, displayedDailyBar)

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
        {showDailyKline ? (
          <button
            className={activeChart === 'dailyKline' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeChart === 'dailyKline'}
            onClick={() => setActiveChart('dailyKline')}
          >
            日 K
          </button>
        ) : null}
      </div>
      <Suspense fallback={<div className="stock-tracking-metrics-loading">追踪趋势加载中…</div>}>
        {activeChart === 'dailyKline' ? (
          dailyBars.length ? (
            <div className="stock-tracking-daily-kline">
              <div className="stock-tracking-daily-kline-overview">
                <span>
                  <small>日期</small>
                  <strong>{displayedDailyBar?.time.slice(0, 10) ?? '--'}</strong>
                </span>
                <span>
                  <small>开盘</small>
                  <strong>{formatPrice(displayedDailyBar?.open)}</strong>
                </span>
                <span>
                  <small>收盘</small>
                  <strong>{formatPrice(displayedDailyBar?.close)}</strong>
                </span>
                <span>
                  <small>涨跌幅</small>
                  <strong className={directionClass(displayedDailyChange)}>
                    {formatPercent(displayedDailyChange)}
                  </strong>
                </span>
                <span>
                  <small>最高</small>
                  <strong>{formatPrice(displayedDailyBar?.high)}</strong>
                </span>
                <span>
                  <small>最低</small>
                  <strong>{formatPrice(displayedDailyBar?.low)}</strong>
                </span>
                <span>
                  <small>成交量</small>
                  <strong>{formatVolume(displayedDailyBar?.volume, volumeUnit)}</strong>
                </span>
                <span>
                  <small>成交额</small>
                  <strong>{formatAmount(displayedDailyBar?.amount)}</strong>
                </span>
                <span>
                  <small>换手率</small>
                  <strong>{formatPercent(displayedDailyBar?.turnoverRate)}</strong>
                </span>
              </div>
              <PeriodKlineChart
                bars={dailyBars}
                period="daily"
                market={market}
                onHoverBar={setHoveredDailyBar}
                bollingerBandsEnabled={bollingerBandsEnabled}
                onBollingerBandsEnabledChange={
                  onBollingerBandsEnabledChange ?? ignoreBollingerChange
                }
                dailyKlineIndicator={dailyKlineIndicator}
                onDailyKlineIndicatorChange={
                  onDailyKlineIndicatorChange ?? ignoreDailyKlineIndicatorChange
                }
                trackingStartedAt={trackingStartedAt}
                trackingStoppedAt={trackingStoppedAt}
                ctrlWheelZoomOnly
                height={320}
              />
            </div>
          ) : (
            <div className="stock-tracking-metrics-empty">
              {marketData?.realtimeLoading
                ? '正在加载日 K 数据…'
                : marketData?.realtimeError || '暂无日 K 数据。'}
            </div>
          )
        ) : activeChart === 'realtimeVolumeRatio' ? (
          marketData?.realtimeVolumeRatioPoints.length ? (
            <StockTrackingRealtimeVolumeRatioChart
              points={marketData.realtimeVolumeRatioPoints}
              market={market}
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
            <StockTrackingPriceVolumeChart snapshots={snapshots} market={market} />
          ) : (
            <div className="stock-tracking-metrics-empty">正在补齐量价历史数据…</div>
          )
        ) : (
          <StockTrackingMetricsChart snapshots={snapshots} />
        )}
      </Suspense>
      <p className="stock-tracking-metrics-note">
        图表请按住 Ctrl 并滚动鼠标滚轮进行横轴缩放。 日级追踪每 30 分钟更新；实时量比按交易时段每 30
        秒刷新，计算口径为累计成交量 ÷ 近5日平均成交量按已交易分钟折算值，
        {market === 'US' ? '按美股连续交易时段计算' : '午休不计时'}。
        连续三日量价背离会写入时间线并发送系统提醒。
      </p>
    </section>
  )
}
