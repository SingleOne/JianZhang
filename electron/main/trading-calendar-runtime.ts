import {
  normalizeTradingCalendarSettings,
  type AppState,
  type TradingCalendarSettings
} from '../../src/shared/types'
import type { MarketRequestLogger } from './market-request-logger'
import { fetchSseTradingCalendar } from './trading-calendar'

interface TradingCalendarRuntimeDependencies {
  getState: () => AppState
  saveState: (state: AppState) => void
  marketRequestLogger: MarketRequestLogger
}

export class TradingCalendarRuntime {
  private checkTimer: NodeJS.Timeout | null = null
  private refreshRequest: Promise<TradingCalendarSettings> | null = null

  constructor(private readonly dependencies: TradingCalendarRuntimeDependencies) {}

  start(): void {
    this.checkTimer = setInterval(
      () => void this.refreshAutomatically().catch(() => undefined),
      6 * 60 * 60 * 1000
    )
    void this.refreshAutomatically().catch(() => undefined)
  }

  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = null
  }

  refresh(): Promise<TradingCalendarSettings> {
    if (this.refreshRequest) return this.refreshRequest

    const year = new Date().getFullYear()
    const attemptedAt = new Date().toISOString()
    this.refreshRequest = this.dependencies.marketRequestLogger
      .track(
        {
          dataType: 'trading-calendar',
          caller: 'trading-calendar',
          source: 'sse',
          requestedCount: 1
        },
        () => fetchSseTradingCalendar(year),
        (result) => result.closedDates.length
      )
      .then((result) => {
        const current = this.dependencies.getState().settings.tradingCalendar
        const closedDates = [
          ...current.closedDates.filter((date) => !date.startsWith(`${result.year}-`)),
          ...result.closedDates
        ].sort()
        return this.saveCalendar({
          ...current,
          closedDates,
          coveredThroughYear: Math.max(current.coveredThroughYear, result.year),
          lastRefreshedAt: new Date().toISOString(),
          lastCheckedYear: result.year,
          lastAttemptedAt: attemptedAt,
          lastError: null
        })
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : '交易日历刷新失败'
        this.saveCalendar({
          ...this.dependencies.getState().settings.tradingCalendar,
          lastCheckedYear: year,
          lastAttemptedAt: attemptedAt,
          lastError: message
        })
        throw new Error(message)
      })
      .finally(() => {
        this.refreshRequest = null
      })
    return this.refreshRequest
  }

  refreshAutomatically(): Promise<TradingCalendarSettings> {
    const state = this.dependencies.getState()
    const year = new Date().getFullYear()
    if (state.settings.tradingCalendar.lastCheckedYear === year) {
      return Promise.resolve(state.settings.tradingCalendar)
    }
    return this.refresh()
  }

  private saveCalendar(calendar: TradingCalendarSettings): TradingCalendarSettings {
    const state = this.dependencies.getState()
    const normalized = normalizeTradingCalendarSettings(calendar)
    this.dependencies.saveState({
      ...state,
      settings: {
        ...state.settings,
        tradingCalendar: normalized
      }
    })
    return normalized
  }
}
