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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { formatVolume } from '../lib/format'
import {
  CTRL_WHEEL_HANDLE_SCALE,
  CTRL_WHEEL_HANDLE_SCROLL,
  enableCtrlWheelZoom
} from '../lib/lightweight-chart-interactions'
import type { RealtimeVolumeRatioPoint } from '../lib/stock-tracking-metrics'
import { getChartThemeColors } from '../lib/theme'
import type { StockMarket } from '../shared/types'
import { volumeUnitForMarket } from '../shared/stock-market'

interface StockTrackingRealtimeVolumeRatioChartProps {
  points: RealtimeVolumeRatioPoint[]
  market: StockMarket
  intervalMinutes?: 1 | 5
  fallbackReason?: string
}

function toTimestamp(value: string): UTCTimestamp {
  const [date, clock] = value.split(' ')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000) as UTCTimestamp
}

function timeLabel(time: Time): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function pointTimeLabel(point: RealtimeVolumeRatioPoint | undefined): string {
  return point?.time.slice(11, 16) ?? '暂无时间'
}

export default function StockTrackingRealtimeVolumeRatioChart({
  points,
  market,
  intervalMinutes,
  fallbackReason
}: StockTrackingRealtimeVolumeRatioChartProps) {
  const volumeUnit = volumeUnitForMarket(market)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const pointsByTimeRef = useRef(new Map<UTCTimestamp, RealtimeVolumeRatioPoint>())
  const [hoveredPoint, setHoveredPoint] = useState<RealtimeVolumeRatioPoint | null>(null)
  const resolvedTheme = useResolvedAppTheme()
  const chartPoints = useMemo(
    () => [...points].sort((left, right) => left.time.localeCompare(right.time)),
    [points]
  )
  const displayedPoint = hoveredPoint ?? chartPoints.at(-1)
  pointsByTimeRef.current = new Map(chartPoints.map((point) => [toTimestamp(point.time), point]))

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
        barSpacing: 5,
        fixRightEdge: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: timeLabel
      },
      handleScroll: CTRL_WHEEL_HANDLE_SCROLL,
      handleScale: CTRL_WHEEL_HANDLE_SCALE,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border },
        horzLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border }
      },
      localization: {
        timeFormatter: timeLabel,
        priceFormatter: (price: number) => `${price.toFixed(2)}x`
      }
    })
    chartRef.current = chart
    const series = chart.addSeries(LineSeries, {
      color: theme.purple,
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}x` },
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true
    })
    series.createPriceLine({
      price: 1,
      color: theme.text,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '基准'
    })
    seriesRef.current = series

    chart.subscribeCrosshairMove((parameter) => {
      const time = parameter.time
      setHoveredPoint(typeof time === 'number' ? (pointsByTimeRef.current.get(time) ?? null) : null)
    })
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth })
    })
    resizeObserver.observe(container)
    const disableCtrlWheelZoom = enableCtrlWheelZoom(
      chart,
      container,
      () => pointsByTimeRef.current.size
    )

    return () => {
      disableCtrlWheelZoom()
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [resolvedTheme])

  useEffect(() => {
    seriesRef.current?.setData(
      chartPoints.map((point) => ({ time: toTimestamp(point.time), value: point.ratio }))
    )
    chartRef.current?.timeScale().fitContent()
  }, [chartPoints, resolvedTheme])

  return (
    <div className="stock-tracking-metrics-chart stock-tracking-realtime-volume-ratio-chart">
      <div className="stock-tracking-realtime-volume-ratio-legend">
        <strong>{pointTimeLabel(displayedPoint)}</strong>
        <span>
          实时量比 <em>{displayedPoint ? `${displayedPoint.ratio.toFixed(2)}x` : '--'}</em>
        </span>
        <span>累计量 {formatVolume(displayedPoint?.cumulativeVolume, volumeUnit)}</span>
        <span>进度预期量 {formatVolume(displayedPoint?.expectedVolume, volumeUnit)}</span>
        {intervalMinutes === 5 ? <i title={fallbackReason}>5分钟备用行情</i> : null}
      </div>
      <div ref={containerRef} />
    </div>
  )
}
