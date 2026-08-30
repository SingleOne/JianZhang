import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createFundamentalPeerComparisonMap,
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  screenFundamentalCompanies
} from '../../src/lib/fundamental-screening'
import { parseDividendFinancingSnapshot } from '../../src/lib/dividend-financing'
import { parseFundamentalSnapshot } from '../../src/lib/fundamentals'
import type {
  DividendFinancingOverview,
  DividendFinancingRankingItem,
  FundamentalOverview,
  FundamentalOverviewRecord
} from '../../src/shared/types'
import { IndexedOverviewStore } from './indexed-overview-store'

export type DividendFinancingOverviewMetadata = Omit<DividendFinancingOverview, 'rows'>
export type FundamentalOverviewMetadata = Omit<FundamentalOverview, 'rows'>

export function createDividendFinancingOverviewStore(dataDirectory: string) {
  return new IndexedOverviewStore<DividendFinancingOverviewMetadata, DividendFinancingRankingItem>(
    join(dataDirectory, 'overview.json'),
    join(dataDirectory, 'overview-records.jsonl'),
    (record) => record.code
  )
}

export function createFundamentalOverviewStore(dataDirectory: string) {
  return new IndexedOverviewStore<FundamentalOverviewMetadata, FundamentalOverviewRecord>(
    join(dataDirectory, 'overview.json'),
    join(dataDirectory, 'overview-records.jsonl'),
    (record) => record.company.code
  )
}

export function generateDividendFinancingOverview(
  dataDirectory: string,
  snapshotPath: string
): void {
  const snapshot = parseDividendFinancingSnapshot(readFileSync(snapshotPath, 'utf8'))
  createDividendFinancingOverviewStore(dataDirectory).write(
    snapshotPath,
    {
      schemaVersion: 1,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      recordCount: snapshot.rows.length
    },
    snapshot.rows
  )
}

export function generateFundamentalOverview(dataDirectory: string, snapshotPath: string): void {
  const snapshot = parseFundamentalSnapshot(readFileSync(snapshotPath, 'utf8'))
  const evaluations = screenFundamentalCompanies(snapshot, DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA)
  const peerComparisons = createFundamentalPeerComparisonMap(evaluations)
  const records = evaluations.map((evaluation): FundamentalOverviewRecord => ({
    company: evaluation.company,
    industryBenchmark: evaluation.industryBenchmark,
    peerComparison: peerComparisons.get(evaluation.company.code) ?? null
  }))
  createFundamentalOverviewStore(dataDirectory).write(
    snapshotPath,
    {
      schemaVersion: 1,
      snapshotSchemaVersion: snapshot.schemaVersion,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      fiscalYears: snapshot.fiscalYears,
      latestAnnualReportDate: snapshot.latestAnnualReportDate,
      latestQuarterlyReportDate: snapshot.latestQuarterlyReportDate,
      recordCount: snapshot.rows.length
    },
    records
  )
}
