import {
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { KlineBar } from '../shared/types'

interface CandlestickChartProps {
  bars: KlineBar[]
  variant?: 'intraday' | 'fiveDay'
  onHoverBar?: (bar: KlineBar | null) => void
}

function toTimestamp(value: string): UTCTimestamp {
  const [datePart, timePart] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000) as UTCTimestamp
}

function timeLabel(time: Time, showDate: boolean): string {
  if (typeof time !== 'number') return ''
  const date = new Date(time * 1000)
  const hours = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
  return showDate
    ? `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${hours}`
    : hours
}

function minuteOfDay(bar: KlineBar): number {
  const [hour, minute] = bar.time.slice(11, 16).split(':').map(Number)
  return hour * 60 + minute
}

function isAuctionBar(bar: KlineBar): boolean {
  return minuteOfDay(bar) <= 9 * 60 + 25
}

function isRegularBar(bar: KlineBar): boolean {
  return minuteOfDay(bar) >= 9 * 60 + 30
}

function intradayAveragePrice(bars: KlineBar[]): LineData[] {
  const result: LineData[] = []
  let cumulativeAmount = 0
  let cumulativeShares = 0

  for (const bar of bars) {
    cumulativeAmount += bar.amount
    cumulativeShares += bar.volume * 100
    if (isRegularBar(bar) && cumulativeShares > 0) {
      result.push({ time: toTimestamp(bar.time), value: cumulativeAmount / cumulativeShares })
    }
  }

  return result
}

export default function CandlestickChart({
  bars,
  variant = 'intraday',
  onHoverBar
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const auctionZoneRef = useRef<HTMLDivElement>(null)
  const auctionBoundaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isIntraday = variant === 'intraday'
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
        rightOffset: isIntraday ? 0 : 2,
        barSpacing: 10,
        fixLeftEdge: isIntraday,
        fixRightEdge: isIntraday,
        tickMarkFormatter: (time: Time) => timeLabel(time, variant === 'fiveDay')
      },
      handleScroll: !isIntraday,
      handleScale: !isIntraday,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' },
        horzLine: { color: '#94a3b8', width: 1, labelBackgroundColor: '#334155' }
      },
      localization: {
        timeFormatter: (time: Time) => timeLabel(time, variant === 'fiveDay'),
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
    const priceBars = isIntraday ? bars.filter(isRegularBar) : bars
    priceLine.setData(priceBars.map((bar) => ({
      time: toTimestamp(bar.time),
      value: bar.close
    })))

    if (isIntraday) {
      const auctionLine = chart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: '#8b5cf6',
        crosshairMarkerBackgroundColor: '#ffffff'
      })
      auctionLine.setData(bars.filter(isAuctionBar).map((bar) => ({
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
    }

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
      color: isIntraday && isAuctionBar(bar)
        ? 'rgba(139, 92, 246, 0.35)'
        : bar.close >= bar.open ? 'rgba(220, 55, 66, 0.34)' : 'rgba(24, 146, 102, 0.34)'
    })))

    const barByTime = new Map(bars.map((bar) => [toTimestamp(bar.time), bar]))
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      onHoverBar?.(typeof param.time === 'number' ? barByTime.get(param.time as UTCTimestamp) ?? null : null)
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)
    chart.timeScale().fitContent()

    const updateAuctionZone = () => {
      if (!isIntraday || !auctionZoneRef.current || !auctionBoundaryRef.current) return
      const auctionBars = bars.filter(isAuctionBar)
      const first = auctionBars[0]
      const last = auctionBars.at(-1)
      const previous = auctionBars.at(-2)
      if (!first || !last) return

      const firstX = chart.timeScale().timeToCoordinate(toTimestamp(first.time))
      const lastX = chart.timeScale().timeToCoordinate(toTimestamp(last.time))
      const previousX = previous ? chart.timeScale().timeToCoordinate(toTimestamp(previous.time)) : null
      if (firstX === null || lastX === null) return

      const halfSpacing = previousX === null ? 3 : Math.max(2, (lastX - previousX) / 2)
      const left = Math.max(0, firstX - halfSpacing)
      const right = lastX + halfSpacing
      auctionZoneRef.current.style.left = `${left}px`
      auctionZoneRef.current.style.width = `${Math.max(0, right - left)}px`
      auctionBoundaryRef.current.style.left = `${right}px`
    }
    updateAuctionZone()

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) })
      updateAuctionZone()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      onHoverBar?.(null)
      chart.remove()
    }
  }, [bars, onHoverBar, variant])

  return (
    <div className="candlestick-chart">
      <div className="chart-host" ref={containerRef} />
      {variant === 'intraday' ? (
        <>
          <div className="auction-zone" ref={auctionZoneRef}><span>集合竞价</span></div>
          <div className="auction-boundary" ref={auctionBoundaryRef} />
        </>
      ) : null}
    </div>
  )
}
