import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DividendFinancingSnapshot } from '../../src/shared/types'
import {
  createDividendFinancingOverviewStore,
  generateDividendFinancingOverview
} from './data-overview'
import { DividendFinancingService } from './dividend-financing-service'
import { PythonTaskQueue } from './python-task-queue'

vi.mock('electron', () => ({ app: {} }))

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('dividend financing overview', () => {
  it.each([undefined, 2, 3] as const)(
    'reports whether cached source schema %s needs direct dividend data',
    (snapshotSchemaVersion) => {
      const root = mkdtempSync(join(tmpdir(), 'dividend-state-'))
      directories.push(root)
      const directory = join(root, 'dividend-financing')
      mkdirSync(directory)
      const path = join(directory, 'ranking.json')
      const metadata = {
        schemaVersion: 1 as const,
        ...(snapshotSchemaVersion === undefined ? {} : { snapshotSchemaVersion }),
        snapshotDate: '2026-10-22',
        generatedAt: new Date().toISOString(),
        thresholdPercent: 0,
        recordCount: 0
      }
      writeFileSync(path, JSON.stringify({ schemaVersion: snapshotSchemaVersion ?? 2, rows: [] }))
      createDividendFinancingOverviewStore(directory).write(path, metadata, [])

      const service = new DividendFinancingService(
        root,
        new PythonTaskQueue(vi.fn()),
        vi.fn(),
        vi.fn()
      )

      expect(service.getState().status).toBe(snapshotSchemaVersion === 3 ? 'ready' : 'stale')
      if (snapshotSchemaVersion !== 3) expect(service.getState().staleReason).toContain('每股派息')
    }
  )

  it.each([2, 3] as const)(
    'preserves schema v%s and reported per-share dividends for the watchlist',
    (schemaVersion) => {
      const directory = mkdtempSync(join(tmpdir(), 'dividend-overview-'))
      directories.push(directory)
      const path = join(directory, 'ranking.json')
      const snapshot: DividendFinancingSnapshot = {
        schemaVersion,
        snapshotDate: '2026-10-22',
        generatedAt: '2026-10-22T12:00:00+08:00',
        thresholdPercent: 0,
        activeStockCount: 1,
        exactCandidateCount: 1,
        dualListedCount: 0,
        financingErrorCount: 0,
        dividendErrorCount: 0,
        rows: [
          {
            rank: 1,
            code: '600001',
            name: '测试股份',
            market: 'SH',
            dividendYi: 20,
            financingYi: 10,
            ratio: 200,
            annualDividends: [
              {
                year: 2025,
                amountYi: schemaVersion === 3 ? null : 2,
                eventCount: 2,
                ...(schemaVersion === 3 ? { dividendPerShare: 0.5 } : {})
              }
            ]
          }
        ]
      }
      writeFileSync(path, JSON.stringify(snapshot))

      generateDividendFinancingOverview(directory, path)

      const store = createDividendFinancingOverviewStore(directory)
      const manifest = store.load(path)!
      expect(manifest.metadata.snapshotSchemaVersion).toBe(schemaVersion)
      expect(store.read(manifest, ['600001'])).toEqual(snapshot.rows)
    }
  )
})
