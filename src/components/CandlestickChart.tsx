import {
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type LineData,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { KlineBar } from '../shared/types'

interface CandlestickChartProps {
  bars: KlineBar[]
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

function intradayAveragePrice(bars: KlineBar[]): LineData[] {
  const result: LineData[] = []
  let cumulativeAmount = 0
  let cumulativeShares = 0

  for (const bar of bars) {
    cumulativeAmount += bar.amount
    cumulativeShares += bar.volume * 100
    if (cumulativeShares > 0) {
      result.push({ time: toTimestamp(bar.time), value: cumulativeAmount / cumulativeShares })
    }
  }

  return result
}

export default function CandlestickChart({ bars }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#64748b',
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 11
      },
      grid: {
        vertLines: { color: '#edf1f7' },
        horzLines: { color: '#edf1f7' }
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
        scaleMargins: { top: 0.08, bottom: 0.32 }
      },
      timeScale: {
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 10,
        tickMarkFormatter: timeLabel
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' },
        horzLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' }
      },
      localization: {
        timeFormatter: timeLabel,
        priceFormatter: (price: number) => price.toFixed(2)
      }
    })

    const priceLine = chart.addSeries(LineSeries, {
      color: '#3f7fd3',
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: '#64748b',
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderColor: '#3f7fd3',
      crosshairMarkerBackgroundColor: '#ffffff'
    })
    priceLine.setData(bars.map((bar) => ({
      time: toTimestamp(bar.time),
      value: bar.close
    })))

    const averagePriceLine = chart.addSeries(LineSeries, {
      color: '#d89414',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })
    averagePriceLine.setData(intradayAveragePrice(bars))

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } })
    volume.setData(bars.map((bar) => ({
      time: toTimestamp(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(220, 55, 66, 0.34)' : 'rgba(24, 146, 102, 0.34)'
    })))

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [bars])

  return <div className="candlestick-chart" ref={containerRef} />
}
