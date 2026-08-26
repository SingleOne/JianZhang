import { usMarketCalendarForYear } from '../../src/shared/market-calendar'
import {
  normalizeTradingCalendarSettings,
  type AppState,
  type MarketTradingCalendarSettings,
  type TradingCalendarSettings
} from '../../src/shared/types'
import type { StockMarket } from '../../src/shared/stock-market'
import type { MarketRequestLogger } from './market-request-logger'
import {
  fetchHkexTradingCalendar,
  fetchSseTradingCalendar,
  type HkexTradingCalendar
} from './trading-calendar'

interface TradingCalendarRuntimeDependencies {
  getState: () => AppState
  saveState: (state: AppState) => void
  marketRequestLogger: MarketRequestLogger
}

function replaceCoveredYears(
  currentDates: readonly string[],
  calendars: readonly { year: number; dates: readonly string[] }[]
): string[] {
  const coveredYears = new Set(calendars.map((calendar) => calendar.year))
  return [
    ...currentDates.filter((date) => !coveredYears.has(Number(date.slice(0, 4)))),
    ...calendars.flatMap((calendar) => calendar.dates)
  ].sort()
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '交易日历刷新失败'
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
    const current = this.dependencies.getState().settings.tradingCalendar
    const requests: Array<[StockMarket, Promise<MarketTradingCalendarSettings>]> = [
      ['CN', this.refreshCn(current.markets.CN, year, attemptedAt)],
      ['HK', this.refreshHk(current.markets.HK, year, attemptedAt)],
      ['US', Promise.resolve(this.refreshUs(current.markets.US, year, attemptedAt))]
    ]
    this.refreshRequest = Promise.allSettled(requests.map(([, request]) => request))
      .then((results) => {
        const markets = { ...current.markets }
        let successCount = 0
        results.forEach((result, index) => {
          const market = requests[index][0]
          if (result.status === 'fulfilled') {
            markets[market] = result.value
            successCount += 1
          } else {
            markets[market] = {
              ...markets[market],
              lastCheckedYear: year,
              lastAttemptedAt: attemptedAt,
              lastError: errorMessage(result.reason)
            }
          }
        })
        const saved = this.saveCalendar({ ...current, markets })
        if (successCount === 0) {
          throw new Error(
            (['CN', 'HK', 'US'] as const)
              .map((market) => `${market}：${markets[market].lastError ?? '刷新失败'}`)
              .join('；')
          )
        }
        return saved
      })
      .finally(() => {
        this.refreshRequest = null
      })
    return this.refreshRequest
  }

  refreshAutomatically(): Promise<TradingCalendarSettings> {
    const calendar = this.dependencies.getState().settings.tradingCalendar
    const year = new Date().getFullYear()
    if (
      (['CN', 'HK', 'US'] as const).every(
        (market) =>
          calendar.markets[market].lastCheckedYear === year &&
          !calendar.markets[market].lastError
      )
    ) {
      return Promise.resolve(calendar)
    }
    return this.refresh()
  }

  private async refreshCn(
    current: MarketTradingCalendarSettings,
    year: number,
    attemptedAt: string
  ): Promise<MarketTradingCalendarSettings> {
    const result = await this.dependencies.marketRequestLogger.track(
      {
        dataType: 'trading-calendar',
        caller: 'trading-calendar:cn',
        source: 'sse',
        requestedCount: 1
      },
      () => fetchSseTradingCalendar(year),
      (calendar) => calendar.closedDates.length
    )
    return {
      ...current,
      closedDates: replaceCoveredYears(current.closedDates, [
        { year: result.year, dates: result.closedDates }
      ]),
      coveredThroughYear: Math.max(current.coveredThroughYear, result.year),
      source: 'sse',
      lastRefreshedAt: new Date().toISOString(),
      lastCheckedYear: year,
      lastAttemptedAt: attemptedAt,
      lastError: null
    }
  }

  private async refreshHk(
    current: MarketTradingCalendarSettings,
    year: number,
    attemptedAt: string
  ): Promise<MarketTradingCalendarSettings> {
    const years = [year, year + 1]
    const calendars = await Promise.all(years.map((calendarYear) =>
      this.dependencies.marketRequestLogger.track(
        {
          dataType: 'trading-calendar',
          caller: 'trading-calendar:hk',
          source: 'hkex',
          requestedCount: 1
        },
        () => fetchHkexTradingCalendar(calendarYear),
        (calendar) => calendar.closedDates.length + calendar.halfDayDates.length
      )
    ))
    return this.hkCalendarSettings(current, calendars, year, attemptedAt)
  }

  private hkCalendarSettings(
    current: MarketTradingCalendarSettings,
    calendars: readonly HkexTradingCalendar[],
    year: number,
    attemptedAt: string
  ): MarketTradingCalendarSettings {
    return {
      ...current,
      closedDates: replaceCoveredYears(
        current.closedDates,
        calendars.map((calendar) => ({ year: calendar.year, dates: calendar.closedDates }))
      ),
      halfDayDates: replaceCoveredYears(
        current.halfDayDates,
        calendars.map((calendar) => ({ year: calendar.year, dates: calendar.halfDayDates }))
      ),
      coveredThroughYear: Math.max(
        current.coveredThroughYear,
        ...calendars.map((calendar) => calendar.year)
      ),
      source: 'hkex',
      lastRefreshedAt: new Date().toISOString(),
      lastCheckedYear: year,
      lastAttemptedAt: attemptedAt,
      lastError: null
    }
  }

  private refreshUs(
    current: MarketTradingCalendarSettings,
    year: number,
    attemptedAt: string
  ): MarketTradingCalendarSettings {
    const calendars = [year, year + 1].map((calendarYear) => ({
      year: calendarYear,
      ...usMarketCalendarForYear(calendarYear)
    }))
    return {
      ...current,
      closedDates: replaceCoveredYears(
        current.closedDates,
        calendars.map((calendar) => ({ year: calendar.year, dates: calendar.closedDates }))
      ),
      halfDayDates: replaceCoveredYears(
        current.halfDayDates,
        calendars.map((calendar) => ({ year: calendar.year, dates: calendar.halfDayDates }))
      ),
      coveredThroughYear: Math.max(current.coveredThroughYear, year + 1),
      source: 'nyse-rules',
      lastRefreshedAt: new Date().toISOString(),
      lastCheckedYear: year,
      lastAttemptedAt: attemptedAt,
      lastError: null
    }
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
