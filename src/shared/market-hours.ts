import { STOCK_MARKET_TIME_ZONES, type StockMarket } from './stock-market'
import {
  builtInMarketCalendar,
  isMarketCalendarDateArray,
  type MarketCalendarDates
} from './market-calendar'
import { isAStockTradingDay } from './trading-calendar'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const MINUTE_MILLISECONDS = 60 * 1000

export const INTRADAY_REFRESH_MILLISECONDS = 30_000
export const FUNDS_FLOW_REFRESH_MILLISECONDS = 2 * 60_000

interface MarketClock {
  dateKey: string
  weekday: string
  minutes: number
}

interface MarketSession {
  start: number
  end: number
}

const REGULAR_SESSIONS: Record<StockMarket, readonly MarketSession[]> = {
  CN: [
    { start: 9 * 60 + 15, end: 11 * 60 + 30 },
    { start: 13 * 60, end: 15 * 60 }
  ],
  HK: [
    { start: 9 * 60, end: 12 * 60 },
    { start: 13 * 60, end: 16 * 60 + 10 }
  ],
  US: [{ start: 9 * 60 + 30, end: 16 * 60 }]
}

type MarketCalendarInput = MarketCalendarDates | readonly string[]

interface ResolvedMarketCalendar {
  closedDates: string[]
  closedDateSet: ReadonlySet<string>
  halfDayDateSet: ReadonlySet<string>
}

function resolvedBuiltInCalendar(market: StockMarket): ResolvedMarketCalendar {
  const calendar = builtInMarketCalendar(market)
  return {
    closedDates: [...calendar.closedDates],
    closedDateSet: new Set(calendar.closedDates),
    halfDayDateSet: new Set(calendar.halfDayDates)
  }
}

const BUILT_IN_CALENDARS: Record<StockMarket, ResolvedMarketCalendar> = {
  CN: resolvedBuiltInCalendar('CN'),
  HK: resolvedBuiltInCalendar('HK'),
  US: resolvedBuiltInCalendar('US')
}

const resolvedCalendarCache: Record<StockMarket, WeakMap<object, ResolvedMarketCalendar>> = {
  CN: new WeakMap(),
  HK: new WeakMap(),
  US: new WeakMap()
}

function resolveMarketCalendar(
  market: StockMarket,
  calendar?: MarketCalendarInput
): ResolvedMarketCalendar {
  if (!calendar) return BUILT_IN_CALENDARS[market]
  const key = calendar as object
  const cached = resolvedCalendarCache[market].get(key)
  if (cached) return cached
  const builtIn = BUILT_IN_CALENDARS[market]
  const additionalClosedDates = isMarketCalendarDateArray(calendar)
    ? calendar
    : calendar.closedDates
  const additionalHalfDayDates = isMarketCalendarDateArray(calendar) ? [] : calendar.halfDayDates
  const closedDates = [...new Set([...builtIn.closedDates, ...additionalClosedDates])]
  const resolved = {
    closedDates,
    closedDateSet: new Set(closedDates),
    halfDayDateSet: new Set([...builtIn.halfDayDateSet, ...additionalHalfDayDates])
  }
  resolvedCalendarCache[market].set(key, resolved)
  return resolved
}

function marketClock(date: Date, market: StockMarket): MarketClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCK_MARKET_TIME_ZONES[market],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return {
    dateKey: `${part('year')}-${part('month')}-${part('day')}`,
    weekday: part('weekday'),
    minutes: Number(part('hour')) * 60 + Number(part('minute'))
  }
}

function isTradingDay(
  market: StockMarket,
  clock: MarketClock,
  calendar: ResolvedMarketCalendar
): boolean {
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return false
  if (market === 'CN') return isAStockTradingDay(clock.dateKey, calendar.closedDates)
  return !calendar.closedDateSet.has(clock.dateKey)
}

function sessionsForDate(
  market: StockMarket,
  dateKey: string,
  calendar: ResolvedMarketCalendar
): readonly MarketSession[] {
  if (market === 'HK' && calendar.halfDayDateSet.has(dateKey)) {
    return [{ start: 9 * 60, end: 12 * 60 + 10 }]
  }
  if (market === 'US' && calendar.halfDayDateSet.has(dateKey)) {
    return [{ start: 9 * 60 + 30, end: 13 * 60 }]
  }
  return REGULAR_SESSIONS[market]
}

export function marketDateKey(date: Date, market: StockMarket): string {
  return marketClock(date, market).dateKey
}

export function isMarketTradingDate(
  market: StockMarket,
  dateKey: string,
  calendarInput?: MarketCalendarInput
): boolean {
  const date = new Date(`${dateKey}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]
  return isTradingDay(
    market,
    { dateKey, weekday, minutes: 12 * 60 },
    resolveMarketCalendar(market, calendarInput)
  )
}

export function countMarketTradingDays(
  market: StockMarket,
  startDateKey: string,
  endDateKey: string,
  calendarInput?: MarketCalendarInput
): number {
  const start = new Date(`${startDateKey}T00:00:00Z`)
  const end = new Date(`${endDateKey}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  let count = 0
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MILLISECONDS) {
    const dateKey = new Date(cursor).toISOString().slice(0, 10)
    if (isMarketTradingDate(market, dateKey, calendarInput)) count += 1
  }
  return count
}

export function beijingDateKey(date = new Date()): string {
  return marketDateKey(date, 'CN')
}

export function isMarketOpen(
  market: StockMarket,
  date = new Date(),
  calendarInput?: MarketCalendarInput
): boolean {
  const clock = marketClock(date, market)
  const calendar = resolveMarketCalendar(market, calendarInput)
  if (!isTradingDay(market, clock, calendar)) return false
  return sessionsForDate(market, clock.dateKey, calendar).some(
    (session) => clock.minutes >= session.start && clock.minutes < session.end
  )
}

export function isAfterMarketClose(
  market: StockMarket,
  date = new Date(),
  calendarInput?: MarketCalendarInput
): boolean {
  const clock = marketClock(date, market)
  const calendar = resolveMarketCalendar(market, calendarInput)
  if (!isTradingDay(market, clock, calendar)) return false
  const sessions = sessionsForDate(market, clock.dateKey, calendar)
  return clock.minutes >= sessions[sessions.length - 1].end
}

export function millisecondsUntilNextMarketOpen(
  market: StockMarket,
  date = new Date(),
  calendarInput?: MarketCalendarInput
): number {
  if (isMarketOpen(market, date, calendarInput)) return 0
  const coarseStepMinutes = 30
  let lastClosedMinutes = 0
  for (let minutes = coarseStepMinutes; minutes <= 8 * 24 * 60; minutes += coarseStepMinutes) {
    const candidate = new Date(date.getTime() + minutes * MINUTE_MILLISECONDS)
    if (isMarketOpen(market, candidate, calendarInput)) {
      for (let exactMinutes = lastClosedMinutes + 1; exactMinutes <= minutes; exactMinutes += 1) {
        const exactCandidate = new Date(date.getTime() + exactMinutes * MINUTE_MILLISECONDS)
        if (isMarketOpen(market, exactCandidate, calendarInput)) {
          return exactCandidate.getTime() - date.getTime()
        }
      }
    }
    lastClosedMinutes = minutes
  }
  return DAY_MILLISECONDS
}

export function isBeijingAutoRefreshTime(
  date = new Date(),
  additionalClosedDates: readonly string[] = []
): boolean {
  return isMarketOpen('CN', date, additionalClosedDates)
}

export function millisecondsUntilNextAutoRefreshWindow(date = new Date()): number {
  return millisecondsUntilNextMarketOpen('CN', date)
}
