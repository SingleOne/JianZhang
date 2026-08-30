import {
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { getChartThemeColors } from '../lib/theme'
import type { FundsFlowPoint } from '../shared/types'

interface FundsFlowChartProps {
  points: FundsFlowPoint[]
}

function toTimestamp(value: string): UTCTimestamp {
  const [datePart, timePart] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000) as UTCTimestamp
}

function timeLabel(time: Time): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function flowLabel(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (absolute >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return value.toFixed(0)
}

export default function FundsFlowChart({ points }: FundsFlowChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resolvedTheme = useResolvedAppTheme()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = getChartThemeColors(resolvedTheme)

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 240,
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
      rightPriceScale: { borderColor: theme.border },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 7,
        tickMarkFormatter: timeLabel
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border },
        horzLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border }
      },
      localization: { timeFormatter: timeLabel, priceFormatter: flowLabel }
    })

    const mainFlow = chart.addSeries(LineSeries, {
      color: theme.purple,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3
    })
    mainFlow.setData(points.map((point) => ({ time: toTimestamp(point.time), value: point.main })))
    mainFlow.createPriceLine({
      price: 0,
      color: theme.text,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: ''
    })
    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [points, resolvedTheme])

  return <div className="funds-flow-chart" ref={containerRef} />
}
