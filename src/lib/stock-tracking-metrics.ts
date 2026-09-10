import type {
  KlineBar,
  StockMarket,
  StockTrackingMetricSnapshot,
  StockTrackingProfile,
  TechnicalPatternSignalType
} from '../shared/types'
import {
  calculateBollingerBandwidthTrends,
  candlestickShadowSignals
} from '../shared/technical-patterns'
import { exchangeFromQuoteId, marketFromQuoteId } from '../shared/stock-market'

export const STOCK_TRACKING_BASE_METRICS = {
  close: 'close',
  changePercent: 'changePercent',
  volume: 'volume',
  amount: 'amount',
  priceVolumeDivergence: 'priceVolumeDivergence'
} as const

export const STOCK_TRACKING_TECHNICAL_PATTERN_METRICS: Record<TechnicalPatternSignalType, string> =
  {
    longUpperShadow: 'longUpperShadow',
    longLowerShadow: 'longLowerShadow',
    bollingerNarrowing: 'bollingerNarrowing',
    bollingerExpansion: 'bollingerExpansion'
  }

const TECHNICAL_PATTERN_SIGNALS = Object.keys(
  STOCK_TRACKING_TECHNICAL_PATTERN_METRICS
) as TechnicalPatternSignalType[]

export const STOCK_TRACKING_VOLUME_RATIO_METRICS = {
  5: 'volumeRatio5d',
  10: 'volumeRatio10d',
  20: 'volumeRatio20d'
} as const

export const STOCK_TRACKING_PRICE_RETURN_METRICS = {
  5: 'priceReturn5d',
  10: 'priceReturn10d',
  20: 'priceReturn20d'
} as const

export const STOCK_TRACKING_PRICE_AVERAGE_METRICS = {
  5: 'priceAverage5d',
  10: 'priceAverage10d',
  20: 'priceAverage20d'
} as const

export const STOCK_TRACKING_VOLUME_AVERAGE_METRICS = {
  5: 'volumeAverage5d',
  10: 'volumeAverage10d',
  20: 'volumeAverage20d'
} as const

export type StockTrackingMetricPeriod = keyof typeof STOCK_TRACKING_VOLUME_RATIO_METRICS
export type StockTrackingPriceVolumeState =
  | 'volumeSurgePriceRise'
  | 'volumeSurgePriceFall'
  | 'volumeRisePriceRise'
  | 'volumeFallPriceRise'
  | 'volumeRisePriceFall'
  | 'volumeFallPriceFall'
  | 'priceRise'
  | 'priceFall'
  | 'neutral'
export type StockTrackingPriceVolumeDivergence = 'priceRiseVolumeFall' | 'priceFallVolumeRise'
export type StockTrackingPriceMovement =
  | 'limitUp'
  | 'strongRise'
  | 'rise'
  | 'slightRise'
  | 'flat'
  | 'slightFall'
  | 'fall'
  | 'strongFall'
  | 'limitDown'

export const STOCK_TRACKING_PRICE_MOVEMENT_LABELS: Record<StockTrackingPriceMovement, string> = {
  limitUp: '涨停',
  strongRise: '大涨',
  rise: '上涨',
  slightRise: '微涨',
  flat: '平盘',
  slightFall: '微跌',
  fall: '下跌',
  strongFall: '大跌',
  limitDown: '跌停'
}

export const STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS: Record<
  StockTrackingPriceVolumeDivergence,
  string
> = {
  priceRiseVolumeFall: '连续三日价升量减',
  priceFallVolumeRise: '连续三日价跌量增'
}

const METRIC_PERIODS = Object.keys(STOCK_TRACKING_VOLUME_RATIO_METRICS).map(
  Number
) as StockTrackingMetricPeriod[]
const EXPANDED_VOLUME_RATIO = 1.2
const CONTRACTED_VOLUME_RATIO = 0.8
const LARGE_PRICE_CHANGE_PERCENT = 5
const NORMAL_PRICE_CHANGE_PERCENT = 2

export interface RealtimeVolumeRatioPoint {
  time: string
  ratio: number
  cumulativeVolume: number
  expectedVolume: number
}

function dateKey(value: string): string {
  return value.slice(0, 10)
}

