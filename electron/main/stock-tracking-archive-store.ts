import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { calculateStockTrackingPerformance } from '../../src/lib/stock-tracking-performance'
import type {
  StockTrackingArchiveIndex,
  StockTrackingArchiveSummary,
  StockTrackingCycleSummary,
  StockTrackingProfile
} from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

const ARCHIVE_DIRECTORY_NAME = 'tracking-archives'
const ARCHIVE_INDEX_FILE_NAME = 'index.json'
const ARCHIVE_LAST_GOOD_INDEX_FILE_NAME = 'index.last-good.json'
const ARCHIVE_CYCLE_DIRECTORY_NAME = 'cycles'
const ARCHIVE_INDEX_FORMAT = 'jianzhang-stock-tracking-archive-index'
const ARCHIVE_CYCLE_FORMAT = 'jianzhang-stock-tracking-cycle'
const ARCHIVE_FORMAT_VERSION = 1

interface ArchiveIndexDocument {
  format: typeof ARCHIVE_INDEX_FORMAT
  formatVersion: typeof ARCHIVE_FORMAT_VERSION
  updatedAt: string
  stocks: StockTrackingArchiveIndex
}

interface ArchiveCycleDocument {
  format: typeof ARCHIVE_CYCLE_FORMAT
  formatVersion: typeof ARCHIVE_FORMAT_VERSION
  quoteId: string
  cycleId: string
  value: StockTrackingProfile
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseIndex(value: unknown): ArchiveIndexDocument {
  if (!isObject(value) || !isObject(value.stocks)) throw new Error('追踪档案索引结构无效')
  if (
    value.format !== ARCHIVE_INDEX_FORMAT ||
    value.formatVersion !== ARCHIVE_FORMAT_VERSION ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('追踪档案索引格式或版本不受支持')
  }
  return value as unknown as ArchiveIndexDocument
}

function parseCycle(value: unknown, quoteId: string, cycleId: string): StockTrackingProfile {
  if (!isObject(value)) throw new Error('追踪周期档案结构无效')
  if (
    value.format !== ARCHIVE_CYCLE_FORMAT ||
    value.formatVersion !== ARCHIVE_FORMAT_VERSION ||
    value.quoteId !== quoteId ||
    value.cycleId !== cycleId ||
    !isObject(value.value)
  ) {
    throw new Error('追踪周期档案格式或标识无效')
  }
  return value.value as unknown as StockTrackingProfile
}

function cycleSummary(profile: StockTrackingProfile): StockTrackingCycleSummary {
  if (!profile.stoppedAt || !profile.conclusion) throw new Error('只能归档已经停止的追踪周期')
  return {
    cycleId: profile.cycleId,
    quoteId: profile.quoteId,
    code: profile.code,
    name: profile.name,
    marketLabel: profile.marketLabel,
    startedAt: profile.startedAt,
    stoppedAt: profile.stoppedAt,
    updatedAt: profile.updatedAt,
    sourceTypes: [...new Set(profile.sources.map((source) => source.type))],
    tags: [...profile.tags],
    conclusion: profile.conclusion,
    trackingReturn: calculateStockTrackingPerformance(profile, undefined, []).trackingReturn,
    lastEntryContent: profile.entries[0]?.content
  }
}

function stockSummary(
  profile: StockTrackingProfile,
  cycles: StockTrackingCycleSummary[]
): StockTrackingArchiveSummary {
  return {
    quoteId: profile.quoteId,
    code: profile.code,
    name: profile.name,
    marketLabel: profile.marketLabel,
    cycles: [...cycles].sort((left, right) => right.stoppedAt.localeCompare(left.stoppedAt))
  }
}

export class StockTrackingArchiveStore {
  private readonly directory: string
  private readonly cycleDirectory: string
  private readonly indexPath: string
  private readonly lastGoodIndexPath: string
  private index: StockTrackingArchiveIndex = {}

  constructor(private readonly userDataDirectory: string) {
    this.directory = join(userDataDirectory, ARCHIVE_DIRECTORY_NAME)
    this.cycleDirectory = join(this.directory, ARCHIVE_CYCLE_DIRECTORY_NAME)
    this.indexPath = join(this.directory, ARCHIVE_INDEX_FILE_NAME)
    this.lastGoodIndexPath = join(this.directory, ARCHIVE_LAST_GOOD_INDEX_FILE_NAME)
  }

  initialize(): string | undefined {
    if (!existsSync(this.indexPath) && !existsSync(this.lastGoodIndexPath)) {
      this.writeIndex({})
      return undefined
    }
    try {
      this.index = this.readIndex(this.indexPath)
      return undefined
    } catch (reason) {
      if (!existsSync(this.lastGoodIndexPath)) throw reason
      this.index = this.readIndex(this.lastGoodIndexPath)
      this.writeIndex(this.index, false)
      return '追踪档案索引读取失败，已从最近可用索引恢复。'
    }
  }

