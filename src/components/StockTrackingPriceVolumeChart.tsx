import {
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '../lib/format'
import {
  CTRL_WHEEL_HANDLE_SCALE,
  CTRL_WHEEL_HANDLE_SCROLL,
  enableCtrlWheelZoom
} from '../lib/lightweight-chart-interactions'
import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_AVERAGE_METRICS,
  STOCK_TRACKING_PRICE_RETURN_METRICS,
  STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS,
  STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS,
  STOCK_TRACKING_VOLUME_AVERAGE_METRICS,
  stockTrackingPriceVolumeDivergence,
  stockTrackingPriceVolumeState,
  stockTrackingTechnicalPatternSignals
} from '../lib/stock-tracking-metrics'
import { getChartThemeColors, type ChartThemeColors } from '../lib/theme'
import { TECHNICAL_PATTERN_SIGNAL_LABELS } from '../shared/technical-patterns'
import type { StockMarket, StockTrackingMetricSnapshot } from '../shared/types'
import { volumeUnitForMarket } from '../shared/stock-market'

interface StockTrackingPriceVolumeChartProps {
  snapshots: StockTrackingMetricSnapshot[]
  market: StockMarket
}

const PRICE_AVERAGES = [
  { period: 5, metricId: STOCK_TRACKING_PRICE_AVERAGE_METRICS[5], colorKey: 'red' },
  { period: 10, metricId: STOCK_TRACKING_PRICE_AVERAGE_METRICS[10], colorKey: 'amber' },
  { period: 20, metricId: STOCK_TRACKING_PRICE_AVERAGE_METRICS[20], colorKey: 'accent' }
] as const

const VOLUME_AVERAGES = [
  { period: 5, metricId: STOCK_TRACKING_VOLUME_AVERAGE_METRICS[5], colorKey: 'red' },
  { period: 10, metricId: STOCK_TRACKING_VOLUME_AVERAGE_METRICS[10], colorKey: 'amber' },
  { period: 20, metricId: STOCK_TRACKING_VOLUME_AVERAGE_METRICS[20], colorKey: 'accent' }
] as const

function toTimestamp(value: string): UTCTimestamp {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, 8) / 1000) as UTCTimestamp
}

