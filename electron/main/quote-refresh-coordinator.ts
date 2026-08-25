export type QuoteRefreshScope = 'priority' | 'regular' | 'all'

const TIMER_COALESCING_TOLERANCE_MILLISECONDS = 50

export interface QuoteRefreshInput {
  scope?: QuoteRefreshScope
  reason: string
  stockQuoteIds?: readonly string[]
  sectorQuoteIds?: readonly string[]
  automatic?: boolean
}

export interface QuoteRefreshBatch {
  scopes: ReadonlySet<QuoteRefreshScope>
  reasons: ReadonlySet<string>
  stockQuoteIds: ReadonlySet<string>
  sectorQuoteIds: ReadonlySet<string>
  automatic: boolean
}

interface PendingRefresh<T> {
  scopes: Set<QuoteRefreshScope>
  reasons: Set<string>
  stockQuoteIds: Set<string>
  sectorQuoteIds: Set<string>
  automatic: boolean
  waiters: Array<{ resolve: (value: T) => void; reject: (reason: unknown) => void }>
}

export interface QuoteRefreshCoordinatorOptions<T> {
  getPriorityIntervalMilliseconds: () => number
  getRegularIntervalMilliseconds: () => number
  canAutoRefresh: () => boolean
  run: (batch: QuoteRefreshBatch) => Promise<T>
}

export class QuoteRefreshCoordinator<T> {
  private timer: NodeJS.Timeout | null = null
  private nextPriorityAt = 0
  private nextRegularAt = 0
  private pending: PendingRefresh<T> | null = null
  private inFlight = false

  constructor(private readonly options: QuoteRefreshCoordinatorOptions<T>) {}

  start(): void {
    this.restartSchedule()
  }

  restartSchedule(): void {
    if (this.timer) clearTimeout(this.timer)
    const now = Date.now()
    this.nextPriorityAt = now + this.options.getPriorityIntervalMilliseconds()
    this.nextRegularAt = now + this.options.getRegularIntervalMilliseconds()
    this.scheduleNextTimer()
  }

  request(input: QuoteRefreshInput): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending = this.pending ?? {
        scopes: new Set<QuoteRefreshScope>(),
        reasons: new Set<string>(),
        stockQuoteIds: new Set<string>(),
        sectorQuoteIds: new Set<string>(),
        automatic: true,
        waiters: []
      }
      if (input.scope) pending.scopes.add(input.scope)
      pending.reasons.add(input.reason)
      pending.automatic = pending.automatic && Boolean(input.automatic)
      for (const quoteId of input.stockQuoteIds ?? []) pending.stockQuoteIds.add(quoteId)
      for (const quoteId of input.sectorQuoteIds ?? []) pending.sectorQuoteIds.add(quoteId)
      pending.waiters.push({ resolve, reject })
      this.pending = pending
      queueMicrotask(() => void this.drain())
    })
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleNextTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    const nextAt = Math.min(this.nextPriorityAt, this.nextRegularAt)
    this.timer = setTimeout(() => this.handleTimer(), Math.max(0, nextAt - Date.now()))
  }

  private handleTimer(): void {
    const now = Date.now()
    const dueScopes: QuoteRefreshScope[] = []
    if (now + TIMER_COALESCING_TOLERANCE_MILLISECONDS >= this.nextPriorityAt) {
      dueScopes.push('priority')
      this.nextPriorityAt = now + this.options.getPriorityIntervalMilliseconds()
    }
    if (now + TIMER_COALESCING_TOLERANCE_MILLISECONDS >= this.nextRegularAt) {
      dueScopes.push('regular')
      this.nextRegularAt = now + this.options.getRegularIntervalMilliseconds()
    }
    this.scheduleNextTimer()

    if (!this.options.canAutoRefresh() || dueScopes.length === 0) return
    for (const scope of dueScopes) {
      void this.request({ scope, reason: `timer:${scope}`, automatic: true })
    }
  }

  private async drain(): Promise<void> {
    if (this.inFlight || !this.pending) return
    const current = this.pending
    this.pending = null
    this.inFlight = true
    try {
      const value = await this.options.run({
        scopes: current.scopes,
        reasons: current.reasons,
        stockQuoteIds: current.stockQuoteIds,
        sectorQuoteIds: current.sectorQuoteIds,
        automatic: current.automatic
      })
      for (const waiter of current.waiters) waiter.resolve(value)
    } catch (reason) {
      for (const waiter of current.waiters) waiter.reject(reason)
    } finally {
      this.inFlight = false
      if (this.pending) void this.drain()
    }
  }
}
