import type { KlinePeriod, KlineResult } from '../../src/shared/types'
import { LruCache } from '../../src/shared/lru-cache'
import type { HistoricalKlineCache } from './historical-kline-cache'

type HistoricalKlinePeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface LiveKlineCacheEntry {
  data: KlineResult
  cachedAt: number
}

function isHistoricalPeriod(period: KlinePeriod): period is HistoricalKlinePeriod {
  return period === 'daily' || period === 'weekly' || period === 'monthly'
}

function requestedLimit(period: KlinePeriod, limit?: number): number {
  if (period === 'intraday' || period === 'fiveDay') return 0
  const fallback = period === 'weekly' ? 104 : period === 'monthly' ? 60 : 120
  return Math.max(1, Math.round(limit ?? fallback))
}

function liveCacheKey(quoteId: string, period: KlinePeriod): string {
  return `${quoteId}:${period}`
}

function requestKey(quoteId: string, period: KlinePeriod, limit: number): string {
  return `${quoteId}:${period}:${limit}`
}

export class KlineHub {
  private readonly liveCache: LruCache<string, LiveKlineCacheEntry>
  private readonly requests = new Map<string, Promise<KlineResult>>()
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly fetchKline: (
      quoteId: string,
      period: KlinePeriod,
      limit: number | undefined,
      caller: string
    ) => Promise<KlineResult>,
    private readonly historicalCache: HistoricalKlineCache,
    private readonly getClosedDates: () => readonly string[],
    private readonly liveCacheMaxAgeMilliseconds: number,
    liveCacheMaxEntries = 100
  ) {
    this.liveCache = new LruCache(liveCacheMaxEntries)
  }

  get(
    quoteId: string,
    period: KlinePeriod,
    limit: number | undefined,
    caller: string
  ): Promise<KlineResult> {
    const normalizedLimit = requestedLimit(period, limit)
    const cached = this.getCached(quoteId, period, normalizedLimit)
    if (cached) return Promise.resolve(cached)

    const key = requestKey(quoteId, period, normalizedLimit)
    return (
      this.requests.get(key) ?? this.startRequest(key, quoteId, period, normalizedLimit, caller)
    )
  }

  private getCached(quoteId: string, period: KlinePeriod, limit: number): KlineResult | null {
    if (isHistoricalPeriod(period)) {
      return this.historicalCache.get(quoteId, period, limit, this.getClosedDates())
    }

    const cached = this.liveCache.get(liveCacheKey(quoteId, period))
    if (!cached) return null
    if (Date.now() - cached.cachedAt < this.liveCacheMaxAgeMilliseconds) return cached.data
    this.liveCache.delete(liveCacheKey(quoteId, period))
    return null
  }

  private startRequest(
    key: string,
    quoteId: string,
    period: KlinePeriod,
    limit: number,
    caller: string
  ): Promise<KlineResult> {
    const request = this.enqueue(() => this.load(quoteId, period, limit, caller))
    this.requests.set(key, request)
    request.then(
      () => this.finishRequest(key, request),
      () => this.finishRequest(key, request)
    )
    return request
  }

  private async load(
    quoteId: string,
    period: KlinePeriod,
    limit: number,
    caller: string
  ): Promise<KlineResult> {
    const cached = this.getCached(quoteId, period, limit)
    if (cached) return cached

    if (!isHistoricalPeriod(period)) {
      const data = await this.fetchKline(quoteId, period, undefined, caller)
      this.liveCache.set(liveCacheKey(quoteId, period), { data, cachedAt: Date.now() })
      return data
    }

    const fallback = this.historicalCache.getFallback(quoteId, period)
    try {
      const data = await this.fetchKline(quoteId, period, limit, caller)
      if (this.historicalCache.shouldKeepFallback(period, data)) return fallback ?? data
      return this.historicalCache.save(quoteId, period, limit, data)
    } catch (reason) {
      if (fallback) return fallback
      throw reason
    }
  }

  private enqueue(load: () => Promise<KlineResult>): Promise<KlineResult> {
    const request = this.requestQueue.then(load)
    this.requestQueue = request.then(
      () => undefined,
      () => undefined
    )
    return request
  }

  private finishRequest(key: string, request: Promise<KlineResult>): void {
    if (this.requests.get(key) === request) this.requests.delete(key)
  }
}