function dateLabel(time: Time): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function directionClass(value: number | undefined): string {
  if (value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function stateMarkers(
  snapshot: StockTrackingMetricSnapshot,
  theme: ChartThemeColors
): SeriesMarker<Time>[] {
  const time = toTimestamp(snapshot.tradingDate)
  const markers: SeriesMarker<Time>[] = []
  const divergence = stockTrackingPriceVolumeDivergence(snapshot)
  if (divergence) {
    markers.push({
      time,
      position: 'aboveBar',
      shape: 'arrowDown',
      color: theme.purple,
      text: STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS[divergence],
      size: 1
    })
  }
  const state = stockTrackingPriceVolumeState(snapshot)
  if (state !== 'neutral') {
    const rising =
      state === 'volumeSurgePriceRise' ||
      state === 'volumeRisePriceRise' ||
      state === 'volumeFallPriceRise'
    const expanded =
      state === 'volumeSurgePriceRise' ||
      state === 'volumeSurgePriceFall' ||
      state === 'volumeRisePriceRise' ||
      state === 'volumeRisePriceFall'
    markers.push({
      time,
      position: rising ? 'belowBar' : 'aboveBar',
      shape: expanded ? (rising ? 'arrowUp' : 'arrowDown') : 'circle',
      color: rising ? (expanded ? theme.red : theme.amber) : expanded ? theme.green : theme.accent,
      text: STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS[state],
      size: 0.8
    })
  }

  for (const signal of stockTrackingTechnicalPatternSignals(snapshot)) {
    const upperSignal = signal === 'longUpperShadow'
    const lowerSignal = signal === 'longLowerShadow'
    markers.push({
      time,
      position: upperSignal ? 'aboveBar' : 'belowBar',
      shape: upperSignal ? 'arrowDown' : lowerSignal ? 'arrowUp' : 'circle',
      color: upperSignal
        ? theme.green
        : lowerSignal
          ? theme.red
          : signal === 'bollingerExpansion'
            ? theme.purple
            : theme.amber,
      text: TECHNICAL_PATTERN_SIGNAL_LABELS[signal],
      size: 0.8
    })
  }
  return markers
}

export default function StockTrackingPriceVolumeChart({
  snapshots,
  market
}: StockTrackingPriceVolumeChartProps) {
  const volumeUnit = volumeUnitForMarket(market)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const closeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const priceAverageSeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const volumeAverageSeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const setMarkersRef = useRef<(markers: SeriesMarker<Time>[]) => void>(() => {})
  const snapshotsByTimeRef = useRef(new Map<UTCTimestamp, StockTrackingMetricSnapshot>())
  const [hoveredSnapshot, setHoveredSnapshot] = useState<StockTrackingMetricSnapshot | null>(null)
  const resolvedTheme = useResolvedAppTheme()
  const chartSnapshots = useMemo(
    () =>
      [...snapshots]
        .filter((snapshot) => snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close] !== undefined)
        .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate)),
    [snapshots]
  )
  const displayedSnapshot = hoveredSnapshot ?? chartSnapshots.at(-1)
  const legendTheme = getChartThemeColors(resolvedTheme)
  const displayedMetrics = displayedSnapshot?.metrics
  const displayedState = stockTrackingPriceVolumeState(displayedSnapshot)
  const displayedTechnicalSignals = stockTrackingTechnicalPatternSignals(displayedSnapshot)
  snapshotsByTimeRef.current = new Map(
    chartSnapshots.map((snapshot) => [toTimestamp(snapshot.tradingDate), snapshot])
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = getChartThemeColors(resolvedTheme)
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 350,
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.text,
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 12
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid }
      },
      rightPriceScale: {
        borderColor: theme.border,
        scaleMargins: { top: 0.1, bottom: 0.3 }
      },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 1,
        barSpacing: 8,
        fixRightEdge: true,
        tickMarkFormatter: dateLabel
      },
      handleScroll: CTRL_WHEEL_HANDLE_SCROLL,
      handleScale: CTRL_WHEEL_HANDLE_SCALE,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border },
        horzLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border }
      },
      localization: {
        timeFormatter: dateLabel,
        priceFormatter: (price: number) => formatPrice(price)
      }
    })
    chartRef.current = chart

    const closeSeries = chart.addSeries(LineSeries, {
      color: theme.text,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true
    })
    closeSeriesRef.current = closeSeries
    const markers = createSeriesMarkers(closeSeries, [])
    setMarkersRef.current = (nextMarkers) => markers.setMarkers(nextMarkers)

    const priceAverageSeries = new Map<string, ISeriesApi<'Line'>>()
    priceAverageSeriesRef.current = priceAverageSeries
    for (const definition of PRICE_AVERAGES) {
      const series = chart.addSeries(LineSeries, {
        color: theme[definition.colorKey],
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      priceAverageSeries.set(definition.metricId, series)
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } })
    volumeSeriesRef.current = volumeSeries

    const volumeAverageSeries = new Map<string, ISeriesApi<'Line'>>()
    volumeAverageSeriesRef.current = volumeAverageSeries
    for (const definition of VOLUME_AVERAGES) {
      const series = chart.addSeries(LineSeries, {
        color: theme[definition.colorKey],
        lineWidth: 1,
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      volumeAverageSeries.set(definition.metricId, series)
    }

    chart.subscribeCrosshairMove((parameter) => {
      const time = parameter.time
      setHoveredSnapshot(
        typeof time === 'number' ? (snapshotsByTimeRef.current.get(time) ?? null) : null
      )
    })
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth })
    })
    resizeObserver.observe(container)
    const disableCtrlWheelZoom = enableCtrlWheelZoom(
      chart,
      container,
      () => snapshotsByTimeRef.current.size
    )

    return () => {
      disableCtrlWheelZoom()
      resizeObserver.disconnect()
      priceAverageSeries.clear()
      volumeAverageSeries.clear()
      chart.remove()
      closeSeriesRef.current = null
      volumeSeriesRef.current = null
      chartRef.current = null
      setMarkersRef.current = () => {}
    }
  }, [resolvedTheme])

  useEffect(() => {
    const theme = getChartThemeColors(resolvedTheme)
    closeSeriesRef.current?.setData(
      chartSnapshots.map((snapshot) => ({
        time: toTimestamp(snapshot.tradingDate),
        value: snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close]
      }))
    )
    volumeSeriesRef.current?.setData(
      chartSnapshots.map((snapshot) => ({
        time: toTimestamp(snapshot.tradingDate),
        value: snapshot.metrics[STOCK_TRACKING_BASE_METRICS.volume] ?? 0,
        color:
          (snapshot.metrics[STOCK_TRACKING_BASE_METRICS.changePercent] ?? 0) >= 0
            ? `${theme.red}85`
            : `${theme.green}85`
      }))
    )
    for (const definition of PRICE_AVERAGES) {
      priceAverageSeriesRef.current.get(definition.metricId)?.setData(
        chartSnapshots.flatMap((snapshot) => {
          const value = snapshot.metrics[definition.metricId]
          return value === undefined ? [] : [{ time: toTimestamp(snapshot.tradingDate), value }]
        })
      )
    }
    for (const definition of VOLUME_AVERAGES) {
      volumeAverageSeriesRef.current.get(definition.metricId)?.setData(
        chartSnapshots.flatMap((snapshot) => {
          const value = snapshot.metrics[definition.metricId]
          return value === undefined ? [] : [{ time: toTimestamp(snapshot.tradingDate), value }]
        })
      )
    }
    setMarkersRef.current(
      chartSnapshots.slice(-120).flatMap((snapshot) => stateMarkers(snapshot, theme))
    )
    const lastIndex = chartSnapshots.length - 1
    if (lastIndex >= 0) {
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, lastIndex - 79),
        to: lastIndex + 1
      })
    }
  }, [chartSnapshots, resolvedTheme])

  return (
    <div className="stock-tracking-metrics-chart stock-tracking-price-volume-chart">
      <div className="stock-tracking-price-volume-legend">
        <strong>{displayedSnapshot?.tradingDate ?? '暂无日期'}</strong>
        <span>
          收盘 {formatPrice(displayedMetrics?.[STOCK_TRACKING_BASE_METRICS.close] ?? null)}
          <em
            className={directionClass(
              displayedMetrics?.[STOCK_TRACKING_BASE_METRICS.changePercent]
            )}
          >
            {formatPercent(displayedMetrics?.[STOCK_TRACKING_BASE_METRICS.changePercent])}
          </em>
        </span>
        <span>
          成交量{' '}
          {formatVolume(displayedMetrics?.[STOCK_TRACKING_BASE_METRICS.volume] ?? null, volumeUnit)}
        </span>
        <span>
          成交额 {formatAmount(displayedMetrics?.[STOCK_TRACKING_BASE_METRICS.amount] ?? null)}
        </span>
        <div className="stock-tracking-price-volume-tags">
          <em className={`is-${displayedState}`}>
            {STOCK_TRACKING_PRICE_VOLUME_STATE_LABELS[displayedState]}
          </em>
          {displayedTechnicalSignals.map((signal) => (
            <em className={`is-${signal}`} key={signal}>
              {TECHNICAL_PATTERN_SIGNAL_LABELS[signal]}
            </em>
          ))}
        </div>
      </div>
      <div className="stock-tracking-price-average-legend">
        {PRICE_AVERAGES.map((definition) => (
          <span style={{ color: legendTheme[definition.colorKey] }} key={definition.period}>
            MA{definition.period} {formatPrice(displayedMetrics?.[definition.metricId] ?? null)}
          </span>
        ))}
        {[5, 10, 20].map((period) => {
          const metricId = STOCK_TRACKING_PRICE_RETURN_METRICS[period as 5 | 10 | 20]
          const value = displayedMetrics?.[metricId]
          return (
            <span key={`return-${period}`}>
              {period}日涨幅 <em className={directionClass(value)}>{formatPercent(value)}</em>
            </span>
          )
        })}
      </div>
      <div ref={containerRef} />
    </div>
  )
}