  getIndex(): StockTrackingArchiveIndex {
    return structuredClone(this.index)
  }

  getCycle(quoteId: string, cycleId: string): StockTrackingProfile {
    const exists = this.index[quoteId]?.cycles.some((cycle) => cycle.cycleId === cycleId)
    if (!exists) throw new Error('追踪周期不存在或已被删除')
    const value = JSON.parse(readFileSync(this.cyclePath(quoteId, cycleId), 'utf8')) as unknown
    return structuredClone(parseCycle(value, quoteId, cycleId))
  }

  archive(profile: StockTrackingProfile, deletePreviousArchives: boolean): void {
    const summary = cycleSummary(profile)
    const document: ArchiveCycleDocument = {
      format: ARCHIVE_CYCLE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      quoteId: profile.quoteId,
      cycleId: profile.cycleId,
      value: profile
    }
    atomicWriteJsonSync(this.cyclePath(profile.quoteId, profile.cycleId), document)
    const currentCycles = deletePreviousArchives ? [] : (this.index[profile.quoteId]?.cycles ?? [])
    const cycles = [summary, ...currentCycles.filter((cycle) => cycle.cycleId !== profile.cycleId)]
    this.writeIndex(
      {
        ...this.index,
        [profile.quoteId]: stockSummary(profile, cycles)
      },
      true,
      deletePreviousArchives
    )
  }

  deleteCycle(quoteId: string, cycleId: string): void {
    const stock = this.index[quoteId]
    if (!stock) return
    const cycles = stock.cycles.filter((cycle) => cycle.cycleId !== cycleId)
    if (cycles.length === stock.cycles.length) return
    const next = { ...this.index }
    if (cycles.length === 0) delete next[quoteId]
    else next[quoteId] = { ...stock, cycles }
    this.writeIndex(next, true, true)
  }

  deleteAll(quoteId: string): void {
    if (!this.index[quoteId]) return
    const next = { ...this.index }
    delete next[quoteId]
    this.writeIndex(next, true, true)
  }

  snapshotStock(quoteId: string): StockTrackingArchiveSummary | undefined {
    const stock = this.index[quoteId]
    return stock ? structuredClone(stock) : undefined
  }

  restoreStock(quoteId: string, snapshot: StockTrackingArchiveSummary | undefined): void {
    const next = { ...this.index }
    if (snapshot) next[quoteId] = snapshot
    else delete next[quoteId]
    this.writeIndex(next, true, true)
  }

  private readIndex(path: string): StockTrackingArchiveIndex {
    return structuredClone(parseIndex(JSON.parse(readFileSync(path, 'utf8')) as unknown).stocks)
  }

  private writeIndex(
    index: StockTrackingArchiveIndex,
    rotateCurrent = true,
    syncRecoveryIndex = false
  ): void {
    if (rotateCurrent && existsSync(this.indexPath)) {
      copyFileSync(this.indexPath, this.lastGoodIndexPath)
    }
    atomicWriteJsonSync(this.indexPath, {
      format: ARCHIVE_INDEX_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      updatedAt: new Date().toISOString(),
      stocks: index
    } satisfies ArchiveIndexDocument)
    if (syncRecoveryIndex) copyFileSync(this.indexPath, this.lastGoodIndexPath)
    this.index = structuredClone(index)
    this.cleanupUnreferencedCycles()
  }

  private cleanupUnreferencedCycles(): void {
    if (!existsSync(this.cycleDirectory)) return
    const referenced = new Set<string>()
    const addReferences = (index: StockTrackingArchiveIndex) => {
      Object.values(index).forEach((stock) =>
        stock.cycles.forEach((cycle) =>
          referenced.add(this.cycleFileName(cycle.quoteId, cycle.cycleId))
        )
      )
    }
    addReferences(this.index)
    if (existsSync(this.lastGoodIndexPath)) {
      try {
        addReferences(this.readIndex(this.lastGoodIndexPath))
      } catch {
        // The current index is already durable; invalid recovery metadata is ignored here.
      }
    }
    for (const entry of readdirSync(this.cycleDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json') && !referenced.has(entry.name)) {
        rmSync(join(this.cycleDirectory, entry.name), { force: true })
      }
    }
  }

  private cyclePath(quoteId: string, cycleId: string): string {
    return join(this.cycleDirectory, this.cycleFileName(quoteId, cycleId))
  }

  private cycleFileName(quoteId: string, cycleId: string): string {
    return `${encodeURIComponent(quoteId)}--${encodeURIComponent(cycleId)}.json`
  }
}
