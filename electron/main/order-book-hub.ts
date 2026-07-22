import type { StockOrderBook } from '../../src/shared/types'

const DEFAULT_MAX_AGE_MILLISECONDS = 3_000
const MINIMUM_REQUEST_INTERVAL_MILLISECONDS = 750
const FAILURE_BACKOFF_MILLISECONDS = [5_000, 10_000, 20_000, 30_000] as const

interface OrderBookCacheEntry {
  data: StockOrderBook
  cachedAt: number
}

interface OrderBookFailure {
  count: number
  message: string
  retryAt: number
}

export interface OrderBookRequestOptions {
  maxAgeMilliseconds?: number
  force?: boolean
  allowStaleOnError?: boolean
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '盘口服务暂时不可用'
}

export class OrderBookHub {
  private readonly cache = new Map<string, OrderBookCacheEntry>()
  private readonly requests = new Map<string, Promise<StockOrderBook>>()
  private requestQueue: Promise<void> = Promise.resolve()
  private nextRequestAt = 0
  private failure: OrderBookFailure | null = null

  constructor(private readonly fetchOrderBook: (quoteId: string) => Promise<StockOrderBook>) {}

  async get(quoteId: string, options: OrderBookRequestOptions = {}): Promise<StockOrderBook> {
    const cached = this.cache.get(quoteId)
    const maxAgeMilliseconds = options.maxAgeMilliseconds ?? DEFAULT_MAX_AGE_MILLISECONDS
    if (!options.force && cached && Date.now() - cached.cachedAt < maxAgeMilliseconds) {
      return { ...cached.data, dataState: 'cached' }
    }

    const failure = this.failure
    if (failure && failure.retryAt > Date.now()) {
      return this.staleOrThrow(cached, failure, options.allowStaleOnError)
    }

    try {
      const data = await (this.requests.get(quoteId) ?? this.startRequest(quoteId))
      return { ...data, dataState: 'live' }
    } catch (reason) {
      return this.staleOrThrow(
        cached,
        this.failure ?? { count: 1, message: errorMessage(reason), retryAt: Date.now() },
        options.allowStaleOnError
      )
    }
  }

  private startRequest(quoteId: string): Promise<StockOrderBook> {
    const request = this.enqueue(() => this.fetchOrderBook(quoteId))
      .then((data) => {
        this.cache.set(quoteId, { data, cachedAt: Date.now() })
        this.failure = null
        return data
      })
      .catch((reason: unknown) => {
        const previousCount = this.failure?.count ?? 0
        const count = previousCount + 1
        const delay = FAILURE_BACKOFF_MILLISECONDS[Math.min(count - 1, FAILURE_BACKOFF_MILLISECONDS.length - 1)]
        this.failure = {
          count,
          message: errorMessage(reason),
          retryAt: Date.now() + delay
        }
        throw reason
      })

    this.requests.set(quoteId, request)
    request.then(
      () => this.finishRequest(quoteId, request),
      () => this.finishRequest(quoteId, request)
    )
    return request
  }

  private finishRequest(quoteId: string, request: Promise<StockOrderBook>): void {
    if (this.requests.get(quoteId) === request) this.requests.delete(quoteId)
  }

  private enqueue(load: () => Promise<StockOrderBook>): Promise<StockOrderBook> {
    const request = this.requestQueue.then(async () => {
      const waitMilliseconds = Math.max(0, this.nextRequestAt - Date.now())
      if (waitMilliseconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMilliseconds))
      }
      this.nextRequestAt = Date.now() + MINIMUM_REQUEST_INTERVAL_MILLISECONDS
      return load()
    })
    this.requestQueue = request.then(() => undefined, () => undefined)
    return request
  }

  private staleOrThrow(
    cached: OrderBookCacheEntry | undefined,
    failure: OrderBookFailure,
    allowStaleOnError = false
  ): StockOrderBook {
    if (!cached || !allowStaleOnError) throw new Error(failure.message)
    return {
      ...cached.data,
      dataState: 'stale',
      refreshError: failure.message,
      retryAt: new Date(failure.retryAt).toISOString()
    }
  }
}
