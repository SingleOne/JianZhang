import type { StockMarket } from './stock-market'

export interface MarketCalendarDates {
  readonly closedDates: readonly string[]
  readonly halfDayDates: readonly string[]
}

export function isMarketCalendarDateArray(
  calendar: MarketCalendarDates | readonly string[] | undefined
): calendar is readonly string[] {
  return Array.isArray(calendar)
}

export type MarketCalendarSource = 'built-in' | 'sse' | 'hkex' | 'nyse-rules'

export const MARKET_CALENDAR_SOURCE_LABELS: Record<MarketCalendarSource, string> = {
  'built-in': '内置日历',
  sse: '上交所',
  hkex: '港交所',
  'nyse-rules': '纽交所规则'
}

export const BUILT_IN_MARKET_CALENDAR_END_YEARS: Record<StockMarket, number> = {
  CN: 2026,
  HK: 2027,
  US: 2028
}

const HK_CLOSED_DATES = [
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
  '2026-12-25',
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2027-03-26',
  '2027-03-29',
  '2027-04-05',
  '2027-05-13',
  '2027-06-09',
  '2027-07-01',
  '2027-09-16',
  '2027-10-01',
  '2027-10-08',
  '2027-12-27'
] as const

const HK_HALF_DAY_DATES = [
  '2026-02-16',
  '2026-12-24',
  '2026-12-31',
  '2027-02-05',
  '2027-12-24',
  '2027-12-31'
] as const

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7
  return dateKey(new Date(Date.UTC(year, month - 1, day)))
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0))
  const day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
  return dateKey(new Date(Date.UTC(year, month - 1, day)))
}

function observedDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1)
  return dateKey(date)
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

export function usMarketCalendarForYear(year: number): MarketCalendarDates {
  const goodFriday = easterSunday(year)
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2)
  const closedDates = [
    observedDate(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    dateKey(goodFriday),
    lastWeekdayOfMonth(year, 5, 1),
    observedDate(year, 6, 19),
    observedDate(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedDate(year, 12, 25)
  ].filter((date) => date.startsWith(`${year}-`))
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4)
  const dayAfterThanksgiving = new Date(`${thanksgiving}T00:00:00.000Z`)
  dayAfterThanksgiving.setUTCDate(dayAfterThanksgiving.getUTCDate() + 1)
  const halfDayCandidates = [dateKey(dayAfterThanksgiving), `${year}-07-03`, `${year}-12-24`]
  const closedDateSet = new Set(closedDates)
  const halfDayDates = halfDayCandidates.filter((date) => {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
    if (weekday === 0 || weekday === 6 || closedDateSet.has(date)) return false
    if (date.endsWith('-07-03')) {
      return new Date(Date.UTC(year, 6, 4)).getUTCDay() >= 2
    }
    return true
  })
  return {
    closedDates: [...new Set(closedDates)].sort(),
    halfDayDates: [...new Set(halfDayDates)].sort()
  }
}

export function builtInMarketCalendar(market: StockMarket): MarketCalendarDates {
  if (market === 'HK') {
    return { closedDates: HK_CLOSED_DATES, halfDayDates: HK_HALF_DAY_DATES }
  }
  if (market === 'US') {
    const calendars = [2026, 2027, 2028].map(usMarketCalendarForYear)
    return {
      closedDates: calendars.flatMap((calendar) => calendar.closedDates),
      halfDayDates: calendars.flatMap((calendar) => calendar.halfDayDates)
    }
  }
  return { closedDates: [], halfDayDates: [] }
}

export function mergeMarketCalendarDates(
  market: StockMarket,
  calendar?: MarketCalendarDates | readonly string[]
): MarketCalendarDates {
  const builtIn = builtInMarketCalendar(market)
  const additionalClosedDates = isMarketCalendarDateArray(calendar)
    ? calendar
    : (calendar?.closedDates ?? [])
  const additionalHalfDayDates = isMarketCalendarDateArray(calendar)
    ? []
    : (calendar?.halfDayDates ?? [])
  return {
    closedDates: [...new Set([...builtIn.closedDates, ...additionalClosedDates])],
    halfDayDates: [...new Set([...builtIn.halfDayDates, ...additionalHalfDayDates])]
  }
}
