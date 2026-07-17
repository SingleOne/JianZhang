import {
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type HistogramData,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  type WhitespaceData
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { formatPrice } from '../lib/format'
import type { KlineBar } from '../shared/types'

interface CandlestickChartProps {
  bars: KlineBar[]
  variant?: 'intraday' | 'fiveDay'
  onHoverBar?: (bar: KlineBar | null) => void
}

type LinePoint = LineData | WhitespaceData
type VolumePoint = HistogramData | WhitespaceData

function toTimestamp(value: string): UTCTimestamp {
  const [datePart, timePart] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000) as UTCTimestamp
}

function timestampAtMinute(date: string, minuteOfDay: number): UTCTimestamp {
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return toTimestamp(`${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
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

function intradaySessionSlots(bars: KlineBar[]): UTCTimestamp[] {
  const date = bars[0].time.slice(0, 10)
  const slots: UTCTimestamp[] = []

  for (let minute = 9 * 60 + 15; minute <= 11 * 60 + 30; minute += 1) {
    slots.push(timestampAtMinute(date, minute))
  }
  for (let minute = 13 * 60; minute <= 15 * 60; minute += 1) {
    slots.push(timestampAtMinute(date, minute))
  }

  return slots
}

function intradayAveragePrice(bars: KlineBar[]): Map<UTCTimestamp, number> {
  const result = new Map<UTCTimestamp, number>()
  let cumulativeAmount = 0
  let cumulativeShares = 0

  for (const bar of bars) {
    cumulativeAmount += bar.amount
    cumulativeShares += bar.volume * 100
    if (isRegularBar(bar) && cumulativeShares > 0) {
      result.set(toTimestamp(bar.time), cumulativeAmount / cumulativeShares)
    }
  }

  return result
}

function intradayLineData(
  slots: UTCTimestamp[],
  barsByTime: Map<UTCTimestamp, KlineBar>,
  include: (bar: KlineBar) => boolean
): LinePoint[] {
  return slots.map((time) => {
    const bar = barsByTime.get(time)
    return bar && include(bar) ? { time, value: bar.close } : { time }
  })
}

function intradayAverageData(slots: UTCTimestamp[], bars: KlineBar[]): LinePoint[] {
  const averages = intradayAveragePrice(bars)
  return slots.map((time) => {
    const value = averages.get(time)
    return value === undefined ? { time } : { time, value }
  })
}

function intradayVolumeData(
  slots: UTCTimestamp[],
  barsByTime: Map<UTCTimestamp, KlineBar>
): VolumePoint[] {
  return slots.map((time) => {
    const bar = barsByTime.get(time)
    if (!bar) return { time }
    return {
      time,
      value: bar.volume,
      color: isAuctionBar(bar)
        ? 'rgba(139, 92, 246, 0.48)'
        : bar.close >= bar.open ? 'rgba(220, 55, 66, 0.48)' : 'rgba(24, 146, 102, 0.48)'
    }
  })
}

export default function CandlestickChart({
  bars,
  variant = 'intraday',
  onHoverBar
}: CandlestickChartProps) {
  const priceContainerRef = useRef<HTMLDivElement>(null)
  const volumeContainerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const auctionZoneRef = useRef<HTMLDivElement>(null)
  const auctionBoundaryRef = useRef<HTMLDivElement>(null)
  const isIntraday = variant === 'intraday'

  useEffect(() => {
    const priceContainer = priceContainerRef.current
    if (!priceContainer) return

    const volumeContainer = volumeContainerRef.current
    const barsByTime = new Map(bars.map((bar) => [toTimestamp(bar.time), bar]))
    const sessionSlots = isIntraday ? intradaySessionSlots(bars) : []
    const fixedRange = isIntraday
      ? { from: -0.5, to: sessionSlots.length - 0.5 }
      : null

    const priceChart = createChart(priceContainer, {
      width: priceContainer.clientWidth,
      height: priceContainer.clientHeight,
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
        minimumWidth: 72,
        scaleMargins: isIntraday ? { top: 0.08, bottom: 0.08 } : { top: 0.08, bottom: 0.32 }
      },
      timeScale: {
        visible: !isIntraday,
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: isIntraday ? 0 : 2,
        barSpacing: 10,
        fixLeftEdge: isIntraday,
        fixRightEdge: isIntraday,
        lockVisibleTimeRangeOnResize: isIntraday,
        tickMarkFormatter: (time: Time) => timeLabel(time, variant === 'fiveDay')
      },
      handleScroll: !isIntraday,
      handleScale: !isIntraday,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#94a3b8',
          width: 1,
          labelVisible: !isIntraday,
          labelBackgroundColor: '#334155'
        },
        horzLine: {
          color: '#94a3b8',
          width: 1,
          labelVisible: !isIntraday,
          labelBackgroundColor: '#334155'
        }
      },
      localization: {
        timeFormatter: (time: Time) => timeLabel(time, variant === 'fiveDay'),
        priceFormatter: formatPrice
      }
    })

    const priceLine = priceChart.addSeries(LineSeries, {
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
    priceLine.setData(isIntraday
      ? intradayLineData(sessionSlots, barsByTime, isRegularBar)
      : bars.map((bar) => ({ time: toTimestamp(bar.time), value: bar.close })))

    if (isIntraday) {
      const auctionLine = priceChart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: '#8b5cf6',
        crosshairMarkerBackgroundColor: '#ffffff'
      })
      auctionLine.setData(intradayLineData(sessionSlots, barsByTime, isAuctionBar))

      const averagePriceLine = priceChart.addSeries(LineSeries, {
        color: '#d89414',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      averagePriceLine.setData(intradayAverageData(sessionSlots, bars))
    }

    let volumeChart: ReturnType<typeof createChart> | null = null
    if (isIntraday && volumeContainer) {
      volumeChart = createChart(volumeContainer, {
        width: volumeContainer.clientWidth,
        height: volumeContainer.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: '#ffffff' },
          textColor: '#64748b',
          fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
          fontSize: 10
        },
        grid: {
          vertLines: { color: '#edf1f7' },
          horzLines: { color: '#f3f5f8' }
        },
        rightPriceScale: {
          borderColor: '#e2e8f0',
          minimumWidth: 72,
          scaleMargins: { top: 0.12, bottom: 0 }
        },
        timeScale: {
          borderColor: '#e2e8f0',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 0,
          fixLeftEdge: true,
          fixRightEdge: true,
          lockVisibleTimeRangeOnResize: true,
          tickMarkFormatter: (time: Time) => timeLabel(time, false)
        },
        handleScroll: false,
        handleScale: false,
        crosshair: { mode: CrosshairMode.Hidden },
        localization: {
          timeFormatter: (time: Time) => timeLabel(time, false)
        }
      })
      const volume = volumeChart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false
      })
      volume.setData(intradayVolumeData(sessionSlots, barsByTime))
      volumeChart.timeScale().setVisibleLogicalRange(fixedRange!)
    } else {
      const volume = priceChart.addSeries(HistogramSeries, {
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
    }

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
    }
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const bar = typeof param.time === 'number'
        ? barsByTime.get(param.time as UTCTimestamp)
        : undefined

      if (!isIntraday) {
        onHoverBar?.(bar ?? null)
        return
      }

      const tooltip = tooltipRef.current
      const point = param.point
      if (!tooltip || !bar || !point || point.x < 0 || point.y < 0) {
        hideTooltip()
        return
      }

      tooltip.textContent = `${bar.time.slice(11, 16)}  价格 ${formatPrice(bar.close)}`
      tooltip.style.display = 'block'
      const tooltipWidth = tooltip.offsetWidth
      const tooltipHeight = tooltip.offsetHeight
      const left = point.x + tooltipWidth + 20 > priceContainer.clientWidth
        ? point.x - tooltipWidth - 12
        : point.x + 12
      const top = point.y - tooltipHeight - 10 < 6
        ? point.y + 12
        : point.y - tooltipHeight - 10
      tooltip.style.left = `${Math.max(6, left)}px`
      tooltip.style.top = `${top}px`
    }
    priceChart.subscribeCrosshairMove(handleCrosshairMove)

    if (fixedRange) {
      priceChart.timeScale().setVisibleLogicalRange(fixedRange)
    } else {
      priceChart.timeScale().fitContent()
    }

    const updateAuctionZone = () => {
      if (!isIntraday || !auctionZoneRef.current || !auctionBoundaryRef.current) return
      const date = bars[0].time.slice(0, 10)
      const firstTime = timestampAtMinute(date, 9 * 60 + 15)
      const previousTime = timestampAtMinute(date, 9 * 60 + 24)
      const lastTime = timestampAtMinute(date, 9 * 60 + 25)
      const firstX = priceChart.timeScale().timeToCoordinate(firstTime)
      const previousX = priceChart.timeScale().timeToCoordinate(previousTime)
      const lastX = priceChart.timeScale().timeToCoordinate(lastTime)
      if (firstX === null || previousX === null || lastX === null) return

      const halfSpacing = Math.max(2, (lastX - previousX) / 2)
      const left = Math.max(0, firstX - halfSpacing)
      const right = lastX + halfSpacing
      auctionZoneRef.current.style.left = `${left}px`
      auctionZoneRef.current.style.width = `${Math.max(0, right - left)}px`
      auctionBoundaryRef.current.style.left = `${right}px`
    }
    updateAuctionZone()

    const priceResizeObserver = new ResizeObserver(([entry]) => {
      priceChart.applyOptions({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height)
      })
      updateAuctionZone()
    })
    priceResizeObserver.observe(priceContainer)

    const volumeResizeObserver = volumeChart && volumeContainer
      ? new ResizeObserver(([entry]) => {
          volumeChart?.applyOptions({
            width: Math.floor(entry.contentRect.width),
            height: Math.floor(entry.contentRect.height)
          })
        })
      : null
    if (volumeResizeObserver && volumeContainer) volumeResizeObserver.observe(volumeContainer)

    return () => {
      priceResizeObserver.disconnect()
      volumeResizeObserver?.disconnect()
      priceChart.unsubscribeCrosshairMove(handleCrosshairMove)
      hideTooltip()
      if (!isIntraday) onHoverBar?.(null)
      priceChart.remove()
      volumeChart?.remove()
    }
  }, [bars, isIntraday, onHoverBar, variant])

  return (
    <div className={`candlestick-chart ${isIntraday ? 'is-intraday' : 'is-five-day'}`}>
      <div className={isIntraday ? 'intraday-price-chart' : 'five-day-chart'}>
        <div className="chart-host" ref={priceContainerRef} />
        {isIntraday ? (
          <>
            <div className="auction-zone" ref={auctionZoneRef}><span>集合竞价</span></div>
            <div className="auction-boundary" ref={auctionBoundaryRef} />
            <div className="intraday-price-tooltip" ref={tooltipRef} />
          </>
        ) : null}
      </div>
      {isIntraday ? (
        <div className="intraday-volume-chart">
          <div className="chart-host" ref={volumeContainerRef} />
          <span className="intraday-volume-label">成交量</span>
        </div>
      ) : null}
    </div>
  )
}
