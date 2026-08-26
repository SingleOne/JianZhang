import { session } from 'electron'
import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CacheCategoryGroup,
  CacheCategoryId,
  CacheCategorySummary,
  CacheClearResult,
  CacheSummary
} from '../../src/shared/types'

const MARKET_LOG_FILE_PATTERN = /^market-requests-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/

export interface ElectronWebCache {
  getSize: () => Promise<number>
  clear: () => Promise<void>
}

interface CacheCategoryDefinition {
  id: CacheCategoryId
  label: string
  description: string
  group: CacheCategoryGroup
  roots: readonly string[]
  include?: (relativePath: string) => boolean
  isWebCache?: boolean
}

interface CacheFile {
  absolutePath: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
}

const includeAll = (): boolean => true

export const CACHE_CATEGORY_DEFINITIONS: readonly CacheCategoryDefinition[] = [
  {
    id: 'temporary-market',
    label: '行情临时缓存',
    description: 'K 线、筹码分布和板块绑定，删除后按需重新获取',
    group: 'default',
    roots: [
      'market-cache/klines',
      'market-cache/chip-distributions.json',
      'market-cache/sector-bindings.json'
    ]
  },
  {
    id: 'diagnostic-logs',
    label: '行情诊断日志',
    description: '接口耗时、失败、重试和备用数据源记录',
    group: 'default',
    roots: ['logs'],
    include: (relativePath) => MARKET_LOG_FILE_PATTERN.test(relativePath.split('/').at(-1) ?? '')
  },
  {
    id: 'shareholders',
    label: '股东数据',
    description: '按股票保存的最近一次股东信息缓存',
    group: 'advanced',
    roots: ['market-cache/shareholders']
  },
  {
    id: 'valuations',
    label: '历史估值数据',
    description: '按股票保存的最近一次五年 PE/PB 历史序列',
    group: 'advanced',
    roots: ['market-cache/valuations']
  },
  {
    id: 'market-insight',
    label: '市场观察缓存',
    description: '指标、公告、新闻索引和要闻缓存，不删除观察事件历史',
    group: 'advanced',
    roots: [
      'modules/market-insight/cache',
      'modules/market-insight/news-index.json',
      'modules/market-insight/news-query-dates.json'
    ]
  },
  {
    id: 'company-reports',
    label: '官方财报缓存',
    description: '按股票保存的巨潮、SEC、HKEXnews 报告目录和结构化概览，不删除 AI 财报总结',
    group: 'advanced',
    roots: ['company-reports', 'global-fundamentals'],
    include: (relativePath) => relativePath.split('/').at(-1) !== 'summaries.json'
  },
  {
    id: 'corporate-actions',
    label: '公司行动候选缓存',
    description: 'HKEXnews 与 SEC 候选索引，删除后按需重新发现，不删除已确认账本和忽略状态',
    group: 'advanced',
    roots: ['corporate-actions']
  },
  {
    id: 'data-snapshots',
    label: '数据运行快照',
    description: '基本面、分红融资和收盘扫描结果，清理后需要重新运行更新',
    group: 'separate',
    roots: ['fundamentals', 'dividend-financing', 'daily-market-scan']
  },
  {
    id: 'electron-web',
    label: 'Electron 网页缓存',
    description: '应用内 Chromium 的 HTTP 临时缓存，不清理登录信息或 localStorage',
    group: 'advanced',
    roots: [],
    isWebCache: true
  }
] as const

const CATEGORY_BY_ID = new Map(
  CACHE_CATEGORY_DEFINITIONS.map((definition) => [definition.id, definition])
)

const defaultElectronWebCache: ElectronWebCache = {
  getSize: () => session.defaultSession.getCacheSize(),
  clear: () => session.defaultSession.clearCache()
}

export class CacheMaintenanceService {
  constructor(
    private readonly userDataDirectory: string,
    private readonly electronWebCache: ElectronWebCache = defaultElectronWebCache
  ) {}

  async getSummary(): Promise<CacheSummary> {
    const categories = await Promise.all(
      CACHE_CATEGORY_DEFINITIONS.map(async (definition) => this.summarize(definition))
    )
    return {
      generatedAt: new Date().toISOString(),
      categories
    }
  }

  async clear(categoryIds: readonly CacheCategoryId[]): Promise<CacheClearResult> {
    const uniqueIds = [...new Set(categoryIds)]
    const definitions = uniqueIds.map((id) => {
      const definition = CATEGORY_BY_ID.get(id)
      if (!definition) throw new Error('缓存清理类别无效')
      return definition
    })
    let clearedFileCount = 0
    let clearedBytes = 0
    let webCacheCleared = false
    const failedPaths: string[] = []

    for (const definition of definitions) {
      if (definition.isWebCache) {
        try {
          const size = await this.electronWebCache.getSize()
          await this.electronWebCache.clear()
          clearedBytes += size
          webCacheCleared = true
        } catch {
          failedPaths.push('Electron HTTP cache')
        }
        continue
      }

      for (const file of this.listFiles(definition)) {
        try {
          if (!existsSync(file.absolutePath)) continue
          unlinkSync(file.absolutePath)
          clearedFileCount += 1
          clearedBytes += file.sizeBytes
        } catch {
          failedPaths.push(file.relativePath)
        }
      }
    }

    return {
      categoryIds: uniqueIds,
      clearedFileCount,
      clearedBytes,
      webCacheCleared,
      failedPaths
    }
  }

  private async summarize(definition: CacheCategoryDefinition): Promise<CacheCategorySummary> {
    if (definition.isWebCache) {
      let sizeBytes = 0
      try {
        sizeBytes = await this.electronWebCache.getSize()
      } catch {}
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        group: definition.group,
        fileCount: null,
        sizeBytes,
        latestModifiedAt: null
      }
    }

    const files = this.listFiles(definition)
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      group: definition.group,
      fileCount: files.length,
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      latestModifiedAt: files.length
        ? new Date(
            files.reduce((latest, file) => Math.max(latest, file.modifiedAt), 0)
          ).toISOString()
        : null
    }
  }

  private listFiles(definition: CacheCategoryDefinition): CacheFile[] {
    const files: CacheFile[] = []
    for (const root of definition.roots) {
      const absoluteRoot = join(this.userDataDirectory, ...root.split('/'))
      this.collectFiles(absoluteRoot, root, definition.include ?? includeAll, files)
    }
    return files
  }

  private collectFiles(
    absolutePath: string,
    relativePath: string,
    include: (relativePath: string) => boolean,
    files: CacheFile[]
  ): void {
    if (!existsSync(absolutePath)) return
    let details
    try {
      details = lstatSync(absolutePath)
    } catch {
      return
    }
    if (details.isSymbolicLink()) return
    if (details.isDirectory()) {
      for (const name of readdirSync(absolutePath)) {
        this.collectFiles(join(absolutePath, name), `${relativePath}/${name}`, include, files)
      }
      return
    }
    if (!details.isFile() || !include(relativePath)) return
    files.push({
      absolutePath,
      relativePath: relativePath.replaceAll('\\', '/'),
      sizeBytes: details.size,
      modifiedAt: details.mtimeMs
    })
  }
}
