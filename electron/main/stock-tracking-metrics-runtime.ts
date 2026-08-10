import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_PRICE_VOLUME_DIVERGENCE_LABELS,
  calculateStockTrackingDailyMetrics,
  mergeStockTrackingMetricSnapshots,
  stockTrackingPriceVolumeDivergence,
  type StockTrackingPriceVolumeDivergence
} from '../../src/lib/stock-tracking-metrics'
import { addStockTrackingSystemEntry } from '../../src/lib/stock-tracking'
import type { AppState, KlineResult, StockTrackingProfile } from '../../src/shared/types'

const TRACKING_METRICS_REFRESH_MILLISECONDS = 30 * 60 * 1000
const TRACKING_METRICS_KLINE_LIMIT = 500

interface StockTrackingMetricsRuntimeDependencies {
  getState: () => AppState
  setState: (state: AppState) => void
  persistState: () => void
  sendStateUpdated: (state: AppState) => void
  getDailyKline: (quoteId: string, limit: number) => Promise<KlineResult>
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
}

export class StockTrackingMetricsRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private rerunRequested = false
  private rerunForced = false
  private readonly capturedQuoteIds = new Set<string>()

  constructor(private readonly dependencies: StockTrackingMetricsRuntimeDependencies) {}

  start(): void {
    if (this.timer) return
    void this.capture(true)
    this.timer = setInterval(() => void this.capture(true), TRACKING_METRICS_REFRESH_MILLISECONDS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  capture(force = false): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true
      this.rerunForced ||= force
      return this.inFlight
    }

    const profiles = Object.values(this.dependencies.getState().stockTrackingProfiles).filter(
      (profile) =>
        profile.status === 'tracking' && (force || !this.capturedQuoteIds.has(profile.quoteId))
    )
    if (profiles.length === 0) return Promise.resolve()

    const capturedAt = (this.dependencies.now?.() ?? new Date()).toISOString()
    this.inFlight = Promise.all(
      profiles.map((profile) =>
        this.dependencies
          .getDailyKline(profile.quoteId, TRACKING_METRICS_KLINE_LIMIT)
          .then((result): CapturedKline => ({ quoteId: profile.quoteId, bars: result.bars }))
          .catch(() => null)
      )
    )
      .then((results) => this.applyResults(results, capturedAt))
      .finally(() => {
        this.inFlight = null
        if (!this.rerunRequested) return
        const rerunForced = this.rerunForced
        this.rerunRequested = false
        this.rerunForced = false
        void this.capture(rerunForced)
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
      this.capturedQuoteIds.add(result.quoteId)
      const profile = profiles[result.quoteId]
      if (!profile || profile.status !== 'tracking') continue
      const snapshots = calculateStockTrackingDailyMetrics(
        result.bars,
        profile.startedAt,
        profile.stoppedAt,
        capturedAt
      )
      let nextProfile = mergeStockTrackingMetricSnapshots(profile, snapshots)
      const latestSnapshot = snapshots.at(-1)
      const divergence = stockTrackingPriceVolumeDivergence(latestSnapshot)
      if (latestSnapshot && divergence) {
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
      if (nextProfile === profile) continue
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
