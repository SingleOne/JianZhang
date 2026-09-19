import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS,
  calculateStockTrackingDailyMetrics,
  mergeStockTrackingMetricSnapshots,
  stockTrackingPriceVolumeDivergence,
  type StockTrackingPriceVolumeDivergence
} from '../../src/lib/stock-tracking-metrics'
import { addStockTrackingSystemEntry } from '../../src/lib/stock-tracking'
import {
  isAfterMarketClose,
  isMarketTradingDate,
  marketDateKey
} from '../../src/shared/market-hours'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import type {
  AppState,
  KlineBar,
  KlineDateRange,
  KlineResult,
  StockTrackingProfile
} from '../../src/shared/types'

const TRACKING_METRICS_REFRESH_MILLISECONDS = 30 * 60 * 1000
const TRACKING_METRICS_CONTEXT_DAYS = 24
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

interface StockTrackingMetricsRuntimeDependencies {
  getState: () => AppState
  setState: (state: AppState) => void
  persistState: () => void
  sendStateUpdated: (state: AppState) => void
  getDailyKline: (quoteId: string, dateRange: KlineDateRange) => Promise<KlineResult>
  notifyPriceVolumeDivergence: (
    profile: StockTrackingProfile,
    divergence: StockTrackingPriceVolumeDivergence,
    tradingDate: string
  ) => void
  now?: () => Date
}

interface CapturedKline {
  quoteId: string
  bars: KlineResult['bars']
  startDate: string
  endDate: string
}

function shiftDate(date: string, days: number): string {
  const timestamp = new Date(`${date}T00:00:00.000Z`).getTime()
  return new Date(timestamp + days * DAY_MILLISECONDS).toISOString().slice(0, 10)
}

function previousTradingDate(profile: StockTrackingProfile, state: AppState, date: string): string {
  const market = profile.market ?? marketFromQuoteId(profile.quoteId)
  const calendar = state.settings.tradingCalendar.markets[market]
  let candidate = shiftDate(date, -1)
  while (!isMarketTradingDate(market, candidate, calendar)) candidate = shiftDate(candidate, -1)
  return candidate
}

function latestCompletedKlineDate(
  profile: StockTrackingProfile,
  state: AppState,
  now: Date
): string {
  const market = profile.market ?? marketFromQuoteId(profile.quoteId)
  const calendar = state.settings.tradingCalendar.markets[market]
  const currentDate = marketDateKey(now, market)
  if (
    isMarketTradingDate(market, currentDate, calendar) &&
    isAfterMarketClose(market, now, calendar)
  ) {
    return currentDate
  }
  return previousTradingDate(profile, state, currentDate)
}

function pendingKlineRange(
  profile: StockTrackingProfile,
  state: AppState,
  now: Date
): KlineDateRange | null {
  const market = profile.market ?? marketFromQuoteId(profile.quoteId)
  const calendar = state.settings.tradingCalendar.markets[market]
  const startedDate = marketDateKey(new Date(profile.startedAt), market)
  const startDate = profile.lastCompletedKlineDate
    ? shiftDate(profile.lastCompletedKlineDate, 1)
    : isMarketTradingDate(market, startedDate, calendar)
      ? startedDate
      : previousTradingDate(profile, state, startedDate)
  const endDate = latestCompletedKlineDate(profile, state, now)
  return startDate <= endDate ? { startDate, endDate } : null
}

function completedMetricContext(profile: StockTrackingProfile): KlineBar[] {
  return profile.metricSnapshots.slice(-TRACKING_METRICS_CONTEXT_DAYS).flatMap((snapshot) => {
    const close = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.close]
    const volume = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.volume]
    const amount = snapshot.metrics[STOCK_TRACKING_BASE_METRICS.amount]
    if (close === undefined || volume === undefined || amount === undefined) return []
    return [
      {
        time: snapshot.tradingDate,
        open: close,
        close,
        high: close,
        low: close,
        volume,
        amount
      }
    ]
  })
}

