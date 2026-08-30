import {
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { formatAmount } from '../lib/format'
import { getChartThemeColors } from '../lib/theme'
import type { ShareholderCountPoint } from '../shared/types'

function toTimestamp(value: string): UTCTimestamp {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, 8) / 1000) as UTCTimestamp
}

function dateLabel(time: Time): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function changeText(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export default function ShareholderCountChart({ points }: { points: ShareholderCountPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const pointsByTimeRef = useRef(new Map<UTCTimestamp, ShareholderCountPoint>())
  const [hoveredPoint, setHoveredPoint] = useState<ShareholderCountPoint | null>(null)
  const resolvedTheme = useResolvedAppTheme()
  const displayedPoint = hoveredPoint ?? points.at(-1)
  pointsByTimeRef.current = new Map(points.map((point) => [toTimestamp(point.reportDate), point]))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = getChartThemeColors(resolvedTheme)
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 230,
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
        scaleMargins: { top: 0.16, bottom: 0.16 }
      },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 1,
        barSpacing: 24,
        fixRightEdge: true,
        tickMarkFormatter: dateLabel
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border },
        horzLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border }
      },
      localization: {
        timeFormatter: dateLabel,
        priceFormatter: (value: number) => Math.round(value).toLocaleString('zh-CN')
      }
    })
    chartRef.current = chart
    seriesRef.current = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (value: number) => Math.round(value).toLocaleString('zh-CN')
      },
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4
    })
    chart.subscribeCrosshairMove((parameter) => {
      setHoveredPoint(
        typeof parameter.time === 'number'
          ? (pointsByTimeRef.current.get(parameter.time as UTCTimestamp) ?? null)
          : null
      )
    })
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth })
    })
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [resolvedTheme])

  useEffect(() => {
    seriesRef.current?.setData(
      points.map((point) => ({ time: toTimestamp(point.reportDate), value: point.holderCount }))
    )
    chartRef.current?.timeScale().fitContent()
  }, [points, resolvedTheme])

  return (
    <div className="shareholder-count-chart">
      <div className="shareholder-count-chart-legend">
        <strong>{displayedPoint?.reportDate ?? '暂无报告期'}</strong>
        <span>股东户数 {formatAmount(displayedPoint?.holderCount)} 户</span>
        <span>较上期 {changeText(displayedPoint?.changePercent ?? null)}</span>
      </div>
      <div ref={containerRef} />
    </div>
  )
}
