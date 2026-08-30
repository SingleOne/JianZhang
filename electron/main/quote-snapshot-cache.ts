import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StockQuote } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

const QUOTE_SNAPSHOT_SCHEMA_VERSION = 1
const QUOTE_SNAPSHOT_WRITE_INTERVAL_MILLISECONDS = 30_000

interface StoredQuoteSnapshot {
  schemaVersion: typeof QUOTE_SNAPSHOT_SCHEMA_VERSION
  savedAt: string
  quotes: StockQuote[]
}

function quoteForCache(quote: StockQuote): StockQuote {
  const cached = { ...quote }
  delete cached.radarSignals
  delete cached.fiveLevelLargeOrders
  return cached
}

function isCachedQuote(value: unknown): value is StockQuote {
  return (
    typeof value === 'object' &&
    value !== null &&
    'quoteId' in value &&
    typeof value.quoteId === 'string'
  )
}

export class QuoteSnapshotCache {
  private readonly snapshotPath: string
  private pendingQuotes: StockQuote[] | null = null
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private lastWrittenAt = 0
  private disposed = false

  constructor(userDataDirectory: string) {
    this.snapshotPath = join(userDataDirectory, 'market-cache', 'quotes.json')
  }

  load(): StockQuote[] {
    if (!existsSync(this.snapshotPath)) return []
    try {
      const snapshot = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as StoredQuoteSnapshot
      if (
        snapshot.schemaVersion !== QUOTE_SNAPSHOT_SCHEMA_VERSION ||
        !Array.isArray(snapshot.quotes)
      ) {
        return []
      }
      return snapshot.quotes.filter(isCachedQuote)
    } catch {
      return []
    }
  }

  scheduleSave(quotes: readonly StockQuote[]): void {
    if (this.disposed) return
    this.pendingQuotes = quotes.map(quoteForCache)
    if (this.writeTimer) return

    const delay = Math.max(
      1_000,
      this.lastWrittenAt + QUOTE_SNAPSHOT_WRITE_INTERVAL_MILLISECONDS - Date.now()
    )
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, delay)
    this.writeTimer.unref()
  }

  dispose(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = null
    this.flush()
    this.disposed = true
  }

  private flush(): void {
    if (!this.pendingQuotes) return
    const quotes = this.pendingQuotes
    this.pendingQuotes = null
    try {
      atomicWriteJsonSync(
        this.snapshotPath,
        {
          schemaVersion: QUOTE_SNAPSHOT_SCHEMA_VERSION,
          savedAt: new Date().toISOString(),
          quotes
        } satisfies StoredQuoteSnapshot,
        false
      )
      this.lastWrittenAt = Date.now()
    } catch {}
  }
}
