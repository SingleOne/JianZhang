import {
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  LineSeries,
  type HistogramData,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { formatAmount, formatPrice, formatVolume } from '../lib/format'
import type { KlineBar } from '../shared/types'
import type { StockMarket } from '../shared/stock-market'
import { volumeUnitForMarket } from '../shared/stock-market'

interface ChartReferenceOverlay {
  openingRange15: { high: number | null; low: number | null }
  tPlanLevels: Array<{ id: string; label: string; price: number; side: 'buy' | 'sell' }>
  eventMarkers: Array<{ time: string; title: string; severity: 'info' | 'attention' }>
}

interface CandlestickChartProps {
  bars: KlineBar[]
  market: StockMarket
  variant?: 'intraday' | 'sectorIntraday' | 'fiveDay'
  onHoverBar?: (bar: KlineBar | null) => void
  marketInsightOverlay?: ChartReferenceOverlay | null
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

function intradaySessionSlots(
  bars: KlineBar[],
  market: StockMarket,
  includeAuction: boolean
): UTCTimestamp[] {
  const date = bars[0].time.slice(0, 10)
  const slots: UTCTimestamp[] = []
  const sessions = market === 'US'
    ? [[9 * 60 + 30, 16 * 60]]
    : market === 'HK'
      ? [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60 + 10]]
      : [[includeAuction ? 9 * 60 + 15 : 9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]]
  for (const [start, end] of sessions) {
    for (let minute = start; minute <= end; minute += 1) {
      slots.push(timestampAtMinute(date, minute))
    }
  }

  return slots
}

function intradayAveragePrice(bars: KlineBar[], market: StockMarket): Map<UTCTimestamp, number> {
  const result = new Map<UTCTimestamp, number>()
  let cumulativeAmount = 0
  let cumulativeShares = 0

  for (const bar of bars) {
    if (!isRegularBar(bar)) continue
    cumulativeAmount += bar.amount
    cumulativeShares += bar.volume * (market === 'CN' ? 100 : 1)
    if (cumulativeShares > 0) {
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

function intradayAverageData(
  slots: UTCTimestamp[],
  bars: KlineBar[],
  market: StockMarket
): LinePoint[] {
  const averages = intradayAveragePrice(bars.slice(0, -1), market)
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

function intradayExtremaMarkers(bars: KlineBar[]): SeriesMarker<Time>[] {
  const regularBars = bars.filter(isRegularBar)
  if (regularBars.length === 0) return []

  let highestBar = regularBars[0]
  let lowestBar = regularBars[0]

  for (let index = 1; index < regularBars.length; index += 1) {
    const bar = regularBars[index]
    if (bar.high > highestBar.high) highestBar = bar
    if (bar.low < lowestBar.low) lowestBar = bar
  }

  const highMarker: SeriesMarker<Time> = {
    time: toTimestamp(highestBar.time),
    position: 'atPriceTop',
    price: highestBar.high,
    shape: 'arrowDown',
    color: '#dc3742',
    text: `最高 ${formatPrice(highestBar.high)}`,
    size: 1
  }
  const lowMarker: SeriesMarker<Time> = {
    time: toTimestamp(lowestBar.time),
    position: 'atPriceBottom',
    price: lowestBar.low,
    shape: 'arrowUp',
    color: '#189266',
    text: `最低 ${formatPrice(lowestBar.low)}`,
    size: 1
  }

  return toTimestamp(highestBar.time) <= toTimestamp(lowestBar.time)
    ? [highMarker, lowMarker]
    : [lowMarker, highMarker]
}

export default function CandlestickChart({
  bars,
  market,
  variant = 'intraday',
  onHoverBar,
  marketInsightOverlay = null
}: CandlestickChartProps) {
  const priceContainerRef = useRef<HTMLDivElement>(null)
  const volumeContainerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const volumeTooltipRef = useRef<HTMLDivElement>(null)
  const auctionZoneRef = useRef<HTMLDivElement>(null)
  const auctionBoundaryRef = useRef<HTMLDivElement>(null)
  const isIntraday = variant !== 'fiveDay'
  const showAuction = variant === 'intraday' && market === 'CN'
  const volumeUnit = volumeUnitForMarket(market)

  useEffect(() => {
    const priceContainer = priceContainerRef.current
    if (!priceContainer) return

    const volumeContainer = volumeContainerRef.current
    const chartBars = showAuction ? bars : bars.filter(isRegularBar)
    if (chartBars.length === 0) return

    const barsByTime = new Map(chartBars.map((bar) => [toTimestamp(bar.time), bar]))
    const sessionSlots = isIntraday ? intradaySessionSlots(chartBars, market, showAuction) : []
    const fixedTimeRange = isIntraday
      ? { from: sessionSlots[0], to: sessionSlots.at(-1)! }
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
        scaleMargins: isIntraday ? { top: 0.18, bottom: 0.18 } : { top: 0.08, bottom: 0.32 }
      },
      timeScale: {
        visible: !isIntraday,
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        barSpacing: 10,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time) => timeLabel(time, variant === 'fiveDay')
      },
      handleScroll: false,
      handleScale: false,
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
      : chartBars.map((bar) => ({ time: toTimestamp(bar.time), value: bar.close })))

    if (isIntraday) {
      const timeRangeAnchor = priceChart.addSeries(LineSeries, {
        priceScaleId: '',
        color: 'transparent',
        lineVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      timeRangeAnchor.setData([
        { time: fixedTimeRange!.from, value: 0 },
        { time: fixedTimeRange!.to, value: 0 }
      ])

      if (showAuction) {
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
      }

      const averagePriceLine = priceChart.addSeries(LineSeries, {
        color: '#d89414',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      averagePriceLine.setData(intradayAverageData(sessionSlots, chartBars, market))

      if (marketInsightOverlay) {
        const priceLines = [
          marketInsightOverlay.openingRange15.high === null ? null : {
            price: marketInsightOverlay.openingRange15.high,
            color: '#8b5cf6',
            lineWidth: 1 as const,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '开盘15分高'
          },
          marketInsightOverlay.openingRange15.low === null ? null : {
            price: marketInsightOverlay.openingRange15.low,
            color: '#8b5cf6',
            lineWidth: 1 as const,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '开盘15分低'
          },
          ...marketInsightOverlay.tPlanLevels.map((level) => ({
            price: level.price,
            color: level.side === 'buy' ? '#189266' : '#dc3742',
            lineWidth: 1 as const,
            lineStyle: LineStyle.LargeDashed,
            axisLabelVisible: true,
            title: level.label
          }))
        ]
        for (const options of priceLines) if (options) priceLine.createPriceLine(options)
      }

      const extremaAnchor = priceChart.addSeries(LineSeries, {
        color: 'transparent',
        lineVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      extremaAnchor.setData(chartBars.map((bar) => ({
        time: toTimestamp(bar.time),
        value: bar.close
      })))

      const insightMarkers = marketInsightOverlay?.eventMarkers.flatMap((event) => {
        if (!event.time.includes(' ')) return []
        return [{
          time: toTimestamp(event.time),
          position: event.severity === 'attention' ? 'aboveBar' as const : 'belowBar' as const,
          shape: event.severity === 'attention' ? 'circle' as const : 'square' as const,
          color: event.severity === 'attention' ? '#d89414' : '#3f7fd3',
          text: event.title,
          size: 1
        } satisfies SeriesMarker<Time>]
      }) ?? []
      createSeriesMarkers(extremaAnchor, [...intradayExtremaMarkers(chartBars), ...insightMarkers], {
        autoScale: true,
        zOrder: 'aboveSeries'
      })
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
      const timeRangeAnchor = volumeChart.addSeries(LineSeries, {
        priceScaleId: '',
        color: 'transparent',
        lineVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
      timeRangeAnchor.setData([
        { time: fixedTimeRange!.from, value: 0 },
        { time: fixedTimeRange!.to, value: 0 }
      ])
      volumeChart.timeScale().setVisibleRange(fixedTimeRange!)
    } else {
      const volume = priceChart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false
      })
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } })
      volume.setData(chartBars.map((bar) => ({
        time: toTimestamp(bar.time),
        value: bar.volume,
        color: bar.close >= bar.open ? 'rgba(220, 55, 66, 0.34)' : 'rgba(24, 146, 102, 0.34)'
      })))
    }

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
    }
    const hideVolumeTooltip = () => {
      if (volumeTooltipRef.current) volumeTooltipRef.current.style.display = 'none'
    }
    const placeTooltip = (
      tooltip: HTMLDivElement,
      point: { x: number; y: number },
      container: HTMLDivElement
    ) => {
      tooltip.style.display = 'block'
      const tooltipWidth = tooltip.offsetWidth
      const tooltipHeight = tooltip.offsetHeight
      const left = point.x + tooltipWidth + 20 > container.clientWidth
        ? point.x - tooltipWidth - 12
        : point.x + 12
      const top = point.y - tooltipHeight - 10 < 6
        ? point.y + 12
        : point.y - tooltipHeight - 10
      tooltip.style.left = `${Math.max(6, left)}px`
      tooltip.style.top = `${top}px`
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
      placeTooltip(tooltip, point, priceContainer)
    }
    const handleVolumeCrosshairMove = (param: MouseEventParams<Time>) => {
      const bar = typeof param.time === 'number'
        ? barsByTime.get(param.time as UTCTimestamp)
        : undefined
      const tooltip = volumeTooltipRef.current
      const point = param.point
      if (!tooltip || !volumeContainer || !bar || !point || point.x < 0 || point.y < 0) {
        hideVolumeTooltip()
        return
      }

      tooltip.textContent = `${bar.time.slice(11, 16)}  成交量 ${formatVolume(bar.volume, volumeUnit)}  成交额 ${formatAmount(bar.amount)}`
      placeTooltip(tooltip, point, volumeContainer)
    }
    priceChart.subscribeCrosshairMove(handleCrosshairMove)
    volumeChart?.subscribeCrosshairMove(handleVolumeCrosshairMove)

    if (fixedTimeRange) {
      priceChart.timeScale().setVisibleRange(fixedTimeRange)
    } else {
      priceChart.timeScale().fitContent()
    }

    const updateAuctionZone = () => {
      if (!showAuction || !auctionZoneRef.current || !auctionBoundaryRef.current) return
      const date = chartBars[0].time.slice(0, 10)
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
      volumeChart?.unsubscribeCrosshairMove(handleVolumeCrosshairMove)
      hideTooltip()
      hideVolumeTooltip()
      if (!isIntraday) onHoverBar?.(null)
      priceChart.remove()
      volumeChart?.remove()
    }
  }, [bars, isIntraday, market, marketInsightOverlay, onHoverBar, showAuction, variant, volumeUnit])

  return (
    <div className={`candlestick-chart ${isIntraday ? 'is-intraday' : 'is-five-day'}`}>
      <div className={isIntraday ? 'intraday-price-chart' : 'five-day-chart'}>
        <div className="chart-host" ref={priceContainerRef} />
        {showAuction ? (
          <>
            <div className="auction-zone" ref={auctionZoneRef}><span>集合竞价</span></div>
            <div className="auction-boundary" ref={auctionBoundaryRef} />
          </>
        ) : null}
        {isIntraday ? <div className="intraday-price-tooltip" ref={tooltipRef} /> : null}
      </div>
      {isIntraday ? (
        <div className="intraday-volume-chart">
          <div className="chart-host" ref={volumeContainerRef} />
          <span className="intraday-volume-label">成交量</span>
          <div className="intraday-volume-tooltip" ref={volumeTooltipRef} />
        </div>
      ) : null}
    </div>
  )
}
