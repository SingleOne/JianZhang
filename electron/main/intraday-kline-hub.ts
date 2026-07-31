import type { KlineResult } from '../../src/shared/types'

interface IntradayCacheEntry {
  data: KlineResult
  cachedAt: number
}

export class IntradayKlineHub {
  private readonly cache = new Map<string, IntradayCacheEntry>()
  private readonly requests = new Map<string, Promise<KlineResult>>()
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly fetchKline: (quoteId: string, caller: string) => Promise<KlineResult>,
    private readonly maxAgeMilliseconds: number
  ) {}

  get(quoteId: string, caller: string): Promise<KlineResult> {
    const cached = this.cache.get(quoteId)
    if (cached && Date.now() - cached.cachedAt < this.maxAgeMilliseconds) {
      return Promise.resolve(cached.data)
    }

    return this.requests.get(quoteId) ?? this.startRequest(quoteId, caller)
  }

  private startRequest(quoteId: string, caller: string): Promise<KlineResult> {
    const request = this.enqueue(() => this.fetchKline(quoteId, caller))
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

  private enqueue(load: () => Promise<KlineResult>): Promise<KlineResult> {
    const request = this.requestQueue.then(load)
    this.requestQueue = request.then(() => undefined, () => undefined)
    return request
  }

  private finishRequest(quoteId: string, request: Promise<KlineResult>): void {
    if (this.requests.get(quoteId) === request) this.requests.delete(quoteId)
  }
}
