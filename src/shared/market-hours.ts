import { isAStockTradingDay } from './trading-calendar'

const BEIJING_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

const AUTO_REFRESH_WINDOWS = [
  [9 * 60 * 60 + 15 * 60, 11 * 60 * 60 + 30 * 60 + 30],
  [12 * 60 * 60 + 59 * 60 + 30, 15 * 60 * 60 + 30 * 60 + 30]
] as const

function beijingMillisecondsOfDay(date: Date): number {
  const beijingTime = new Date(date.getTime() + BEIJING_OFFSET_MILLISECONDS)
  return beijingTime.getUTCHours() * 60 * 60 * 1000
    + beijingTime.getUTCMinutes() * 60 * 1000
    + beijingTime.getUTCSeconds() * 1000
    + beijingTime.getUTCMilliseconds()
}

export function isBeijingAutoRefreshTime(
  date = new Date(),
  additionalClosedDates: readonly string[] = []
): boolean {
  const beijingDateKey = new Date(date.getTime() + BEIJING_OFFSET_MILLISECONDS).toISOString().slice(0, 10)
  if (!isAStockTradingDay(beijingDateKey, additionalClosedDates)) return false
  const current = beijingMillisecondsOfDay(date)
  return AUTO_REFRESH_WINDOWS.some(([start, end]) => (
    current >= start * 1000 && current < (end + 1) * 1000
  ))
}

export function millisecondsUntilNextAutoRefreshWindow(date = new Date()): number {
  const current = beijingMillisecondsOfDay(date)
  for (const [start] of AUTO_REFRESH_WINDOWS) {
    const startMilliseconds = start * 1000
    if (current < startMilliseconds) return startMilliseconds - current
  }
  return DAY_MILLISECONDS - current + AUTO_REFRESH_WINDOWS[0][0] * 1000
}
