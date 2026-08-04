import { describe, expect, it } from 'vitest'
import type { DividendFinancingRankingItem, DividendFinancingSnapshot } from '../shared/types'
import {
  createDividendFinancingChangeReport,
  parseDividendFinancingSnapshot
} from './dividend-financing'

function item(overrides: Partial<DividendFinancingRankingItem>): DividendFinancingRankingItem {
  return {
    rank: 1,
    code: '600001',
    name: '测试股份',
    market: 'SH',
    dividendYi: 10,
    financingYi: 5,
    ratio: 200,
    qualityScore: 70,
    ...overrides
  }
}

function snapshot(snapshotDate: string, rows: DividendFinancingRankingItem[]): DividendFinancingSnapshot {
  return {
    schemaVersion: 2,
    scoreMethodologyVersion: 1,
    snapshotDate,
    generatedAt: `${snapshotDate}T12:00:00+08:00`,
    thresholdPercent: 100,
    activeStockCount: rows.length,
    exactCandidateCount: rows.length,
    dualListedCount: 0,
    financingErrorCount: 0,
    dividendErrorCount: 0,
    rows
  }
}

describe('createDividendFinancingChangeReport', () => {
  it('detects entries, exits, rank moves and cumulative amount increases', () => {
    const previous = snapshot('2026-01-01', [
      item({ code: '600001', rank: 1 }),
      item({ code: '600002', rank: 2, ratio: 180 }),
      item({ code: '600003', rank: 3, ratio: 160 })
    ])
    const current = snapshot('2026-08-03', [
      item({ code: '600002', rank: 1, ratio: 210, dividendYi: 12, qualityScore: 76 }),
      item({ code: '600001', rank: 2, financingYi: 6, ratio: 166.67, qualityScore: 65 }),
      item({ code: '600004', rank: 3, ratio: 150 })
    ])

    const report = createDividendFinancingChangeReport(previous, current, '2026-08-03T13:00:00+08:00')

    expect(report.summary).toEqual({
      addedCount: 1,
      removedCount: 1,
      rankChangedCount: 2,
      ratioChangedCount: 2,
      dividendIncreasedCount: 1,
      financingIncreasedCount: 1
    })
    expect(report.rows.find((row) => row.code === '600002')).toMatchObject({
      rankChange: 1,
      ratioChange: 30,
      dividendIncreaseYi: 2,
      qualityScoreChange: 6
    })
    expect(report.rows.find((row) => row.code === '600001')?.changeTypes).toContain('financing')
    expect(report.rows.find((row) => row.code === '600004')?.changeTypes).toEqual(['added'])
    expect(report.rows.find((row) => row.code === '600003')?.changeTypes).toEqual(['removed'])
  })
})

describe('snapshot compatibility', () => {
  it('accepts schema v2 snapshots and rejects legacy snapshots', () => {
    const current = snapshot('2026-08-03', [])
    const legacy = { ...snapshot('2026-07-22', []), schemaVersion: 1 as const }

    expect(parseDividendFinancingSnapshot(JSON.stringify(current))).toEqual(current)
    expect(() => parseDividendFinancingSnapshot(JSON.stringify(legacy))).toThrow('schema v2')
  })
})
