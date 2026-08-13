import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJsonSync } from '../../../../electron/main/file-storage'
import type {
  MarketInsightSettings,
  MarketInsightSnapshot,
  MarketNewsItem,
  WatchEvent
} from '../shared/types'
import { normalizeMarketInsightSettings } from '../shared/normalize'

interface StoredValue<T> {
  savedAt: string
  dataCutoffAt: string
  expiresAt: string
  value: T
}

export class MarketInsightStorage {
  private readonly cacheDirectory: string

  constructor(rootDirectory: string) {
    this.cacheDirectory = join(rootDirectory, 'cache')
    mkdirSync(this.cacheDirectory, { recursive: true })
  }

  loadSettings(): MarketInsightSettings {
    return normalizeMarketInsightSettings(this.read('settings.json', {}))
  }

  saveSettings(settings: MarketInsightSettings): void {
    this.write('settings.json', settings)
  }

  loadEvents(): WatchEvent[] {
    const events = this.read<WatchEvent[]>('events.json', [])
    return Array.isArray(events) ? events : []
  }

  saveEvents(events: readonly WatchEvent[]): void {
    this.write('events.json', events)
  }

  loadSnapshot(quoteId: string): MarketInsightSnapshot | null {
    const stored = this.read<StoredValue<MarketInsightSnapshot> | null>(
      `cache/${this.fileName(quoteId, 'snapshot', 'v2')}`,
      null
    )
    return stored?.value ?? null
  }

  saveSnapshot(snapshot: MarketInsightSnapshot): void {
    this.write(`cache/${this.fileName(snapshot.quoteId, 'snapshot', 'v2')}`, {
      savedAt: new Date().toISOString(),
      dataCutoffAt: snapshot.dataCutoffAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      value: snapshot
    })
  }

  loadCache<T>(quoteId: string, dataType: string, period: string): StoredValue<T> | null {
    return this.read<StoredValue<T> | null>(
      `cache/${this.fileName(quoteId, dataType, `${period}-source-v1`)}`,
      null
    )
  }

  saveCache<T>(
    quoteId: string,
    dataType: string,
    period: string,
    value: T,
    dataCutoffAt: string,
    interval: number
  ): StoredValue<T> {
    const stored = {
      savedAt: new Date().toISOString(),
      dataCutoffAt,
      expiresAt: new Date(Date.now() + interval).toISOString(),
      value
    }
    this.write(`cache/${this.fileName(quoteId, dataType, `${period}-source-v1`)}`, stored)
    return stored
  }

  loadNewsIndex(): Record<string, string[]> {
    return this.read<Record<string, string[]>>('news-index.json', {})
  }

  saveNewsIndex(index: Record<string, string[]>): void {
    this.write('news-index.json', index)
  }

  loadNews(quoteId: string): MarketNewsItem[] {
    return this.loadCache<MarketNewsItem[]>(quoteId, 'news', 'timeline-v1')?.value ?? []
  }

  saveNews(quoteId: string, items: readonly MarketNewsItem[], cacheHours: number): void {
    this.saveCache(
      quoteId,
      'news',
      'timeline-v1',
      items,
      items[0]?.publishedAt ?? new Date().toISOString(),
      cacheHours * 60 * 60_000
    )
  }

  loadRegularNewsQueryDates(): Record<string, string> {
    return this.read<Record<string, string>>('news-query-dates.json', {})
  }

  saveRegularNewsQueryDates(dates: Record<string, string>): void {
    this.write('news-query-dates.json', dates)
  }

  cleanupCache(retentionMilliseconds: number, maxFiles: number): void {
    const entries = readdirSync(this.cacheDirectory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const path = join(this.cacheDirectory, name)
        return { path, modifiedAt: statSync(path).mtimeMs }
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
    const cutoff = Date.now() - retentionMilliseconds
    for (const [index, entry] of entries.entries()) {
      if (entry.modifiedAt < cutoff || index >= maxFiles) unlinkSync(entry.path)
    }
  }

  private fileName(quoteId: string, dataType: string, period: string): string {
    return `${encodeURIComponent(quoteId)}-${dataType}-${period}.json`
  }

  private read<T>(relativePath: string, fallback: T): T {
    const filePath = join(this.cacheDirectory, '..', relativePath)
    if (!existsSync(filePath)) return fallback
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  private write(relativePath: string, value: unknown): void {
    const filePath = join(this.cacheDirectory, '..', relativePath)
    mkdirSync(join(filePath, '..'), { recursive: true })
    atomicWriteJsonSync(filePath, value)
  }
}
