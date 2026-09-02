import { describe, expect, it } from 'vitest'
import type { DividendFinancingSnapshot, FundamentalSnapshot } from '../shared/types'
import {
  dividendFinancingStaleReason,
  expectedCompletedFiscalYear,
  fundamentalStaleReason
} from './data-snapshot-status'

describe('data snapshot status', () => {
  it('marks dividend data stale after seven days', () => {
    const snapshot = {
      generatedAt: '2026-08-01T00:00:00+08:00'
    } as DividendFinancingSnapshot
    expect(dividendFinancingStaleReason(snapshot, new Date('2026-08-08T00:00:01+08:00'))).toContain(
      '7天'
    )
    expect(dividendFinancingStaleReason(snapshot, new Date('2026-08-07T23:59:59+08:00'))).toBeNull()
  })

  it('uses May 1 as the completed annual report boundary', () => {
    expect(expectedCompletedFiscalYear(new Date(2027, 3, 30))).toBe(2025)
    expect(expectedCompletedFiscalYear(new Date(2027, 4, 1))).toBe(2026)
  })

  it('marks fundamental data stale by fiscal year before age', () => {
    const snapshot = {
      schemaVersion: 7,
      generatedAt: '2027-04-30T12:00:00+08:00',
      fiscalYears: [2021, 2022, 2023, 2024, 2025]
    } as FundamentalSnapshot
    expect(fundamentalStaleReason(snapshot, new Date(2027, 4, 1))).toContain('2026年')
  })

  it('marks legacy fundamental data stale when DCF share data is missing', () => {
    const snapshot = {
      schemaVersion: 4,
      generatedAt: '2026-08-05T12:00:00+08:00',
      fiscalYears: [2021, 2022, 2023, 2024, 2025]
    } as FundamentalSnapshot

    expect(fundamentalStaleReason(snapshot, new Date('2026-08-06T12:00:00+08:00'))).toContain('DCF')
  })

  it('marks schema v5 fundamental data stale when quarterly risk data is missing', () => {
    const snapshot = {
      schemaVersion: 5,
      generatedAt: '2026-08-12T12:00:00+08:00',
      fiscalYears: [2021, 2022, 2023, 2024, 2025]
    } as FundamentalSnapshot

    expect(fundamentalStaleReason(snapshot, new Date('2026-08-12T13:00:00+08:00'))).toContain(
      '季度财务排雷'
    )
  })

  it('marks schema v6 fundamental data stale when PCF industry data is missing', () => {
    const snapshot = {
      schemaVersion: 6,
      generatedAt: '2026-09-02T12:00:00+08:00',
      fiscalYears: [2021, 2022, 2023, 2024, 2025]
    } as FundamentalSnapshot

    expect(fundamentalStaleReason(snapshot, new Date('2026-09-02T13:00:00+08:00'))).toContain(
      'PCF 行业分位'
    )
  })
})
