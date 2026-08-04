import { describe, expect, it } from 'vitest'
import type { FundamentalSnapshot } from '../shared/types'
import { parseFundamentalSnapshot } from './fundamentals'

function snapshot(
  snapshotDate: string,
  latestAnnualReportDate = '2025-12-31'
): FundamentalSnapshot {
  return {
    schemaVersion: 1,
    snapshotDate,
    generatedAt: `${snapshotDate}T12:00:00+08:00`,
    currency: 'CNY',
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    latestAnnualReportDate,
    sources: [],
    coverage: {
      companyCount: 0,
      completeFiveYearRoeCount: 0,
      completeFiveYearCashProfitCount: 0,
      latestDebtAssetRatioCount: 0,
      latestIndustryPercentileCount: 0,
      industryCount: 0
    },
    industries: [],
    rows: []
  }
}

describe('fundamental snapshots', () => {
  it('parses schema v1 snapshots', () => {
    const value = snapshot('2026-08-04')
    expect(parseFundamentalSnapshot(JSON.stringify(value))).toEqual(value)
  })
})
