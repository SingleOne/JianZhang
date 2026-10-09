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
  inputs: QuoteRefreshInput[]
  waiters: Array<{ resolve: (value: T) => void; reject: (reason: unknown) => void }>
}

export interface QuoteRefreshCoordinatorOptions<T> {
  getPriorityIntervalMilliseconds: () => number
  getRegularIntervalMilliseconds: () => number | null
  canAutoRefresh: () => boolean
  prepareInput?: (input: QuoteRefreshInput) => QuoteRefreshInput | null
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
    this.stopSchedule()
    const now = Date.now()
    this.nextPriorityAt = now + this.options.getPriorityIntervalMilliseconds()
    const regularInterval = this.options.getRegularIntervalMilliseconds()
    this.nextRegularAt = regularInterval === null ? Infinity : now + regularInterval
    this.scheduleNextTimer()
  }

  request(input: QuoteRefreshInput): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending = this.pending ?? {
        inputs: [],
        waiters: []
      }
      pending.inputs.push(input)
      pending.waiters.push({ resolve, reject })
      this.pending = pending
      queueMicrotask(() => void this.drain())
    })
  }

  stopSchedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stopSchedule()
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
      const regularInterval = this.options.getRegularIntervalMilliseconds()
      this.nextRegularAt = regularInterval === null ? Infinity : now + regularInterval
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
      // 在执行前按当前设置筛选每个请求，再合并，保留手动刷新各自的范围。
      const inputs = current.inputs
        .map((input) => (this.options.prepareInput ? this.options.prepareInput(input) : input))
        .filter((input): input is QuoteRefreshInput => input !== null)
      const value = await this.options.run({
        scopes: new Set(inputs.flatMap((input) => (input.scope ? [input.scope] : []))),
        reasons: new Set(inputs.map((input) => input.reason)),
        stockQuoteIds: new Set(inputs.flatMap((input) => input.stockQuoteIds ?? [])),
        sectorQuoteIds: new Set(inputs.flatMap((input) => input.sectorQuoteIds ?? [])),
        automatic: inputs.every((input) => Boolean(input.automatic))
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
