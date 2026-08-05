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

  it('parses schema v2 snapshots with investment metrics coverage', () => {
    const value: FundamentalSnapshot = {
      ...snapshot('2026-08-05'),
      schemaVersion: 2,
      coverage: {
        ...snapshot('2026-08-05').coverage,
        completeFiveYearFreeCashFlowCount: 5200,
        completeFiveYearRoicCount: 5100,
        latestNetDebtCount: 5300
      }
    }

    expect(parseFundamentalSnapshot(JSON.stringify(value))).toEqual(value)
  })

  it('parses schema v3 snapshots with valuation percentile coverage', () => {
    const value: FundamentalSnapshot = {
      ...snapshot('2026-08-05'),
      schemaVersion: 3,
      coverage: {
        ...snapshot('2026-08-05').coverage,
        latestValuationCount: 5500,
        latestPriceEarningsIndustryPercentileCount: 4000,
        latestPriceBookIndustryPercentileCount: 5480
      }
    }

    expect(parseFundamentalSnapshot(JSON.stringify(value))).toEqual(value)
  })
})
