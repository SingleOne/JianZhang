import type { StockMarket } from './stock-market'
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

const MARKET_TIME_ZONES: Record<StockMarket, string> = {
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  US: 'America/New_York'
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

const HK_CLOSED_DATES = new Set([
  '2026-01-01',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-04-03',
  '2026-04-06',
  '2026-04-07',
  '2026-05-01',
  '2026-05-25',
  '2026-06-19',
  '2026-07-01',
  '2026-10-01',
  '2026-10-19',
  '2026-12-25'
])

const HK_HALF_DAYS = new Set(['2026-02-16', '2026-12-24', '2026-12-31'])

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0))
  const day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

function observedDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function usClosedDates(year: number): ReadonlySet<string> {
  const goodFriday = easterSunday(year)
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2)
  return new Set([
    observedDate(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    goodFriday.toISOString().slice(0, 10),
    lastWeekdayOfMonth(year, 5, 1),
    observedDate(year, 6, 19),
    observedDate(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedDate(year, 12, 25)
  ])
}

function usEarlyCloseDate(dateKey: string): boolean {
  const year = Number(dateKey.slice(0, 4))
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4)
  const dayAfterThanksgiving = new Date(`${thanksgiving}T00:00:00.000Z`)
  dayAfterThanksgiving.setUTCDate(dayAfterThanksgiving.getUTCDate() + 1)
  return dateKey === dayAfterThanksgiving.toISOString().slice(0, 10) || dateKey === `${year}-12-24`
}

function marketClock(date: Date, market: StockMarket): MarketClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIME_ZONES[market],
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
  additionalClosedDates: readonly string[]
): boolean {
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return false
  if (market === 'CN') return isAStockTradingDay(clock.dateKey, additionalClosedDates)
  if (market === 'HK') return !HK_CLOSED_DATES.has(clock.dateKey)
  return !usClosedDates(Number(clock.dateKey.slice(0, 4))).has(clock.dateKey)
}

function sessionsForDate(market: StockMarket, dateKey: string): readonly MarketSession[] {
  if (market === 'HK' && HK_HALF_DAYS.has(dateKey)) {
    return [{ start: 9 * 60, end: 12 * 60 + 10 }]
  }
  if (market === 'US' && usEarlyCloseDate(dateKey)) {
    return [{ start: 9 * 60 + 30, end: 13 * 60 }]
  }
  return REGULAR_SESSIONS[market]
}

export function marketDateKey(date: Date, market: StockMarket): string {
  return marketClock(date, market).dateKey
}

export function beijingDateKey(date = new Date()): string {
  return marketDateKey(date, 'CN')
}

export function isMarketOpen(
  market: StockMarket,
  date = new Date(),
  additionalClosedDates: readonly string[] = []
): boolean {
  const clock = marketClock(date, market)
  if (!isTradingDay(market, clock, additionalClosedDates)) return false
  return sessionsForDate(market, clock.dateKey).some(
    (session) => clock.minutes >= session.start && clock.minutes < session.end
  )
}

export function isAfterMarketClose(
  market: StockMarket,
  date = new Date(),
  additionalClosedDates: readonly string[] = []
): boolean {
  const clock = marketClock(date, market)
  if (!isTradingDay(market, clock, additionalClosedDates)) return false
  const sessions = sessionsForDate(market, clock.dateKey)
  return clock.minutes >= sessions[sessions.length - 1].end
}

export function millisecondsUntilNextMarketOpen(
  market: StockMarket,
  date = new Date(),
  additionalClosedDates: readonly string[] = []
): number {
  if (isMarketOpen(market, date, additionalClosedDates)) return 0
  const coarseStepMinutes = 30
  let lastClosedMinutes = 0
  for (let minutes = coarseStepMinutes; minutes <= 8 * 24 * 60; minutes += coarseStepMinutes) {
    const candidate = new Date(date.getTime() + minutes * MINUTE_MILLISECONDS)
    if (isMarketOpen(market, candidate, additionalClosedDates)) {
      for (let exactMinutes = lastClosedMinutes + 1; exactMinutes <= minutes; exactMinutes += 1) {
        const exactCandidate = new Date(date.getTime() + exactMinutes * MINUTE_MILLISECONDS)
        if (isMarketOpen(market, exactCandidate, additionalClosedDates)) {
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
