import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isBeijingAutoRefreshTime } from '../../src/shared/market-hours'
import type { KlinePeriod, KlineResult } from '../../src/shared/types'

type HistoricalKlinePeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface HistoricalKlineCacheEntry {
  version: 1
  quoteId: string
  period: HistoricalKlinePeriod
  requestedLimit: number
  cachedAt: number
  data: KlineResult
}

const TRADING_CACHE_MAX_AGE_MILLISECONDS = 5 * 60 * 1000
const CLOSED_CACHE_MAX_AGE_MILLISECONDS = 18 * 60 * 60 * 1000

function cacheKey(quoteId: string, period: HistoricalKlinePeriod): string {
  return `${quoteId}:${period}`
}

function cacheFileName(quoteId: string, period: HistoricalKlinePeriod): string {
  return `${quoteId.replaceAll('.', '_')}-${period}.json`
}

function beijingDateKey(timestamp: number): string {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function isFresh(
  entry: HistoricalKlineCacheEntry,
  now: number,
  closedDates: readonly string[]
): boolean {
  const currentTrading = isBeijingAutoRefreshTime(new Date(now), closedDates)
  const cachedDuringTrading = isBeijingAutoRefreshTime(new Date(entry.cachedAt), closedDates)
  if (
    !currentTrading
    && cachedDuringTrading
    && beijingDateKey(entry.cachedAt) === beijingDateKey(now)
    && new Date(now + 8 * 60 * 60 * 1000).getUTCHours() >= 15
  ) {
    return false
  }
  const maxAge = currentTrading
    ? TRADING_CACHE_MAX_AGE_MILLISECONDS
    : CLOSED_CACHE_MAX_AGE_MILLISECONDS
  return now - entry.cachedAt < maxAge
}

function hasCompleteTurnover(data: KlineResult): boolean {
  return data.bars.length > 0 && data.bars.every((bar) => (
    typeof bar.turnoverRate === 'number' && Number.isFinite(bar.turnoverRate)
  ))
}

function mergeKlineData(previous: KlineResult | undefined, current: KlineResult): KlineResult {
  if (!previous) return current
  const barsByTime = new Map(previous.bars.map((bar) => [bar.time, bar]))
  for (const bar of current.bars) barsByTime.set(bar.time, bar)
  const bars = [...barsByTime.values()].sort((left, right) => left.time.localeCompare(right.time))
  const firstDate = bars[0]?.time.slice(0, 10) ?? ''
  const lastDate = bars.at(-1)?.time.slice(0, 10) ?? ''
  return {
    ...current,
    tradingDate: firstDate === lastDate ? lastDate : `${firstDate} 至 ${lastDate}`,
    bars
  }
}

export class HistoricalKlineCache {
  private readonly directory: string
  private readonly entries = new Map<string, HistoricalKlineCacheEntry | null>()

  constructor(rootDirectory: string) {
    this.directory = join(rootDirectory, 'klines')
    mkdirSync(this.directory, { recursive: true })
  }

  get(
    quoteId: string,
    period: HistoricalKlinePeriod,
    requestedLimit: number,
    closedDates: readonly string[]
  ): KlineResult | null {
    const entry = this.read(quoteId, period)
    if (!entry || entry.requestedLimit < requestedLimit || !isFresh(entry, Date.now(), closedDates)) {
      return null
    }
    return entry.data
  }

  getFallback(quoteId: string, period: HistoricalKlinePeriod): KlineResult | null {
    return this.read(quoteId, period)?.data ?? null
  }

  save(
    quoteId: string,
    period: HistoricalKlinePeriod,
    requestedLimit: number,
    data: KlineResult
  ): KlineResult {
    const previous = this.read(quoteId, period)
    const merged = mergeKlineData(previous?.data, data)
    const entry: HistoricalKlineCacheEntry = {
      version: 1,
      quoteId,
      period,
      requestedLimit: Math.max(previous?.requestedLimit ?? 0, requestedLimit),
      cachedAt: Date.now(),
      data: merged
    }
    this.entries.set(cacheKey(quoteId, period), entry)
    writeFileSync(
      join(this.directory, cacheFileName(quoteId, period)),
      JSON.stringify(entry),
      'utf8'
    )
    return merged
  }

  shouldKeepFallback(period: HistoricalKlinePeriod, data: KlineResult): boolean {
    return period === 'daily' && !hasCompleteTurnover(data)
  }

  private read(quoteId: string, period: HistoricalKlinePeriod): HistoricalKlineCacheEntry | null {
    const key = cacheKey(quoteId, period)
    if (this.entries.has(key)) return this.entries.get(key) ?? null
    try {
      const entry = JSON.parse(readFileSync(
        join(this.directory, cacheFileName(quoteId, period)),
        'utf8'
      )) as HistoricalKlineCacheEntry
      const normalized = entry.version === 1 && entry.quoteId === quoteId && entry.period === period
        ? entry
        : null
      this.entries.set(key, normalized)
      return normalized
    } catch {
      this.entries.set(key, null)
      return null
    }
  }
}
