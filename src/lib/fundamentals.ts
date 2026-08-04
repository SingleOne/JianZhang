import type { FundamentalSnapshot } from '../shared/types'

export function parseFundamentalSnapshot(content: string): FundamentalSnapshot {
  const snapshot = JSON.parse(content) as FundamentalSnapshot
  if (
    snapshot.schemaVersion !== 1 ||
    !snapshot.snapshotDate ||
    !Array.isArray(snapshot.fiscalYears) ||
    !Array.isArray(snapshot.industries) ||
    !Array.isArray(snapshot.rows)
  ) {
    throw new Error('基本面财务数据快照格式不受支持')
  }
  return snapshot
}

export function selectFundamentalSnapshot(
  bundled: FundamentalSnapshot,
  cached: FundamentalSnapshot | null
): FundamentalSnapshot {
  if (!cached) return bundled
  if (cached.latestAnnualReportDate !== bundled.latestAnnualReportDate) {
    return cached.latestAnnualReportDate > bundled.latestAnnualReportDate ? cached : bundled
  }
  return cached.snapshotDate >= bundled.snapshotDate ? cached : bundled
}