export class StockTrackingMetricsRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private rerunRequested = false

  constructor(private readonly dependencies: StockTrackingMetricsRuntimeDependencies) {}

  start(): void {
    if (this.timer) return
    void this.capture()
    this.timer = setInterval(() => void this.capture(), TRACKING_METRICS_REFRESH_MILLISECONDS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  capture(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true
      return this.inFlight
    }

    const currentState = this.dependencies.getState()
    const capturedAtDate = this.dependencies.now?.() ?? new Date()
    const requests = Object.values(currentState.stockTrackingProfiles).flatMap((profile) => {
      if (profile.status !== 'tracking') return []
      const dateRange = pendingKlineRange(profile, currentState, capturedAtDate)
      if (!dateRange) return []
      return [
        this.dependencies
          .getDailyKline(profile.quoteId, dateRange)
          .then((result): CapturedKline => ({
            quoteId: profile.quoteId,
            bars: result.bars,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate
          }))
          .catch(() => null)
      ]
    })
    if (requests.length === 0) return Promise.resolve()

    const capturedAt = capturedAtDate.toISOString()
    this.inFlight = Promise.all(requests)
      .then((results) => this.applyResults(results, capturedAt))
      .finally(() => {
        this.inFlight = null
        if (!this.rerunRequested) return
        this.rerunRequested = false
        void this.capture()
      })
    return this.inFlight
  }

  private applyResults(results: Array<CapturedKline | null>, capturedAt: string): void {
    const currentState = this.dependencies.getState()
    let profiles = currentState.stockTrackingProfiles
    let changed = false
    const reminders: Array<{
      profile: StockTrackingProfile
      divergence: StockTrackingPriceVolumeDivergence
      tradingDate: string
    }> = []

    for (const result of results) {
      if (!result) continue
      const profile = profiles[result.quoteId]
      if (!profile || profile.status !== 'tracking') continue
      const barsByTime = new Map(
        [...completedMetricContext(profile), ...result.bars].map((bar) => [bar.time, bar])
      )
      const snapshots = calculateStockTrackingDailyMetrics(
        [...barsByTime.values()],
        result.startDate,
        profile.stoppedAt,
        capturedAt
      ).filter(
        (snapshot) =>
          (!profile.lastCompletedKlineDate ||
            snapshot.tradingDate > profile.lastCompletedKlineDate) &&
          snapshot.tradingDate <= result.endDate
      )
      const latestSnapshot = snapshots.at(-1)
      if (!latestSnapshot) continue
      let nextProfile: StockTrackingProfile = {
        ...mergeStockTrackingMetricSnapshots(profile, snapshots),
        lastCompletedKlineDate: latestSnapshot.tradingDate
      }
      const divergence = stockTrackingPriceVolumeDivergence(latestSnapshot)
      if (divergence) {
        const reminderId = `tracking:price-volume-divergence:${latestSnapshot.tradingDate}:${divergence}`
        const withReminder = addStockTrackingSystemEntry(
          nextProfile,
          reminderId,
          `量价背离提醒：${STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS[divergence]}`,
          {
            latest: latestSnapshot.metrics[STOCK_TRACKING_BASE_METRICS.close],
            changePercent:
              latestSnapshot.metrics[STOCK_TRACKING_BASE_METRICS.changePercent] ?? null,
            capturedAt
          },
          capturedAt
        )
        if (withReminder !== nextProfile) {
          nextProfile = withReminder
          reminders.push({
            profile: nextProfile,
            divergence,
            tradingDate: latestSnapshot.tradingDate
          })
        }
      }
      profiles = { ...profiles, [profile.quoteId]: nextProfile }
      changed = true
    }

    if (!changed) return
    const nextState: AppState = { ...currentState, stockTrackingProfiles: profiles }
    this.dependencies.setState(nextState)
    this.dependencies.persistState()
    this.dependencies.sendStateUpdated(nextState)
    reminders.forEach(({ profile, divergence, tradingDate }) =>
      this.dependencies.notifyPriceVolumeDivergence(profile, divergence, tradingDate)
    )
  }
}