function percentageChange(current: number, previous: number): number {
  return previous === 0 ? 0 : (current / previous - 1) * 100
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function tradingProgressAt(
  time: string,
  market: StockMarket
): { elapsed: number; total: number } | null {
  const timeText = time.slice(11, 16)
  const [hour, minute] = timeText.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const minutes = hour * 60 + minute
  const morningStart = 9 * 60 + 30
  if (market === 'US') {
    return minutes >= morningStart && minutes <= 16 * 60
      ? { elapsed: Math.min(390, minutes - morningStart + 1), total: 390 }
      : null
  }
  const morningEnd = market === 'HK' ? 12 * 60 : 11 * 60 + 30
  const afternoonStart = 13 * 60
  const afternoonEnd = market === 'HK' ? 16 * 60 : 15 * 60
  const morningMinutes = market === 'HK' ? 150 : 120
  const totalMinutes = market === 'HK' ? 330 : 240
  if (market === 'CN' && minutes === 9 * 60 + 25) return { elapsed: 1, total: totalMinutes }
  if (minutes >= morningStart && minutes <= morningEnd) {
    return { elapsed: Math.min(morningMinutes, minutes - morningStart + 1), total: totalMinutes }
  }
  if (minutes >= afternoonStart && minutes <= afternoonEnd) {
    return {
      elapsed: Math.min(totalMinutes, minutes - afternoonStart + morningMinutes + 1),
      total: totalMinutes
    }
  }
  return null
}

export function calculateRealtimeVolumeRatio(
  intradayBars: readonly KlineBar[],
  dailyBars: readonly KlineBar[],
  tradingDate: string,
  market: StockMarket = 'CN'
): RealtimeVolumeRatioPoint[] {
  const previousDailyBars = [...dailyBars]
    .filter((bar) => dateKey(bar.time) < tradingDate)
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-5)
  if (previousDailyBars.length < 5) return []

  const averageDailyVolume = average(previousDailyBars.map((bar) => bar.volume))
  if (!Number.isFinite(averageDailyVolume) || averageDailyVolume <= 0) return []

  let cumulativeVolume = 0
  const points: RealtimeVolumeRatioPoint[] = []
  for (const bar of [...intradayBars].sort((left, right) => left.time.localeCompare(right.time))) {
    if (dateKey(bar.time) !== tradingDate) continue
    const progress = tradingProgressAt(bar.time, market)
    if (progress === null || !Number.isFinite(bar.volume)) continue
    cumulativeVolume += bar.volume
    const expectedVolume = (averageDailyVolume * progress.elapsed) / progress.total
    points.push({
      time: bar.time,
      ratio: cumulativeVolume / expectedVolume,
      cumulativeVolume,
      expectedVolume
    })
  }
  return points
}

function divergenceCode(bars: readonly KlineBar[], index: number): number | null {
  if (index < 3) return null
  let priceRisingVolumeFalling = true
  let priceFallingVolumeRising = true
  for (let currentIndex = index - 2; currentIndex <= index; currentIndex += 1) {
    const previous = bars[currentIndex - 1]
    const current = bars[currentIndex]
    priceRisingVolumeFalling &&= current.close > previous.close && current.volume < previous.volume
    priceFallingVolumeRising &&= current.close < previous.close && current.volume > previous.volume
  }
  const previousPair = index >= 4 ? [bars[index - 4], bars[index - 3]] : null
  if (
    priceRisingVolumeFalling &&
    !(
      previousPair &&
      previousPair[1].close > previousPair[0].close &&
      previousPair[1].volume < previousPair[0].volume
    )
  ) {
    return 1
  }
  if (
    priceFallingVolumeRising &&
    !(
      previousPair &&
      previousPair[1].close < previousPair[0].close &&
      previousPair[1].volume > previousPair[0].volume
    )
  ) {
    return -1
  }
  return null
}

