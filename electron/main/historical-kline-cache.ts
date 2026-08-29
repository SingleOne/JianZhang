import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { isAfterMarketClose, isMarketOpen, marketDateKey } from '../../src/shared/market-hours'
import type { MarketCalendarDates } from '../../src/shared/market-calendar'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import { LruCache } from '../../src/shared/lru-cache'
import type { KlinePeriod, KlineResult } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

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
const DEFAULT_DISK_RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1000

function cacheKey(quoteId: string, period: HistoricalKlinePeriod): string {
  return `${quoteId}:${period}`
}

function cacheFileName(quoteId: string, period: HistoricalKlinePeriod): string {
  return `${quoteId.replaceAll('.', '_')}-${period}.json`
}

function isFresh(
  entry: HistoricalKlineCacheEntry,
  now: number,
  calendar: MarketCalendarDates | readonly string[]
): boolean {
  const market = marketFromQuoteId(entry.quoteId)
  const currentTrading = isMarketOpen(market, new Date(now), calendar)
  const cachedDuringTrading = isMarketOpen(market, new Date(entry.cachedAt), calendar)
  if (
    isAfterMarketClose(market, new Date(now), calendar) &&
    cachedDuringTrading &&
    marketDateKey(new Date(entry.cachedAt), market) === marketDateKey(new Date(now), market)
  ) {
    return false
  }
  const maxAge = currentTrading
    ? TRADING_CACHE_MAX_AGE_MILLISECONDS
    : CLOSED_CACHE_MAX_AGE_MILLISECONDS
  return now - entry.cachedAt < maxAge
}

function hasCompleteTurnover(data: KlineResult): boolean {
  return (
    data.bars.length > 0 &&
    data.bars.every(
      (bar) => typeof bar.turnoverRate === 'number' && Number.isFinite(bar.turnoverRate)
    )
  )
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
  private readonly entries: LruCache<string, HistoricalKlineCacheEntry | null>

  constructor(
    rootDirectory: string,
    maxMemoryEntries = 150,
    private readonly diskRetentionMilliseconds = DEFAULT_DISK_RETENTION_MILLISECONDS,
    private readonly now: () => number = Date.now
  ) {
    this.directory = join(rootDirectory, 'klines')
    this.entries = new LruCache(maxMemoryEntries)
    mkdirSync(this.directory, { recursive: true })
    this.cleanupExpiredFiles()
  }

  get(
    quoteId: string,
    period: HistoricalKlinePeriod,
    requestedLimit: number,
    calendar: MarketCalendarDates | readonly string[]
  ): KlineResult | null {
    const entry = this.read(quoteId, period)
    if (!entry || entry.requestedLimit < requestedLimit || !isFresh(entry, this.now(), calendar)) {
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
      cachedAt: this.now(),
      data: merged
    }
    this.entries.set(cacheKey(quoteId, period), entry)
    const path = join(this.directory, cacheFileName(quoteId, period))
    atomicWriteJsonSync(path, entry, false)
    this.touch(path)
    return merged
  }

  shouldKeepFallback(period: HistoricalKlinePeriod, data: KlineResult): boolean {
    return period === 'daily' && !hasCompleteTurnover(data)
  }

  private read(quoteId: string, period: HistoricalKlinePeriod): HistoricalKlineCacheEntry | null {
    const key = cacheKey(quoteId, period)
    const path = join(this.directory, cacheFileName(quoteId, period))
    if (this.entries.has(key)) {
      this.touch(path)
      return this.entries.get(key) ?? null
    }
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as HistoricalKlineCacheEntry
      const normalized =
        entry.version === 1 && entry.quoteId === quoteId && entry.period === period ? entry : null
      this.entries.set(key, normalized)
      if (normalized) this.touch(path)
      return normalized
    } catch {
      this.entries.set(key, null)
      return null
    }
  }

  private cleanupExpiredFiles(): void {
    const expiredBefore = this.now() - this.diskRetentionMilliseconds
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue
      const path = join(this.directory, name)
      try {
        if (statSync(path).mtimeMs < expiredBefore) unlinkSync(path)
      } catch {}
    }
  }

  private touch(path: string): void {
    try {
      const now = new Date(this.now())
      utimesSync(path, now, now)
    } catch {}
  }
}
