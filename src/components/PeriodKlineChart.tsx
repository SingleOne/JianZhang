import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { formatPrice } from '../lib/format'
import {
  CTRL_WHEEL_HANDLE_SCALE,
  CTRL_WHEEL_HANDLE_SCROLL,
  enableCtrlWheelZoom
} from '../lib/lightweight-chart-interactions'
import { getChartThemeColors, type ChartThemeColors } from '../lib/theme'
import {
  BOLLINGER_MULTIPLIER,
  BOLLINGER_PERIOD,
  calculateBollingerBands,
  type BollingerBandPoint
} from '../shared/bollinger'
import { marketDateKey } from '../shared/market-hours'
import {
  calculateMovingAverages,
  MOVING_AVERAGE_PERIODS,
  type MovingAveragePeriod,
  type MovingAveragePoint
} from '../shared/moving-average'
import type { DailyKlineIndicator, KlineBar, KlinePeriod, StockMarket } from '../shared/types'

type HistoricalPeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface PeriodKlineChartProps {
  bars: KlineBar[]
  period: HistoricalPeriod
  market: StockMarket
  onHoverBar?: (bar: KlineBar | null) => void
  onRequestMore?: (period: HistoricalPeriod) => void
  requestedVisibleBars?: number
  visibleRangeRequestKey?: number
  onVisibleRangeChange?: (range: KlineVisibleRange, source: KlineVisibleRangeSource) => void
  bollingerBandsEnabled: boolean
  onBollingerBandsEnabledChange: (enabled: boolean) => void
  dailyKlineIndicator: DailyKlineIndicator
  onDailyKlineIndicatorChange: (indicator: DailyKlineIndicator) => void
  trackingStartedAt?: string
  trackingStoppedAt?: string
  ctrlWheelZoomOnly?: boolean
  height?: number
}

export interface KlineVisibleRange {
  fromIndex: number
  toIndex: number
}

export type KlineVisibleRangeSource = 'programmatic' | 'user'

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

function indicatorPrice(value: number | undefined): string {
  return value === undefined ? '--' : value.toFixed(2)
}

function trackingDateMarkers(
  bars: readonly KlineBar[],
  startedAt: string | undefined,
  stoppedAt: string | undefined,
  market: StockMarket,
  theme: ChartThemeColors
): SeriesMarker<Time>[] {
  if (!startedAt || bars.length === 0) return []

  const firstDate = bars[0].time.slice(0, 10)
  const lastDate = bars.at(-1)!.time.slice(0, 10)
  const startedDate = marketDateKey(new Date(startedAt), market)
  const markers: SeriesMarker<Time>[] = []

  if (startedDate >= firstDate && startedDate <= lastDate) {
    const startedBar = bars.find((bar) => bar.time.slice(0, 10) >= startedDate)
    if (startedBar) {
      markers.push({
        time: toTimestamp(startedBar.time),
        position: 'belowBar',
        shape: 'arrowUp',
        color: theme.accent,
        text: '开始追踪',
        size: 1
      })
    }
  }

  if (stoppedAt) {
    const stoppedDate = marketDateKey(new Date(stoppedAt), market)
    if (stoppedDate >= firstDate) {
      let stoppedBar: KlineBar | undefined
      for (let index = bars.length - 1; index >= 0; index -= 1) {
        if (bars[index].time.slice(0, 10) <= stoppedDate) {
          stoppedBar = bars[index]
          break
        }
      }
      if (stoppedBar) {
        markers.push({
          time: toTimestamp(stoppedBar.time),
          position: 'aboveBar',
          shape: 'arrowDown',
          color: theme.amber,
          text: '结束追踪',
          size: 1
        })
      }
    }
  }

  return markers
}

const INITIAL_VISIBLE_BARS: Record<HistoricalPeriod, number> = {
  daily: 80,
  weekly: 60,
  monthly: 40
}

