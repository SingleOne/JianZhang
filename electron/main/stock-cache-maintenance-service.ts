import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import {
  stockCacheCategories,
  type StockCacheCategoryId,
  type StockCacheClearResult
} from '../../src/shared/stock-cache'
import { atomicWriteJsonSync } from './file-storage'

interface StockCacheHandlers {
  clearKlines: (quoteId: string) => Promise<void>
  clearQuotes: (quoteId: string) => void
  clearMarketDetails: (quoteId: string) => Promise<void>
  clearShareholders: (quoteId: string) => Promise<void>
  clearValuations: (quoteId: string) => void
  clearMarketInsight?: (quoteId: string) => Promise<void>
}

interface CachedCandidate {
  providerId: string
  providerEventId: string
}

function removeFile(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}

function removeRecord(path: string, matches: (key: string) => boolean): void {
  if (!existsSync(path)) return
  const records = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const keys = Object.keys(records).filter(matches)
  if (keys.length === 0) return
  for (const key of keys) delete records[key]
  atomicWriteJsonSync(path, records)
}

function candidateDocumentName(candidate: CachedCandidate): string {
  return `${candidate.providerId.replace(/[^\w.-]/g, '_')}-${candidate.providerEventId.replace(/[^\w.-]/g, '_')}.json`
}

export class StockCacheMaintenanceService {
  constructor(
    private readonly userDataDirectory: string,
    private readonly handlers: StockCacheHandlers
  ) {}

  async clear(quoteId: string, categoryIds: StockCacheCategoryId[]): Promise<StockCacheClearResult> {
    if (!/^\d+\.[A-Za-z0-9.-]+$/.test(quoteId)) throw new Error('股票标识无效')
    const allowed = new Set(stockCacheCategories(quoteId).map(({ id }) => id))
    if (!Array.isArray(categoryIds) || categoryIds.some((id) => !allowed.has(id))) {
      throw new Error('缓存类别无效')
    }

    const result: StockCacheClearResult = { cleared: [], failed: [] }
    for (const id of new Set(categoryIds)) {
      try {
        await this.clearCategory(quoteId, id)
        result.cleared.push(id)
      } catch (reason) {
        result.failed.push({
          id,
          message: reason instanceof Error ? reason.message : '清理失败'
        })
      }
    }
    return result
  }

  private async clearCategory(quoteId: string, id: StockCacheCategoryId): Promise<void> {
    switch (id) {
      case 'klines':
        await this.handlers.clearKlines(quoteId)
        break
      case 'quotes':
        this.handlers.clearQuotes(quoteId)
        break
      case 'market-details':
        await this.handlers.clearMarketDetails(quoteId)
        break
      case 'shareholders':
        await this.handlers.clearShareholders(quoteId)
        break
      case 'valuations':
        this.handlers.clearValuations(quoteId)
        break
      case 'market-insight':
        await this.handlers.clearMarketInsight?.(quoteId)
        this.clearMarketInsightFiles(quoteId)
        break
      case 'company-reports':
        this.clearCompanyReports(quoteId)
        break
      case 'corporate-actions':
        this.clearCorporateActions(quoteId)
        break
      case 'ai-interpretations':
        this.clearAiInterpretations(quoteId)
        break
    }
  }

  private clearMarketInsightFiles(quoteId: string): void {
    const root = join(this.userDataDirectory, 'modules', 'market-insight')
    const directory = join(root, 'cache')
    if (existsSync(directory)) {
      const prefix = `${encodeURIComponent(quoteId)}-`
      for (const name of readdirSync(directory)) {
        if (name.startsWith(prefix) && name.endsWith('.json')) {
          removeFile(join(directory, name))
        }
      }
    }
    removeRecord(join(root, 'news-index.json'), (key) => key === quoteId)
  }

  private clearCompanyReports(quoteId: string): void {
    const market = marketFromQuoteId(quoteId)
    const safeId = quoteId.replace(/[^\w.-]/g, '_')
    const root = join(this.userDataDirectory, 'company-reports')
    removeFile(join(root, market.toLowerCase(), `${safeId}.json`))
    if (market === 'CN') removeFile(join(root, `${quoteId.split('.')[1]}.json`))
    removeFile(join(this.userDataDirectory, 'global-fundamentals', `${safeId}.json`))
  }

  private clearCorporateActions(quoteId: string): void {
    const root = join(this.userDataDirectory, 'corporate-actions')
    const candidatesRoot = join(root, 'candidates')
    const currentPath = join(
      candidatesRoot,
      marketFromQuoteId(quoteId),
      `${quoteId.replace(/[^\w.-]/g, '_')}.json`
    )
    if (!existsSync(currentPath)) return
    const current = JSON.parse(readFileSync(currentPath, 'utf8')) as {
      candidates?: CachedCandidate[]
    }
    const documentNames = new Set((current.candidates ?? []).map(candidateDocumentName))
    if (existsSync(candidatesRoot)) {
      for (const market of readdirSync(candidatesRoot, { withFileTypes: true })) {
        if (!market.isDirectory()) continue
        const directory = join(candidatesRoot, market.name)
        for (const name of readdirSync(directory)) {
          const path = join(directory, name)
          if (path === currentPath || !name.endsWith('.json')) continue
          const other = JSON.parse(readFileSync(path, 'utf8')) as {
            candidates?: CachedCandidate[]
          }
          for (const candidate of other.candidates ?? []) {
            documentNames.delete(candidateDocumentName(candidate))
          }
        }
      }
    }
    removeFile(currentPath)
    for (const name of documentNames) removeFile(join(root, 'documents', name))
  }

  private clearAiInterpretations(quoteId: string): void {
    const root = join(this.userDataDirectory, 'modules', 'ai', 'cache')
    removeRecord(
      join(root, 'interpretations.json'),
      (key) => key.startsWith(`${quoteId}:short-term:`) || key.startsWith(`long-term:${quoteId}:`)
    )
    removeRecord(
      join(root, 'latest-interpretations.json'),
      (key) => key === quoteId || key === `${quoteId}:long-term`
    )
  }
}