export function calculateStockTrackingDailyMetrics(
  bars: readonly KlineBar[],
  startedAt: string,
  stoppedAt?: string,
  capturedAt = new Date().toISOString()
): StockTrackingMetricSnapshot[] {
  const orderedBars = [...bars].sort((left, right) => left.time.localeCompare(right.time))
  const startedDate = dateKey(startedAt)
  const stoppedDate = stoppedAt ? dateKey(stoppedAt) : null
  const snapshots: StockTrackingMetricSnapshot[] = []
  const bollingerTrendByTime = new Map(
    calculateBollingerBandwidthTrends(orderedBars).map((point) => [point.time, point])
  )

  for (let index = 0; index < orderedBars.length; index += 1) {
    const current = orderedBars[index]
    const previous = orderedBars[index - 1]
    const tradingDate = dateKey(current.time)
    if (tradingDate < startedDate || (stoppedDate && tradingDate > stoppedDate)) continue

    const metrics: Record<string, number> = {
      [STOCK_TRACKING_BASE_METRICS.close]: current.close,
      [STOCK_TRACKING_BASE_METRICS.volume]: current.volume,
      [STOCK_TRACKING_BASE_METRICS.amount]: current.amount
    }
    if (previous) {
      metrics[STOCK_TRACKING_BASE_METRICS.changePercent] = percentageChange(
        current.close,
        previous.close
      )
    }
    const technicalSignals = candlestickShadowSignals(current)
    const bollingerSignal = bollingerTrendByTime.get(current.time)?.signal
    if (bollingerSignal) technicalSignals.push(bollingerSignal)
    for (const signal of TECHNICAL_PATTERN_SIGNALS) {
      metrics[STOCK_TRACKING_TECHNICAL_PATTERN_METRICS[signal]] = technicalSignals.includes(signal)
        ? 1
        : 0
    }

    for (const period of METRIC_PERIODS) {
      if (index < period) continue
      const previousBars = orderedBars.slice(index - period, index)
      const currentWindow = orderedBars.slice(index - period + 1, index + 1)
      const averagePreviousVolume = average(previousBars.map((bar) => bar.volume))
      if (averagePreviousVolume > 0) {
        metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[period]] =
          current.volume / averagePreviousVolume
      }
      metrics[STOCK_TRACKING_PRICE_RETURN_METRICS[period]] = percentageChange(
        current.close,
        orderedBars[index - period].close
      )
      metrics[STOCK_TRACKING_PRICE_AVERAGE_METRICS[period]] = average(
        currentWindow.map((bar) => bar.close)
      )
      metrics[STOCK_TRACKING_VOLUME_AVERAGE_METRICS[period]] = average(
        currentWindow.map((bar) => bar.volume)
      )
    }

    const currentDivergence = divergenceCode(orderedBars, index)
    if (currentDivergence !== null) {
      metrics[STOCK_TRACKING_BASE_METRICS.priceVolumeDivergence] = currentDivergence
    }
    snapshots.push({ tradingDate, capturedAt, metrics })
  }

  return snapshots
}

export function stockTrackingPriceVolumeState(
  snapshot: StockTrackingMetricSnapshot | undefined
): StockTrackingPriceVolumeState {
  if (!snapshot) return 'neutral'
  const changePercent = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.changePercent]
  const volumeRatio = snapshot.metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[5]]
  if (changePercent === undefined || changePercent === 0) return 'neutral'
  if (
    changePercent >= LARGE_PRICE_CHANGE_PERCENT &&
    volumeRatio !== undefined &&
    volumeRatio >= EXPANDED_VOLUME_RATIO
  ) {
    return 'volumeSurgePriceRise'
  }
  if (
    changePercent <= -LARGE_PRICE_CHANGE_PERCENT &&
    volumeRatio !== undefined &&
    volumeRatio >= EXPANDED_VOLUME_RATIO
  ) {
    return 'volumeSurgePriceFall'
  }
  if (changePercent > 0 && volumeRatio !== undefined && volumeRatio >= EXPANDED_VOLUME_RATIO) {
    return 'volumeRisePriceRise'
  }
  if (changePercent > 0 && volumeRatio !== undefined && volumeRatio <= CONTRACTED_VOLUME_RATIO) {
    return 'volumeFallPriceRise'
  }
  if (changePercent < 0 && volumeRatio !== undefined && volumeRatio >= EXPANDED_VOLUME_RATIO) {
    return 'volumeRisePriceFall'
  }
  if (changePercent < 0 && volumeRatio !== undefined && volumeRatio <= CONTRACTED_VOLUME_RATIO) {
    return 'volumeFallPriceFall'
  }
  return changePercent > 0 ? 'priceRise' : 'priceFall'
}

function aStockPriceLimitPercent(quoteId: string, stockName: string): number | null {
  if (!quoteId || marketFromQuoteId(quoteId) !== 'CN') return null
  if (exchangeFromQuoteId(quoteId) === 'BSE') return 30
  const code = quoteId.split('.')[1] ?? ''
  if (/^(300|301|688|689)/.test(code)) return 20
  return /^(?:S\*?ST|\*?ST)/i.test(stockName) ? 5 : 10
}