export default function PeriodKlineChart({
  bars,
  period,
  market,
  onHoverBar,
  onRequestMore,
  requestedVisibleBars,
  visibleRangeRequestKey,
  onVisibleRangeChange,
  bollingerBandsEnabled,
  onBollingerBandsEnabledChange,
  dailyKlineIndicator,
  onDailyKlineIndicatorChange,
  trackingStartedAt,
  trackingStoppedAt,
  ctrlWheelZoomOnly = false,
  height = 320
}: PeriodKlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const movingAverageRefs = useRef<Record<MovingAveragePeriod, ISeriesApi<'Line'> | null>>({
    5: null,
    10: null,
    20: null,
    60: null
  })
  const bollingerUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bollingerMiddleRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bollingerLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const barsRef = useRef(bars)
  const barsByTimeRef = useRef(new Map<UTCTimestamp, KlineBar>())
  const movingAverageByTimeRef = useRef(new Map<UTCTimestamp, MovingAveragePoint>())
  const bollingerByTimeRef = useRef(new Map<UTCTimestamp, BollingerBandPoint>())
  const dataLengthRef = useRef(0)
  const lastRequestedLengthRef = useRef(-1)
  const isAligningRangeRef = useRef(false)
  const onHoverBarRef = useRef(onHoverBar)
  const onRequestMoreRef = useRef(onRequestMore)
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange)
  const reportVisibleRangeRef = useRef<
    (range: { from: number; to: number }, source: KlineVisibleRangeSource) => void
  >(() => {})
  const updateMarkersRef = useRef<(range: { from: number; to: number } | null) => void>(() => {})
  const trackingDatesRef = useRef({ startedAt: trackingStartedAt, stoppedAt: trackingStoppedAt })
  const movingAverages = useMemo(() => calculateMovingAverages(bars), [bars])
  const bollingerBands = useMemo(() => calculateBollingerBands(bars), [bars])
  const [hoveredMovingAverages, setHoveredMovingAverages] = useState<
    MovingAveragePoint | null | undefined
  >()
  const [hoveredBollinger, setHoveredBollinger] = useState<BollingerBandPoint | null | undefined>()
  const resolvedTheme = useResolvedAppTheme()
  const activeIndicator: DailyKlineIndicator =
    period === 'daily' ? dailyKlineIndicator : bollingerBandsEnabled ? 'bollinger' : 'none'
  const displayedMovingAverages =
    hoveredMovingAverages === undefined ? movingAverages.at(-1) : hoveredMovingAverages
  const displayedBollinger =
    hoveredBollinger === undefined ? bollingerBands.at(-1) : hoveredBollinger
  barsRef.current = bars
  movingAverageByTimeRef.current = new Map(
    movingAverages.map((point) => [toTimestamp(point.time), point])
  )
  bollingerByTimeRef.current = new Map(
    bollingerBands.map((point) => [toTimestamp(point.time), point])
  )
  onHoverBarRef.current = onHoverBar
  onRequestMoreRef.current = onRequestMore
  onVisibleRangeChangeRef.current = onVisibleRangeChange
  trackingDatesRef.current = { startedAt: trackingStartedAt, stoppedAt: trackingStoppedAt }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = getChartThemeColors(resolvedTheme)

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
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
        scaleMargins: { top: 0.16, bottom: 0.32 }
      },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 0,
        barSpacing: period === 'monthly' ? 9 : 7,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time) => dateLabel(time, period)
      },
      handleScroll: ctrlWheelZoomOnly ? CTRL_WHEEL_HANDLE_SCROLL : false,
      handleScale: ctrlWheelZoomOnly ? CTRL_WHEEL_HANDLE_SCALE : true,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border },
        horzLine: { color: theme.text, width: 1, labelBackgroundColor: theme.border }
      },
      localization: {
        timeFormatter: (time: Time) => dateLabel(time, period),
        priceFormatter: (price: number) => price.toFixed(2)
      }
    })
    chartRef.current = chart

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.red,
      downColor: theme.green,
      borderUpColor: theme.red,
      borderDownColor: theme.green,
      wickUpColor: theme.red,
      wickDownColor: theme.green,
      priceLineVisible: true,
      lastValueVisible: true
    })
    candlesRef.current = candles
    const chartMarkers = createSeriesMarkers(candles, [], {
      autoScale: true,
      zOrder: 'aboveSeries'
    })

    const updateMarkers = (range: { from: number; to: number } | null) => {
      const currentBars = barsRef.current
      if (!range || currentBars.length === 0) {
        chartMarkers.setMarkers([])
        return
      }

      const firstIndex = Math.max(0, Math.ceil(range.from))
      const lastIndex = Math.min(currentBars.length - 1, Math.floor(range.to))
      if (firstIndex > lastIndex) {
        chartMarkers.setMarkers([])
        return
      }

      let highestBar = currentBars[firstIndex]
      let lowestBar = currentBars[firstIndex]
      for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
        const bar = currentBars[index]
        if (bar.high > highestBar.high) highestBar = bar
        if (bar.low < lowestBar.low) lowestBar = bar
      }

      const highMarker: SeriesMarker<Time> = {
        time: toTimestamp(highestBar.time),
        position: 'atPriceTop',
        price: highestBar.high,
        shape: 'arrowDown',
        color: theme.red,
        text: `最高 ${formatPrice(highestBar.high)}`,
        size: 1
      }
      const lowMarker: SeriesMarker<Time> = {
        time: toTimestamp(lowestBar.time),
        position: 'atPriceBottom',
        price: lowestBar.low,
        shape: 'arrowUp',
        color: theme.green,
        text: `最低 ${formatPrice(lowestBar.low)}`,
        size: 1
      }
      const extrema =
        toTimestamp(highestBar.time) <= toTimestamp(lowestBar.time)
          ? [highMarker, lowMarker]
          : [lowMarker, highMarker]
      const trackingMarkers = trackingDateMarkers(
        currentBars,
        trackingDatesRef.current.startedAt,
        trackingDatesRef.current.stoppedAt,
        market,
        theme
      )
      chartMarkers.setMarkers(
        [...extrema, ...trackingMarkers].sort(
          (left, right) => Number(left.time) - Number(right.time)
        )
      )
    }
    updateMarkersRef.current = updateMarkers

    const reportVisibleRange = (
      range: { from: number; to: number },
      source: KlineVisibleRangeSource
    ) => {
      const lastBarIndex = dataLengthRef.current - 1
      if (lastBarIndex < 0) return
      const fromIndex = Math.max(0, Math.min(lastBarIndex, Math.ceil(range.from)))
      const toIndex = Math.max(fromIndex, Math.min(lastBarIndex, Math.floor(range.to)))
      onVisibleRangeChangeRef.current?.({ fromIndex, toIndex }, source)
    }
    reportVisibleRangeRef.current = reportVisibleRange

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } })
    volumeRef.current = volume

    const movingAverageColors: Record<MovingAveragePeriod, string> = {
      5: theme.amber,
      10: theme.accent,
      20: theme.purple,
      60: resolvedTheme === 'dark' ? '#22d3ee' : '#0891b2'
    }
    for (const movingAveragePeriod of MOVING_AVERAGE_PERIODS) {
      movingAverageRefs.current[movingAveragePeriod] = chart.addSeries(LineSeries, {
        color: movingAverageColors[movingAveragePeriod],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
    }

    const bollingerUpper = chart.addSeries(LineSeries, {
      color: theme.amber,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })
    const bollingerMiddle = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })
    const bollingerLower = chart.addSeries(LineSeries, {
      color: theme.purple,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    })
    bollingerUpperRef.current = bollingerUpper
    bollingerMiddleRef.current = bollingerMiddle
    bollingerLowerRef.current = bollingerLower

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (typeof param.time === 'number') {
        const timestamp = param.time as UTCTimestamp
        onHoverBarRef.current?.(barsByTimeRef.current.get(timestamp) ?? null)
        setHoveredMovingAverages(movingAverageByTimeRef.current.get(timestamp) ?? null)
        setHoveredBollinger(bollingerByTimeRef.current.get(timestamp) ?? null)
      } else {
        onHoverBarRef.current?.(null)
        setHoveredMovingAverages(undefined)
        setHoveredBollinger(undefined)
      }
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)

    const handleVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || isAligningRangeRef.current || dataLengthRef.current === 0) return
      const latestEdge = dataLengthRef.current - 0.5
      const visibleSpan = Math.max(5, range.to - range.from)
      const alignedFrom = latestEdge - visibleSpan
      const alignedRange = { from: alignedFrom, to: latestEdge }

      updateMarkers(alignedRange)
      reportVisibleRange(alignedRange, 'user')

      if (alignedFrom < 12 && lastRequestedLengthRef.current !== dataLengthRef.current) {
        lastRequestedLengthRef.current = dataLengthRef.current
        onRequestMoreRef.current?.(period)
      }

      if (Math.abs(range.to - latestEdge) > 0.05) {
        isAligningRangeRef.current = true
        chart.timeScale().setVisibleLogicalRange(alignedRange)
        requestAnimationFrame(() => {
          isAligningRangeRef.current = false
        })
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) })
    })
    resizeObserver.observe(container)
    const disableCtrlWheelZoom = ctrlWheelZoomOnly
      ? enableCtrlWheelZoom(chart, container, () => dataLengthRef.current)
      : () => undefined

    return () => {
      disableCtrlWheelZoom()
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      onHoverBarRef.current?.(null)
      chart.remove()
      chartRef.current = null
      candlesRef.current = null
      volumeRef.current = null
      movingAverageRefs.current = {
        5: null,
        10: null,
        20: null,
        60: null
      }
      bollingerUpperRef.current = null
      bollingerMiddleRef.current = null
      bollingerLowerRef.current = null
      reportVisibleRangeRef.current = () => {}
      updateMarkersRef.current = () => {}
    }
  }, [ctrlWheelZoomOnly, height, market, period, resolvedTheme])

  useEffect(() => {
    setHoveredMovingAverages(undefined)
    setHoveredBollinger(undefined)
  }, [bars, period])

  useEffect(() => {
    const chart = chartRef.current
    const candles = candlesRef.current
    const volume = volumeRef.current
    if (!chart || !candles || !volume || bars.length === 0) return

    const currentRange = chart.timeScale().getVisibleLogicalRange()
    const currentSpan = currentRange ? currentRange.to - currentRange.from : null
    barsByTimeRef.current = new Map(bars.map((bar) => [toTimestamp(bar.time), bar]))
    dataLengthRef.current = bars.length

    candles.setData(
      bars.map((bar) => ({
        time: toTimestamp(bar.time),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close
      }))
    )
    const theme = getChartThemeColors(resolvedTheme)
    volume.setData(
      bars.map((bar) => ({
        time: toTimestamp(bar.time),
        value: bar.volume,
        color: bar.close >= bar.open ? `${theme.red}57` : `${theme.green}57`
      }))
    )

    const visibleSpan = currentSpan ?? Math.min(INITIAL_VISIBLE_BARS[period], bars.length)
    const latestEdge = bars.length - 0.5
    const nextRange = { from: latestEdge - visibleSpan, to: latestEdge }
    isAligningRangeRef.current = true
    chart.timeScale().setVisibleLogicalRange(nextRange)
    updateMarkersRef.current(nextRange)
    reportVisibleRangeRef.current(nextRange, 'programmatic')
    requestAnimationFrame(() => {
      isAligningRangeRef.current = false
    })
  }, [bars, height, period, resolvedTheme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    updateMarkersRef.current(chart.timeScale().getVisibleLogicalRange())
  }, [trackingStartedAt, trackingStoppedAt])

  useEffect(() => {
    for (const movingAveragePeriod of MOVING_AVERAGE_PERIODS) {
      movingAverageRefs.current[movingAveragePeriod]?.setData(
        activeIndicator === 'movingAverage'
          ? movingAverages.flatMap((point) => {
              const value = point.values[movingAveragePeriod]
              return value === undefined ? [] : [{ time: toTimestamp(point.time), value }]
            })
          : []
      )
    }
  }, [activeIndicator, height, movingAverages, period, resolvedTheme])

  useEffect(() => {
    const upper = bollingerUpperRef.current
    const middle = bollingerMiddleRef.current
    const lower = bollingerLowerRef.current
    if (!upper || !middle || !lower) return

    upper.setData(
      activeIndicator === 'bollinger'
        ? bollingerBands.map((point) => ({
            time: toTimestamp(point.time),
            value: point.upper
          }))
        : []
    )
    middle.setData(
      activeIndicator === 'bollinger'
        ? bollingerBands.map((point) => ({
            time: toTimestamp(point.time),
            value: point.middle
          }))
        : []
    )
    lower.setData(
      activeIndicator === 'bollinger'
        ? bollingerBands.map((point) => ({
            time: toTimestamp(point.time),
            value: point.lower
          }))
        : []
    )
  }, [activeIndicator, bollingerBands, height, period, resolvedTheme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || requestedVisibleBars === undefined || dataLengthRef.current === 0) return

    const visibleBars = Math.min(dataLengthRef.current, Math.max(1, requestedVisibleBars))
    const latestEdge = dataLengthRef.current - 0.5
    const range = { from: latestEdge - visibleBars, to: latestEdge }
    isAligningRangeRef.current = true
    chart.timeScale().setVisibleLogicalRange(range)
    updateMarkersRef.current(range)
    reportVisibleRangeRef.current(range, 'programmatic')
    requestAnimationFrame(() => {
      isAligningRangeRef.current = false
    })
  }, [bars.length, requestedVisibleBars, visibleRangeRequestKey])

  return (
    <div className="period-kline-shell">
      <div className="period-kline-chart" ref={containerRef} style={{ height }} />
      <div
        className="kline-indicator-bar"
        aria-label={period === 'daily' ? '日 K 叠加指标' : 'BOLL 指标'}
      >
        {period === 'daily' ? (
          <div className="kline-indicator-selector" role="group" aria-label="选择日 K 叠加指标">
            <button
              className={activeIndicator === 'movingAverage' ? 'is-active' : ''}
              type="button"
              aria-pressed={activeIndicator === 'movingAverage'}
              title="显示 MA5、MA10、MA20 和 MA60"
              onClick={() => onDailyKlineIndicatorChange('movingAverage')}
            >
              MA
            </button>
            <button
              className={activeIndicator === 'bollinger' ? 'is-active' : ''}
              type="button"
              aria-pressed={activeIndicator === 'bollinger'}
              title={`显示 BOLL(${BOLLINGER_PERIOD},${BOLLINGER_MULTIPLIER})`}
              onClick={() => onDailyKlineIndicatorChange('bollinger')}
            >
              BOLL
            </button>
            <button
              className={activeIndicator === 'none' ? 'is-active' : ''}
              type="button"
              aria-pressed={activeIndicator === 'none'}
              title="关闭日 K 叠加指标"
              onClick={() => onDailyKlineIndicatorChange('none')}
            >
              关闭
            </button>
          </div>
        ) : (
          <button
            className={`bollinger-toggle ${bollingerBandsEnabled ? 'is-active' : ''}`}
            type="button"
            role="switch"
            aria-checked={bollingerBandsEnabled}
            title={bollingerBandsEnabled ? '隐藏 BOLL 线' : '显示 BOLL 线'}
            onClick={() => onBollingerBandsEnabledChange(!bollingerBandsEnabled)}
          >
            <span aria-hidden="true">
              <i />
            </span>
            <strong>BOLL</strong>
            <em>
              ({BOLLINGER_PERIOD}, {BOLLINGER_MULTIPLIER})
            </em>
          </button>
        )}
        {activeIndicator === 'movingAverage' ? (
          <div className="moving-average-values">
            {MOVING_AVERAGE_PERIODS.map((movingAveragePeriod) => (
              <span className={`is-ma-${movingAveragePeriod}`} key={movingAveragePeriod}>
                MA{movingAveragePeriod}{' '}
                <strong>
                  {indicatorPrice(displayedMovingAverages?.values[movingAveragePeriod])}
                </strong>
              </span>
            ))}
          </div>
        ) : activeIndicator === 'bollinger' ? (
          <div className="bollinger-values">
            <span className="is-upper">
              UP <strong>{indicatorPrice(displayedBollinger?.upper)}</strong>
            </span>
            <span className="is-middle">
              MID <strong>{indicatorPrice(displayedBollinger?.middle)}</strong>
            </span>
            <span className="is-lower">
              LOW <strong>{indicatorPrice(displayedBollinger?.lower)}</strong>
            </span>
          </div>
        ) : (
          <span className="kline-indicator-disabled-label">叠加指标已关闭</span>
        )}
      </div>
    </div>
  )
}
