import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { KlineBar, KlinePeriod } from '../shared/types'

interface PeriodKlineChartProps {
  bars: KlineBar[]
  period: Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>
}

function toTimestamp(value: string): UTCTimestamp {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, 8) / 1000) as UTCTimestamp
}

function dateLabel(time: Time, period: PeriodKlineChartProps['period']): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return period === 'monthly' ? `${year}-${month}` : `${month}-${day}`
}

export default function PeriodKlineChart({ bars, period }: PeriodKlineChartProps) {
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
        scaleMargins: { top: 0.08, bottom: 0.3 }
      },
      timeScale: {
        borderColor: '#e2e8f0',
        rightOffset: 2,
        barSpacing: period === 'monthly' ? 9 : 7,
        tickMarkFormatter: (time: Time) => dateLabel(time, period)
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' },
        horzLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' }
      },
      localization: {
        timeFormatter: (time: Time) => dateLabel(time, period),
        priceFormatter: (price: number) => price.toFixed(2)
      }
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#dc3742',
      downColor: '#189266',
      borderUpColor: '#dc3742',
      borderDownColor: '#189266',
      wickUpColor: '#dc3742',
      wickDownColor: '#189266',
      priceLineVisible: true,
      lastValueVisible: true
    })
    candles.setData(bars.map((bar) => ({
      time: toTimestamp(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    })))

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
  }, [bars, period])

  return <div className="period-kline-chart" ref={containerRef} />
}
