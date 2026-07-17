import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { KlineBar, KlinePeriod } from '../shared/types'

type HistoricalPeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface PeriodKlineChartProps {
  bars: KlineBar[]
  period: HistoricalPeriod
  onHoverBar?: (bar: KlineBar | null) => void
  onRequestMore?: (period: HistoricalPeriod) => void
}

function toTimestamp(value: string): UTCTimestamp {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, 8) / 1000) as UTCTimestamp
}

function dateLabel(time: Time, period: HistoricalPeriod): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return period === 'monthly' ? `${year}-${month}` : `${month}-${day}`
}

const INITIAL_VISIBLE_BARS: Record<HistoricalPeriod, number> = {
  daily: 80,
  weekly: 60,
  monthly: 40
}

export default function PeriodKlineChart({
  bars,
  period,
  onHoverBar,
  onRequestMore
}: PeriodKlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const barsByTimeRef = useRef(new Map<UTCTimestamp, KlineBar>())
  const dataLengthRef = useRef(0)
  const lastRequestedLengthRef = useRef(-1)
  const isAligningRangeRef = useRef(false)
  const onHoverBarRef = useRef(onHoverBar)
  const onRequestMoreRef = useRef(onRequestMore)
  onHoverBarRef.current = onHoverBar
  onRequestMoreRef.current = onRequestMore

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
        rightOffset: 0,
        barSpacing: period === 'monthly' ? 9 : 7,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time) => dateLabel(time, period)
      },
      handleScroll: false,
      handleScale: true,
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
    chartRef.current = chart

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
    candlesRef.current = candles

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } })
    volumeRef.current = volume

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      onHoverBarRef.current?.(
        typeof param.time === 'number' ? barsByTimeRef.current.get(param.time as UTCTimestamp) ?? null : null
      )
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)

    const handleVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || isAligningRangeRef.current || dataLengthRef.current === 0) return
      const latestEdge = dataLengthRef.current - 0.5
      const visibleSpan = Math.max(5, range.to - range.from)
      const alignedFrom = latestEdge - visibleSpan

      if (alignedFrom < 12 && lastRequestedLengthRef.current !== dataLengthRef.current) {
        lastRequestedLengthRef.current = dataLengthRef.current
        onRequestMoreRef.current?.(period)
      }

      if (Math.abs(range.to - latestEdge) > 0.05) {
        isAligningRangeRef.current = true
        chart.timeScale().setVisibleLogicalRange({ from: alignedFrom, to: latestEdge })
        requestAnimationFrame(() => { isAligningRangeRef.current = false })
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      onHoverBarRef.current?.(null)
      chart.remove()
      chartRef.current = null
      candlesRef.current = null
      volumeRef.current = null
    }
  }, [period])

  useEffect(() => {
    const chart = chartRef.current
    const candles = candlesRef.current
    const volume = volumeRef.current
    if (!chart || !candles || !volume || bars.length === 0) return

    const currentRange = chart.timeScale().getVisibleLogicalRange()
    const currentSpan = currentRange ? currentRange.to - currentRange.from : null
    barsByTimeRef.current = new Map(bars.map((bar) => [toTimestamp(bar.time), bar]))
    dataLengthRef.current = bars.length

    candles.setData(bars.map((bar) => ({
      time: toTimestamp(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    })))
    volume.setData(bars.map((bar) => ({
      time: toTimestamp(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(220, 55, 66, 0.34)' : 'rgba(24, 146, 102, 0.34)'
    })))

    const visibleSpan = currentSpan ?? Math.min(INITIAL_VISIBLE_BARS[period], bars.length)
    const latestEdge = bars.length - 0.5
    isAligningRangeRef.current = true
    chart.timeScale().setVisibleLogicalRange({ from: latestEdge - visibleSpan, to: latestEdge })
    requestAnimationFrame(() => { isAligningRangeRef.current = false })
  }, [bars, period])

  return <div className="period-kline-chart" ref={containerRef} />
}
