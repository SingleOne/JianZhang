import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'

const LOG_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
const MARKET_LOG_FILE_PATTERN = /^market-requests-\d{4}-\d{2}-\d{2}\.jsonl$/

export interface MarketHttpRequestLog {
  dataType: string
  caller: string
  source: string
  fallbackFrom?: string
  requestedCount?: number
  attempt?: number
  returnedCount?: number
}

export interface QuoteCycleLog {
  reasons: readonly string[]
  stockCount: number
  indexCount: number
  sectorCount: number
  requestedCount: number
  returnedCount: number
  durationMs: number
  source?: string
  fallbackUsed?: boolean
  error?: string
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export class MarketRequestLogger {
  private nextRequestId = 1

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.cleanupExpiredLogs()
  }

  async track<T>(
    details: MarketHttpRequestLog,
    operation: () => Promise<T>,
    returnedCount: (value: T) => number = () => 1
  ): Promise<T> {
    const requestId = `${Date.now()}-${this.nextRequestId++}`
    const startedAt = new Date()
    const startedMilliseconds = Date.now()
    try {
      const value = await operation()
      const completedAt = new Date()
      this.write({
        type: 'http-request',
        requestId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Date.now() - startedMilliseconds,
        success: true,
        ...details,
        returnedCount: returnedCount(value)
      })
      return value
    } catch (reason) {
      const completedAt = new Date()
      this.write({
        type: 'http-request',
        requestId,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Date.now() - startedMilliseconds,
        success: false,
        ...details,
        error: errorMessage(reason)
      })
      throw reason
    }
  }

  logQuoteCycle(entry: QuoteCycleLog): void {
    this.write({
      type: 'quote-cycle',
      recordedAt: new Date().toISOString(),
      ...entry
    })
  }

  private cleanupExpiredLogs(): void {
    const expiredBefore = Date.now() - LOG_RETENTION_MILLISECONDS
    for (const name of readdirSync(this.directory)) {
      if (!MARKET_LOG_FILE_PATTERN.test(name)) continue
      const path = join(this.directory, name)
      try {
        if (statSync(path).mtimeMs < expiredBefore) unlinkSync(path)
      } catch {}
    }
  }

  private write(entry: object): void {
    const path = join(this.directory, `market-requests-${localDateKey()}.jsonl`)
    try {
      appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {}
  }
}
