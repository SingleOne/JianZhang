import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ShareholderSnapshot } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import {
  eastmoneyShareholderCode,
  normalizeEastmoneyShareholderPayload,
  type EastmoneyShareholderPayload
} from './shareholder-data'

interface ShareholderCacheEntry {
  version: 1
  cachedAt: number
  snapshot: ShareholderSnapshot
}

const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
type ShareholderFetch = (url: string, init?: RequestInit) => Promise<Response>

const fetchWithElectron: ShareholderFetch = async (url, init) => {
  const { net } = await import('electron')
  return net.fetch(url, init)
}

export class ShareholderService {
  private readonly directory: string
  private readonly memory = new Map<string, ShareholderCacheEntry>()
  private readonly requests = new Map<string, Promise<ShareholderSnapshot>>()

  constructor(
    rootDirectory: string,
    private readonly now: () => number = Date.now,
    private readonly fetcher: ShareholderFetch = fetchWithElectron
  ) {
    this.directory = join(rootDirectory, 'shareholders')
    mkdirSync(this.directory, { recursive: true })
  }

  get(quoteId: string, forceRefresh = false): Promise<ShareholderSnapshot> {
    const cached = this.read(quoteId)
    if (!forceRefresh && cached && this.now() - cached.cachedAt < CACHE_MAX_AGE) {
      return Promise.resolve({ ...cached.snapshot, fromCache: true })
    }
    const pending = this.requests.get(quoteId)
    if (pending) return pending
    const request = this.fetchAndPersist(quoteId, cached).finally(() => {
      if (this.requests.get(quoteId) === request) this.requests.delete(quoteId)
    })
    this.requests.set(quoteId, request)
    return request
  }

  private async fetchAndPersist(
    quoteId: string,
    cached: ShareholderCacheEntry | null
  ): Promise<ShareholderSnapshot> {
    try {
      const identity = eastmoneyShareholderCode(quoteId)
      const url = new URL('https://emweb.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax')
      url.searchParams.set('code', identity.eastmoneyCode)
      const response = await this.fetcher(url.toString(), {
        headers: {
          Referer: 'https://emweb.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0'
        },
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) throw new Error(`股东信息接口返回 ${response.status}`)
      const fetchedAt = new Date(this.now()).toISOString()
      const snapshot = normalizeEastmoneyShareholderPayload(
        quoteId,
        (await response.json()) as EastmoneyShareholderPayload,
        fetchedAt
      )
      const entry: ShareholderCacheEntry = {
        version: 1,
        cachedAt: this.now(),
        snapshot
      }
      this.memory.set(quoteId, entry)
      atomicWriteJsonSync(this.path(quoteId), entry)
      return snapshot
    } catch (reason) {
      if (!cached) throw reason
      return {
        ...cached.snapshot,
        fromCache: true,
        warning: `实时更新失败，当前展示 ${cached.snapshot.fetchedAt.slice(0, 10)} 保存的数据`
      }
    }
  }

  private path(quoteId: string): string {
    return join(this.directory, `${quoteId.replaceAll('.', '_')}.json`)
  }

  private read(quoteId: string): ShareholderCacheEntry | null {
    if (this.memory.has(quoteId)) return this.memory.get(quoteId) ?? null
    const path = this.path(quoteId)
    if (!existsSync(path)) return null
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as ShareholderCacheEntry
      if (entry.version !== 1 || entry.snapshot.quoteId !== quoteId) return null
      this.memory.set(quoteId, entry)
      return entry
    } catch {
      return null
    }
  }
}
