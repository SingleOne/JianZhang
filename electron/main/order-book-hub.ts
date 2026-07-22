import type { StockOrderBook } from '../../src/shared/types'

const DEFAULT_MAX_AGE_MILLISECONDS = 3_000
const MINIMUM_REQUEST_INTERVAL_MILLISECONDS = 750

interface OrderBookCacheEntry {
  data: StockOrderBook
  cachedAt: number
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

  constructor(private readonly fetchOrderBook: (quoteId: string) => Promise<StockOrderBook>) {}

  async get(quoteId: string, options: OrderBookRequestOptions = {}): Promise<StockOrderBook> {
    const cached = this.cache.get(quoteId)
    const maxAgeMilliseconds = options.maxAgeMilliseconds ?? DEFAULT_MAX_AGE_MILLISECONDS
    if (!options.force && cached && Date.now() - cached.cachedAt < maxAgeMilliseconds) {
      return { ...cached.data, dataState: 'cached' }
    }

    try {
      const data = await (this.requests.get(quoteId) ?? this.startRequest(quoteId))
      return { ...data, dataState: 'live' }
    } catch (reason) {
      return this.staleOrThrow(cached, errorMessage(reason), options.allowStaleOnError)
    }
  }

  private startRequest(quoteId: string): Promise<StockOrderBook> {
    const request = this.enqueue(() => this.fetchOrderBook(quoteId))
      .then((data) => {
        this.cache.set(quoteId, { data, cachedAt: Date.now() })
        return data
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
    message: string,
    allowStaleOnError = false
  ): StockOrderBook {
    if (!cached || !allowStaleOnError) throw new Error(message)
    return {
      ...cached.data,
      dataState: 'stale',
      refreshError: message
    }
  }
}