function isPriceLimit(
  snapshot: StockTrackingMetricSnapshot,
  quoteId: string,
  stockName: string,
  direction: 1 | -1
): boolean {
  const limitPercent = aStockPriceLimitPercent(quoteId, stockName)
  const close = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close]
  const changePercent = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.changePercent]
  if (
    limitPercent === null ||
    close === undefined ||
    changePercent === undefined ||
    Math.sign(changePercent) !== direction
  ) {
    return false
  }
  const changeRatio = 1 + changePercent / 100
  if (changeRatio <= 0) return false
  const previousClose = close / changeRatio
  const limitPrice =
    Math.round((previousClose * (1 + (direction * limitPercent) / 100) + Number.EPSILON) * 100) /
    100
  return Math.abs(close - limitPrice) < 0.005
}

export function stockTrackingPriceMovement(
  snapshot: StockTrackingMetricSnapshot | undefined,
  quoteId = '',
  stockName = ''
): StockTrackingPriceMovement {
  if (!snapshot) return 'flat'
  const changePercent = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.changePercent]
  if (changePercent === undefined || changePercent === 0) return 'flat'
  if (isPriceLimit(snapshot, quoteId, stockName, changePercent > 0 ? 1 : -1)) {
    return changePercent > 0 ? 'limitUp' : 'limitDown'
  }
  const absoluteChange = Math.abs(changePercent)
  if (absoluteChange >= LARGE_PRICE_CHANGE_PERCENT) {
    return changePercent > 0 ? 'strongRise' : 'strongFall'
  }
  if (absoluteChange >= NORMAL_PRICE_CHANGE_PERCENT) {
    return changePercent > 0 ? 'rise' : 'fall'
  }
  return changePercent > 0 ? 'slightRise' : 'slightFall'
}

export function stockTrackingPriceVolumeStateLabel(
  snapshot: StockTrackingMetricSnapshot | undefined,
  quoteId = '',
  stockName = ''
): string {
  const state = stockTrackingPriceVolumeState(snapshot)
  const movement = stockTrackingPriceMovement(snapshot, quoteId, stockName)
  if (movement === 'flat') return '量价平稳'
  const volumePrefix =
    state.startsWith('volumeRise') || state.startsWith('volumeSurge')
      ? '放量'
      : state.startsWith('volumeFall')
        ? '缩量'
        : ''
  return `${volumePrefix}${STOCK_TRACKING_PRICE_MOVEMENT_LABELS[movement]}`
}

export function stockTrackingPriceVolumeDivergence(
  snapshot: StockTrackingMetricSnapshot | undefined
): StockTrackingPriceVolumeDivergence | null {
  const value = snapshot?.metrics[STOCK_TRACKING_BASE_METRICS.priceVolumeDivergence]
  if (value === 1) return 'priceRiseVolumeFall'
  if (value === -1) return 'priceFallVolumeRise'
  return null
}

export function stockTrackingTechnicalPatternSignals(
  snapshot: StockTrackingMetricSnapshot | undefined
): TechnicalPatternSignalType[] {
  if (!snapshot) return []
  return TECHNICAL_PATTERN_SIGNALS.filter(
    (signal) => snapshot.metrics[STOCK_TRACKING_TECHNICAL_PATTERN_METRICS[signal]] === 1
  )
}

function sameMetrics(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left)
  const rightKeys = Object.keys(right)
  return (
    leftEntries.length === rightKeys.length &&
    leftEntries.every(([metricId, value]) => right[metricId] === value)
  )
}

export function mergeStockTrackingMetricSnapshots(
  profile: StockTrackingProfile,
  incoming: readonly StockTrackingMetricSnapshot[]
): StockTrackingProfile {
  if (incoming.length === 0) return profile
  const byDate = new Map(
    profile.metricSnapshots.map((snapshot) => [snapshot.tradingDate, snapshot])
  )
  let changed = false

  for (const snapshot of incoming) {
    const current = byDate.get(snapshot.tradingDate)
    const metrics = { ...current?.metrics, ...snapshot.metrics }
    if (current && sameMetrics(current.metrics, metrics)) continue
    byDate.set(snapshot.tradingDate, {
      tradingDate: snapshot.tradingDate,
      capturedAt: snapshot.capturedAt,
      metrics
    })
    changed = true
  }

  if (!changed) return profile
  return {
    ...profile,
    metricSnapshots: [...byDate.values()].sort((left, right) =>
      left.tradingDate.localeCompare(right.tradingDate)
    )
  }
}

export function latestStockTrackingMetric(
  snapshots: readonly StockTrackingMetricSnapshot[],
  metricId: string
): number | null {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const value = snapshots[index].metrics[metricId]
    if (value !== undefined) return value
  }
  return null
}
