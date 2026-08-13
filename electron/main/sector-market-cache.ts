import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StockQuote, StockSectorQuote, WatchStock } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

const BINDING_MAX_AGE_MILLISECONDS = 24 * 60 * 60 * 1000
const BINDING_FAILURE_COOLDOWN_MILLISECONDS = 5 * 60 * 1000
const SECTOR_QUOTE_MAX_AGE_MILLISECONDS = 60_000
const MAX_BINDING_REQUESTS = 4

export interface SectorBinding {
  boardCode: string
  boardName: string
  boardQuoteId: string
  cachedAt: number
}

interface SectorBindingDocument {
  version: 1
  bindings: Record<string, SectorBinding>
}

interface BindingJob {
  stockQuoteId: string
  resolve: (binding: SectorBinding) => void
  reject: (reason: unknown) => void
}

interface SectorQuoteCacheEntry {
  quote: StockQuote
  cachedAt: number
}

export class SectorMarketCache {
  private readonly bindingPath: string
  private readonly bindings = new Map<string, SectorBinding>()
  private readonly bindingFailures = new Map<string, number>()
  private readonly bindingRequests = new Map<string, Promise<SectorBinding>>()
  private readonly bindingQueue: BindingJob[] = []
  private readonly quotes = new Map<string, SectorQuoteCacheEntry>()
  private activeBindingRequests = 0

  constructor(
    rootDirectory: string,
    private readonly fetchBinding: (stockQuoteId: string) => Promise<SectorBinding>
  ) {
    mkdirSync(rootDirectory, { recursive: true })
    this.bindingPath = join(rootDirectory, 'sector-bindings.json')
    this.loadBindings()
  }

  async prime(stocks: readonly WatchStock[]): Promise<boolean> {
    const missing = stocks.filter((stock) => !this.getFreshBinding(stock.quoteId))
    if (missing.length === 0) return false
    const results = await Promise.allSettled(
      missing.map((stock) => this.ensureBinding(stock.quoteId))
    )
    return results.some((result) => result.status === 'fulfilled')
  }

  ensureBinding(stockQuoteId: string): Promise<SectorBinding> {
    const cached = this.getFreshBinding(stockQuoteId)
    if (cached) return Promise.resolve(cached)
    const existing = this.bindingRequests.get(stockQuoteId)
    if (existing) return existing
    const failedAt = this.bindingFailures.get(stockQuoteId) ?? 0
    if (Date.now() - failedAt < BINDING_FAILURE_COOLDOWN_MILLISECONDS) {
      return Promise.reject(new Error('所属板块信息正在等待下次重试'))
    }

    const request = new Promise<SectorBinding>((resolve, reject) => {
      this.bindingQueue.push({ stockQuoteId, resolve, reject })
      this.drainBindingQueue()
    })
    this.bindingRequests.set(stockQuoteId, request)
    request.then(
      () => this.bindingRequests.delete(stockQuoteId),
      () => this.bindingRequests.delete(stockQuoteId)
    )
    return request
  }

  dueBoardStocks(stocks: readonly WatchStock[]): WatchStock[] {
    const boards = new Map<string, WatchStock>()
    for (const stock of stocks) {
      const binding = this.getFreshBinding(stock.quoteId)
      if (!binding || this.isQuoteFresh(binding.boardQuoteId)) continue
      boards.set(binding.boardQuoteId, this.toBoardStock(binding))
    }
    return [...boards.values()]
  }

  boardStock(binding: SectorBinding): WatchStock {
    return this.toBoardStock(binding)
  }

  boardStockByQuoteId(boardQuoteId: string): WatchStock | null {
    const binding = [...this.bindings.values()].find((item) => item.boardQuoteId === boardQuoteId)
    return binding ? this.toBoardStock(binding) : null
  }

  saveQuotes(quotes: readonly StockQuote[]): void {
    const cachedAt = Date.now()
    for (const quote of quotes) this.quotes.set(quote.quoteId, { quote, cachedAt })
  }

  getFreshQuote(boardQuoteId: string): StockQuote | null {
    const cached = this.quotes.get(boardQuoteId)
    return cached && Date.now() - cached.cachedAt < SECTOR_QUOTE_MAX_AGE_MILLISECONDS
      ? cached.quote
      : null
  }

  sectorQuote(stockQuoteId: string): StockSectorQuote | null {
    const binding = this.bindings.get(stockQuoteId)
    const quote = binding ? this.quotes.get(binding.boardQuoteId)?.quote : undefined
    if (!binding || !quote) return null
    return {
      code: binding.boardCode,
      name: binding.boardName,
      quoteId: binding.boardQuoteId,
      changePercent: quote.changePercent
    }
  }

  private getFreshBinding(stockQuoteId: string): SectorBinding | null {
    const binding = this.bindings.get(stockQuoteId)
    return binding && Date.now() - binding.cachedAt < BINDING_MAX_AGE_MILLISECONDS ? binding : null
  }

  private isQuoteFresh(boardQuoteId: string): boolean {
    return this.getFreshQuote(boardQuoteId) !== null
  }

  private toBoardStock(binding: SectorBinding): WatchStock {
    return {
      code: binding.boardCode,
      name: binding.boardName,
      quoteId: binding.boardQuoteId,
      marketLabel: '行业板块',
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: false
    }
  }

  private drainBindingQueue(): void {
    while (this.activeBindingRequests < MAX_BINDING_REQUESTS && this.bindingQueue.length > 0) {
      const job = this.bindingQueue.shift()!
      this.activeBindingRequests += 1
      void this.fetchBinding(job.stockQuoteId)
        .then((binding) => {
          this.bindings.set(job.stockQuoteId, binding)
          this.bindingFailures.delete(job.stockQuoteId)
          this.saveBindings()
          job.resolve(binding)
        })
        .catch((reason) => {
          this.bindingFailures.set(job.stockQuoteId, Date.now())
          job.reject(reason)
        })
        .finally(() => {
          this.activeBindingRequests -= 1
          this.drainBindingQueue()
        })
    }
  }

  private loadBindings(): void {
    if (!existsSync(this.bindingPath)) return
    try {
      const document = JSON.parse(readFileSync(this.bindingPath, 'utf8')) as SectorBindingDocument
      if (document.version !== 1) return
      for (const [quoteId, binding] of Object.entries(document.bindings)) {
        this.bindings.set(quoteId, binding)
      }
    } catch {}
  }

  private saveBindings(): void {
    const document: SectorBindingDocument = {
      version: 1,
      bindings: Object.fromEntries(this.bindings)
    }
    atomicWriteJsonSync(this.bindingPath, document, false)
  }
}
