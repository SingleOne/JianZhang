import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOG_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
const LOG_CLEANUP_INTERVAL_MILLISECONDS = 60 * 60 * 1000
const LOG_FLUSH_INTERVAL_MILLISECONDS = 1_000
const LOG_FLUSH_ENTRY_COUNT = 100
const LOG_SEGMENT_MAX_BYTES = 5 * 1024 * 1024
const LOG_SEGMENT_LIMIT = 4
const LOG_TOTAL_MAX_BYTES = 50 * 1024 * 1024
const SUCCESS_SAMPLE_INTERVAL = 20
const SLOW_REQUEST_MILLISECONDS = 2_000
const MARKET_LOG_FILE_PATTERN = /^market-requests-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/

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
  private successfulRequestCount = 0
  private quoteCycleCount = 0
  private entries: string[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupTimer: ReturnType<typeof setInterval>
  private flushing: Promise<void> | null = null
  private disposed = false

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    void this.cleanupExpiredLogs()
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredLogs(),
      LOG_CLEANUP_INTERVAL_MILLISECONDS
    )
    this.cleanupTimer.unref()
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
      const durationMs = Date.now() - startedMilliseconds
      this.successfulRequestCount += 1
      if (
        durationMs >= SLOW_REQUEST_MILLISECONDS ||
        details.fallbackFrom ||
        (details.attempt ?? 1) > 1 ||
        this.successfulRequestCount % SUCCESS_SAMPLE_INTERVAL === 0
      ) {
        this.enqueue({
          type: 'http-request',
          requestId,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs,
          success: true,
          ...details,
          returnedCount: returnedCount(value)
        })
      }
      return value
    } catch (reason) {
      this.enqueue({
        type: 'http-request',
        requestId,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMilliseconds,
        success: false,
        ...details,
        error: errorMessage(reason)
      })
      throw reason
    }
  }

  logQuoteCycle(entry: QuoteCycleLog): void {
    this.quoteCycleCount += 1
    if (
      !entry.error &&
      !entry.fallbackUsed &&
      this.quoteCycleCount % SUCCESS_SAMPLE_INTERVAL !== 0
    ) {
      return
    }
    this.enqueue({
      type: 'quote-cycle',
      recordedAt: new Date().toISOString(),
      ...entry
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.cleanupTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (this.entries.length === 0) return
    const content = this.entries.splice(0).join('')
    const path = this.currentSegmentPathSync(Buffer.byteLength(content))
    if (!path) return
    try {
      appendFileSync(path, content, 'utf8')
    } catch {}
  }

  private enqueue(entry: object): void {
    if (this.disposed) return
    this.entries.push(`${JSON.stringify(entry)}\n`)
    if (this.entries.length >= LOG_FLUSH_ENTRY_COUNT) {
      void this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), LOG_FLUSH_INTERVAL_MILLISECONDS)
      this.flushTimer.unref()
    }
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (this.flushing) {
      await this.flushing
      if (this.entries.length > 0) await this.flush()
      return
    }
    if (this.entries.length === 0) return
    const content = this.entries.splice(0).join('')
    this.flushing = this.writeBatch(content).finally(() => {
      this.flushing = null
    })
    await this.flushing
  }

  private async writeBatch(content: string): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true })
      const path = await this.currentSegmentPath(Buffer.byteLength(content))
      if (path) await appendFile(path, content, 'utf8')
    } catch {}
  }

  private segmentPath(index: number): string {
    const suffix = index === 0 ? '' : `-${index}`
    return join(this.directory, `market-requests-${localDateKey()}${suffix}.jsonl`)
  }

  private async currentSegmentPath(incomingBytes: number): Promise<string | null> {
    for (let index = 0; index < LOG_SEGMENT_LIMIT; index += 1) {
      const path = this.segmentPath(index)
      try {
        if ((await stat(path)).size + incomingBytes <= LOG_SEGMENT_MAX_BYTES) return path
      } catch {
        return path
      }
    }
    return null
  }

  private currentSegmentPathSync(incomingBytes: number): string | null {
    for (let index = 0; index < LOG_SEGMENT_LIMIT; index += 1) {
      const path = this.segmentPath(index)
      if (!existsSync(path) || statSync(path).size + incomingBytes <= LOG_SEGMENT_MAX_BYTES) {
        return path
      }
    }
    return null
  }

  private async cleanupExpiredLogs(): Promise<void> {
    const expiredBefore = Date.now() - LOG_RETENTION_MILLISECONDS
    try {
      const files: Array<{ path: string; modifiedAt: number; size: number }> = []
      for (const name of await readdir(this.directory)) {
        if (!MARKET_LOG_FILE_PATTERN.test(name)) continue
        const path = join(this.directory, name)
        try {
          const details = await stat(path)
          if (details.mtimeMs < expiredBefore) await unlink(path)
          else files.push({ path, modifiedAt: details.mtimeMs, size: details.size })
        } catch {}
      }
      let totalBytes = files.reduce((total, file) => total + file.size, 0)
      for (const file of files.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
        if (totalBytes <= LOG_TOTAL_MAX_BYTES) break
        try {
          await unlink(file.path)
          totalBytes -= file.size
        } catch {}
      }
    } catch {}
  }
}
