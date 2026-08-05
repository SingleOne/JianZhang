import { describe, expect, it } from 'vitest'
import snapshot from './fundamental-snapshot.json'

describe('fundamental data snapshot', () => {
  it('contains five aligned annual reports and industry debt benchmarks', () => {
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snapshot.fiscalYears).toHaveLength(5)
    expect(snapshot.fiscalYears).toEqual(
      [...snapshot.fiscalYears].sort((left, right) => left - right)
    )
    expect(snapshot.rows.length).toBeGreaterThan(5000)
    expect(snapshot.coverage.companyCount).toBe(snapshot.rows.length)
    expect(snapshot.coverage.completeFiveYearRoeCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.completeFiveYearCashProfitCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.completeFiveYearFreeCashFlowCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.completeFiveYearRoicCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.latestDebtAssetRatioCount).toBe(snapshot.rows.length)
    expect(snapshot.coverage.latestIndustryPercentileCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.latestNetDebtCount).toBeGreaterThan(5000)
    expect(snapshot.coverage.industryCount).toBe(snapshot.industries.length)
    expect(new Set(snapshot.rows.map((item) => item.code)).size).toBe(snapshot.rows.length)
    expect(new Set(snapshot.industries.map((item) => item.code)).size).toBe(
      snapshot.industries.length
    )

    snapshot.rows.forEach((item) => {
      expect(['SH', 'SZ', 'BJ']).toContain(item.market)
      expect(item.annualReports.map((report) => report.year)).toEqual(snapshot.fiscalYears)
      expect(item.latestBalanceSheet.reportDate).toBe(snapshot.latestAnnualReportDate)
      expect(item.latestBalanceSheet.debtAssetRatio).not.toBeNull()
      expect(item.annualReports).toHaveLength(5)
      item.annualReports.forEach((report) => {
        expect(report).toHaveProperty('roic')
        expect(report).toHaveProperty('capitalExpenditure')
        expect(report).toHaveProperty('freeCashFlow')
      })
      expect(item.latestBalanceSheet).toHaveProperty('monetaryFunds')
      expect(item.latestBalanceSheet).toHaveProperty('interestBearingDebt')
      expect(item.latestBalanceSheet).toHaveProperty('netDebt')
      if (item.latestBalanceSheet.industryPercentile !== null) {
        expect(item.latestBalanceSheet.industryPercentile).toBeGreaterThan(0)
        expect(item.latestBalanceSheet.industryPercentile).toBeLessThanOrEqual(100)
      }
    })
  })
})
