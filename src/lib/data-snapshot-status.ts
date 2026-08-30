import type { DividendFinancingSnapshot, FundamentalSnapshot } from '../shared/types'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

function olderThanDays(generatedAt: string, days: number, now: Date): boolean {
  const generatedTime = new Date(generatedAt).getTime()
  return Number.isFinite(generatedTime) && now.getTime() - generatedTime > days * DAY_MILLISECONDS
}

export function dividendFinancingStaleReason(
  snapshot: Pick<DividendFinancingSnapshot, 'generatedAt'>,
  now = new Date()
): string | null {
  return olderThanDays(snapshot.generatedAt, 7, now)
    ? '数据生成时间已超过7天，建议手动更新后再进行比较。'
    : null
}

export function expectedCompletedFiscalYear(now = new Date()): number {
  const annualReportsComplete = now.getMonth() > 3
  return now.getFullYear() - (annualReportsComplete ? 1 : 2)
}

export function fundamentalStaleReason(
  snapshot: Pick<FundamentalSnapshot, 'schemaVersion' | 'fiscalYears' | 'generatedAt'>,
  now = new Date()
): string | null {
  if (snapshot.schemaVersion < 5) {
    return '当前快照缺少 DCF 股本换算和季度财务排雷数据，建议手动更新。'
  }
  if (snapshot.schemaVersion < 6) {
    return '当前快照缺少季度财务排雷数据，建议手动更新。'
  }
  const latestYear = snapshot.fiscalYears.at(-1) ?? 0
  const expectedYear = expectedCompletedFiscalYear(now)
  if (latestYear < expectedYear) {
    return `最新完整财年应为${expectedYear}年，当前快照仅到${latestYear}年。`
  }
  return olderThanDays(snapshot.generatedAt, 90, now)
    ? '数据生成时间已超过90天，建议手动更新。'
    : null
}
