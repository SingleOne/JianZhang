import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CacheMaintenanceService, type ElectronWebCache } from './cache-maintenance-service'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'jianzhang-cache-'))
  directories.push(directory)
  return directory
}

function write(root: string, relativePath: string, content: string): void {
  const path = join(root, ...relativePath.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function webCache(size = 512): ElectronWebCache & { cleared: boolean } {
  return {
    cleared: false,
    getSize: async () => size,
    clear: async function () {
      this.cleared = true
    }
  }
}

describe('CacheMaintenanceService', () => {
  it('summarizes default, advanced and separate cache categories', async () => {
    const root = temporaryDirectory()
    write(root, 'market-cache/klines/1_600519-daily.json', 'kline')
    write(root, 'logs/market-requests-2026-08-24.jsonl', 'log')
    write(root, 'market-cache/shareholders/1_600519.json', 'shareholder')
    write(root, 'company-reports/600519.json', 'reports')
    write(root, 'company-reports/summaries.json', 'summary')

    const summary = await new CacheMaintenanceService(root, webCache()).getSummary()
    expect(summary.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'temporary-market', group: 'default', fileCount: 1 }),
        expect.objectContaining({ id: 'diagnostic-logs', group: 'default', fileCount: 1 }),
        expect.objectContaining({ id: 'shareholders', group: 'advanced', fileCount: 1 }),
        expect.objectContaining({ id: 'company-reports', group: 'advanced', fileCount: 1 }),
        expect.objectContaining({ id: 'data-snapshots', group: 'separate', fileCount: 0 }),
        expect.objectContaining({ id: 'electron-web', fileCount: null, sizeBytes: 512 })
      ])
    )
  })

  it('clears selected files without deleting report summaries', async () => {
    const root = temporaryDirectory()
    write(root, 'market-cache/klines/1_600519-daily.json', 'kline')
    write(root, 'logs/market-requests-2026-08-24.jsonl', 'log')
    write(root, 'market-cache/shareholders/1_600519.json', 'shareholder')
    write(root, 'company-reports/600519.json', 'reports')
    write(root, 'company-reports/summaries.json', 'summary')

    const service = new CacheMaintenanceService(root, webCache())
    const result = await service.clear(['temporary-market', 'diagnostic-logs', 'company-reports'])

    expect(result.clearedFileCount).toBe(3)
    expect(readFileSync(join(root, 'company-reports/summaries.json'), 'utf8')).toBe('summary')
    expect(readFileSync(join(root, 'market-cache/shareholders/1_600519.json'), 'utf8')).toBe(
      'shareholder'
    )
  })

  it('clears Electron HTTP cache through the session adapter', async () => {
    const root = temporaryDirectory()
    const adapter = webCache(2048)
    const result = await new CacheMaintenanceService(root, adapter).clear(['electron-web'])

    expect(result.webCacheCleared).toBe(true)
    expect(result.clearedBytes).toBe(2048)
    expect(adapter.cleared).toBe(true)
  })
})
