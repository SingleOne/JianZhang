const MARKET_CLOSED_RANGES = [
  ['2021-01-01', '2021-01-03'],
  ['2021-02-11', '2021-02-17'],
  ['2021-04-03', '2021-04-05'],
  ['2021-05-01', '2021-05-05'],
  ['2021-06-12', '2021-06-14'],
  ['2021-09-19', '2021-09-21'],
  ['2021-10-01', '2021-10-07'],
  ['2022-01-01', '2022-01-03'],
  ['2022-01-31', '2022-02-06'],
  ['2022-04-03', '2022-04-05'],
  ['2022-04-30', '2022-05-04'],
  ['2022-06-03', '2022-06-05'],
  ['2022-09-10', '2022-09-12'],
  ['2022-10-01', '2022-10-07'],
  ['2022-12-31', '2023-01-02'],
  ['2023-01-21', '2023-01-27'],
  ['2023-04-05', '2023-04-05'],
  ['2023-04-29', '2023-05-03'],
  ['2023-06-22', '2023-06-24'],
  ['2023-09-29', '2023-10-06'],
  ['2023-12-30', '2024-01-01'],
  ['2024-02-09', '2024-02-17'],
  ['2024-04-04', '2024-04-06'],
  ['2024-05-01', '2024-05-05'],
  ['2024-06-10', '2024-06-10'],
  ['2024-09-15', '2024-09-17'],
  ['2024-10-01', '2024-10-07'],
  ['2025-01-01', '2025-01-01'],
  ['2025-01-28', '2025-02-04'],
  ['2025-04-04', '2025-04-06'],
  ['2025-05-01', '2025-05-05'],
  ['2025-05-31', '2025-06-02'],
  ['2025-10-01', '2025-10-08'],
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07']
] as const

const DAY_IN_MILLISECONDS = 86_400_000

function utcTime(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

const MARKET_CLOSED_DATES = new Set(
  MARKET_CLOSED_RANGES.flatMap(([startDate, endDate]) => {
    const dates: string[] = []
    const endTime = utcTime(endDate)
    for (let time = utcTime(startDate); time <= endTime; time += DAY_IN_MILLISECONDS) {
      dates.push(utcDateKey(time))
    }
    return dates
  })
)

const combinedClosedDatesCache = new WeakMap<readonly string[], ReadonlySet<string>>()

function marketClosedDates(additionalClosedDates: readonly string[]): ReadonlySet<string> {
  if (additionalClosedDates.length === 0) return MARKET_CLOSED_DATES
  const cached = combinedClosedDatesCache.get(additionalClosedDates)
  if (cached) return cached
  const combined = new Set([...MARKET_CLOSED_DATES, ...additionalClosedDates])
  combinedClosedDatesCache.set(additionalClosedDates, combined)
  return combined
}

export function isAStockTradingDay(
  dateKey: string,
  additionalClosedDates: readonly string[] = []
): boolean {
  const date = new Date(utcTime(dateKey))
  const dayOfWeek = date.getUTCDay()
  return dayOfWeek !== 0
    && dayOfWeek !== 6
    && !marketClosedDates(additionalClosedDates).has(dateKey)
}

export function countAStockTradingDays(
  startDate: string,
  endDate: string,
  additionalClosedDates: readonly string[] = []
): number {
  const startTime = utcTime(startDate)
  const endTime = utcTime(endDate)
  if (startTime > endTime) return 0

  const closedDates = marketClosedDates(additionalClosedDates)
  let count = 0
  for (let time = startTime; time <= endTime; time += DAY_IN_MILLISECONDS) {
    const date = new Date(time)
    const dayOfWeek = date.getUTCDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !closedDates.has(utcDateKey(time))) {
      count += 1
    }
  }

  return count
}
