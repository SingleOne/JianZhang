import { beijingDateKey } from '../../src/shared/market-hours'
import type { FundsFlowResult } from '../../src/shared/types'

interface FundsFlowCacheEntry {
  data: FundsFlowResult
  cachedAt: number
}

function hasClosingData(data: FundsFlowResult): boolean {
  const lastPointTime = data.points.at(-1)?.time
  return data.tradingDate === beijingDateKey()
    && Boolean(lastPointTime && lastPointTime.slice(11, 16) >= '15:00')
}

export class FundsFlowHub {
  private readonly cache = new Map<string, FundsFlowCacheEntry>()
  private readonly requests = new Map<string, Promise<FundsFlowResult>>()
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly fetchFundsFlow: (quoteId: string, caller: string) => Promise<FundsFlowResult>,
    private readonly maxAgeMilliseconds: number
  ) {}

  get(quoteId: string, caller: string): Promise<FundsFlowResult> {
    const cached = this.cache.get(quoteId)
    if (cached && (
      hasClosingData(cached.data)
      || Date.now() - cached.cachedAt < this.maxAgeMilliseconds
    )) {
      return Promise.resolve(cached.data)
    }

    return this.requests.get(quoteId) ?? this.startRequest(quoteId, caller)
  }

  private startRequest(quoteId: string, caller: string): Promise<FundsFlowResult> {
    const request = this.enqueue(() => this.fetchFundsFlow(quoteId, caller))
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

  private enqueue(load: () => Promise<FundsFlowResult>): Promise<FundsFlowResult> {
    const request = this.requestQueue.then(load)
    this.requestQueue = request.then(() => undefined, () => undefined)
    return request
  }

  private finishRequest(quoteId: string, request: Promise<FundsFlowResult>): void {
    if (this.requests.get(quoteId) === request) this.requests.delete(quoteId)
  }
}
