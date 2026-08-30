import {
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import {
  CTRL_WHEEL_HANDLE_SCALE,
  CTRL_WHEEL_HANDLE_SCROLL,
  enableCtrlWheelZoom
} from '../lib/lightweight-chart-interactions'
import { STOCK_TRACKING_VOLUME_RATIO_METRICS } from '../lib/stock-tracking-metrics'
import { getChartThemeColors } from '../lib/theme'
import type { StockTrackingMetricSnapshot } from '../shared/types'

interface StockTrackingMetricsChartProps {
  snapshots: StockTrackingMetricSnapshot[]
}

const SERIES = [
  { period: 5, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[5], colorKey: 'red' },
  { period: 10, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[10], colorKey: 'amber' },
  { period: 20, metricId: STOCK_TRACKING_VOLUME_RATIO_METRICS[20], colorKey: 'accent' }
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

function ratioText(value: number | undefined): string {
  return value === undefined ? '--' : `${value.toFixed(2)}x`
}

export default function StockTrackingMetricsChart({ snapshots }: StockTrackingMetricsChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const snapshotsByTimeRef = useRef(new Map<UTCTimestamp, StockTrackingMetricSnapshot>())
  const [hoveredSnapshot, setHoveredSnapshot] = useState<StockTrackingMetricSnapshot | null>(null)
  const resolvedTheme = useResolvedAppTheme()
  const chartSnapshots = useMemo(
    () => [...snapshots].sort((left, right) => left.tradingDate.localeCompare(right.tradingDate)),
    [snapshots]
  )
  const displayedSnapshot = hoveredSnapshot ?? chartSnapshots.at(-1)
  const legendTheme = getChartThemeColors(resolvedTheme)
  snapshotsByTimeRef.current = new Map(
    chartSnapshots.map((snapshot) => [toTimestamp(snapshot.tradingDate), snapshot])
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = getChartThemeColors(resolvedTheme)
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 250,
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
        scaleMargins: { top: 0.14, bottom: 0.14 }
      },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 1,
        barSpacing: 9,
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
        priceFormatter: (price: number) => `${price.toFixed(2)}x`
      }
    })
    chartRef.current = chart
    const seriesByMetric = new Map<string, ISeriesApi<'Line'>>()
    seriesRef.current = seriesByMetric

    for (const definition of SERIES) {
      const series = chart.addSeries(LineSeries, {
        color: theme[definition.colorKey],
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}x` },
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true
      })
      seriesByMetric.set(definition.metricId, series)
    }
    seriesByMetric.get(STOCK_TRACKING_VOLUME_RATIO_METRICS[20])?.createPriceLine({
      price: 1,
      color: theme.text,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '基准'
    })

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
      seriesByMetric.clear()
      chart.remove()
      chartRef.current = null
    }
  }, [resolvedTheme])

  useEffect(() => {
    for (const definition of SERIES) {
      seriesRef.current.get(definition.metricId)?.setData(
        chartSnapshots.flatMap((snapshot) => {
          const value = snapshot.metrics[definition.metricId]
          return value === undefined ? [] : [{ time: toTimestamp(snapshot.tradingDate), value }]
        })
      )
    }
    chartRef.current?.timeScale().fitContent()
  }, [chartSnapshots, resolvedTheme])

  return (
    <div className="stock-tracking-metrics-chart">
      <div className="stock-tracking-metrics-chart-legend">
        <strong>{displayedSnapshot?.tradingDate ?? '暂无日期'}</strong>
        {SERIES.map((definition) => (
          <span
            style={{ '--metric-color': legendTheme[definition.colorKey] } as CSSProperties}
            key={definition.period}
          >
            {definition.period}日 {ratioText(displayedSnapshot?.metrics[definition.metricId])}
          </span>
        ))}
      </div>
      <div ref={containerRef} />
    </div>
  )
}
