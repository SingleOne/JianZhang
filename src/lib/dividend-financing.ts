import type {
  DividendFinancingChangeItem,
  DividendFinancingChangeReport,
  DividendFinancingChangeType,
  DividendFinancingSnapshot
} from '../shared/types'

export function parseDividendFinancingSnapshot(content: string): DividendFinancingSnapshot {
  const snapshot = JSON.parse(content) as DividendFinancingSnapshot
  if (![1, 2].includes(snapshot.schemaVersion) || !snapshot.snapshotDate || !Array.isArray(snapshot.rows)) {
    throw new Error('分红融资榜数据格式不正确')
  }
  return snapshot
}

export function selectDividendFinancingSnapshot(
  bundled: DividendFinancingSnapshot,
  cached: DividendFinancingSnapshot | null
): DividendFinancingSnapshot {
  if (!cached) return bundled
  if (bundled.schemaVersion === 2 && cached.schemaVersion === 1) return bundled
  return cached
}

function roundedDelta(current: number, previous: number, digits: number): number {
  return Number((current - previous).toFixed(digits))
}

export function createDividendFinancingChangeReport(
  previous: DividendFinancingSnapshot,
  current: DividendFinancingSnapshot,
  generatedAt = new Date().toISOString()
): DividendFinancingChangeReport {
  const previousByCode = new Map(previous.rows.map((item) => [item.code, item]))
  const currentByCode = new Map(current.rows.map((item) => [item.code, item]))
  const allCodes = new Set([...previousByCode.keys(), ...currentByCode.keys()])
  const rows: DividendFinancingChangeItem[] = []

  for (const code of allCodes) {
    const before = previousByCode.get(code)
    const after = currentByCode.get(code)
    if (!before && after) {
      rows.push({
        code,
        name: after.name,
        market: after.market,
        changeTypes: ['added'],
        previousRank: null,
        currentRank: after.rank,
        rankChange: null,
        previousRatio: null,
        currentRatio: after.ratio,
        ratioChange: null,
        dividendIncreaseYi: 0,
        financingIncreaseYi: 0,
        previousQualityScore: null,
        currentQualityScore: after.qualityScore ?? null,
        qualityScoreChange: null
      })
      continue
    }
    if (before && !after) {
      rows.push({
        code,
        name: before.name,
        market: before.market,
        changeTypes: ['removed'],
        previousRank: before.rank,
        currentRank: null,
        rankChange: null,
        previousRatio: before.ratio,
        currentRatio: null,
        ratioChange: null,
        dividendIncreaseYi: 0,
        financingIncreaseYi: 0,
        previousQualityScore: before.qualityScore ?? null,
        currentQualityScore: null,
        qualityScoreChange: null
      })
      continue
    }
    if (!before || !after) continue

    const changeTypes: DividendFinancingChangeType[] = []
    const rankChange = before.rank - after.rank
    const ratioChange = roundedDelta(after.ratio, before.ratio, 2)
    const dividendIncreaseYi = Math.max(0, roundedDelta(after.dividendYi, before.dividendYi, 4))
    const financingIncreaseYi = Math.max(0, roundedDelta(after.financingYi, before.financingYi, 4))
    if (rankChange !== 0) changeTypes.push('rank')
    if (ratioChange !== 0) changeTypes.push('ratio')
    if (dividendIncreaseYi > 0) changeTypes.push('dividend')
    if (financingIncreaseYi > 0) changeTypes.push('financing')
    if (changeTypes.length === 0) continue

    const previousQualityScore = before.qualityScore ?? null
    const currentQualityScore = after.qualityScore ?? null
    rows.push({
      code,
      name: after.name,
      market: after.market,
      changeTypes,
      previousRank: before.rank,
      currentRank: after.rank,
      rankChange,
      previousRatio: before.ratio,
      currentRatio: after.ratio,
      ratioChange,
      dividendIncreaseYi,
      financingIncreaseYi,
      previousQualityScore,
      currentQualityScore,
      qualityScoreChange:
        previousQualityScore === null || currentQualityScore === null
          ? null
          : roundedDelta(currentQualityScore, previousQualityScore, 1)
    })
  }

  const priority = (item: DividendFinancingChangeItem) => {
    if (item.changeTypes.includes('financing')) return 0
    if (item.changeTypes.includes('added')) return 1
    if (item.changeTypes.includes('removed')) return 2
    if (item.changeTypes.includes('dividend')) return 3
    return 4
  }
  rows.sort((left, right) =>
    priority(left) - priority(right)
    || Math.abs(right.rankChange ?? 0) - Math.abs(left.rankChange ?? 0)
    || (left.currentRank ?? left.previousRank ?? 0) - (right.currentRank ?? right.previousRank ?? 0)
  )

  return {
    schemaVersion: 1,
    previousSnapshotDate: previous.snapshotDate,
    currentSnapshotDate: current.snapshotDate,
    generatedAt,
    summary: {
      addedCount: rows.filter((item) => item.changeTypes.includes('added')).length,
      removedCount: rows.filter((item) => item.changeTypes.includes('removed')).length,
      rankChangedCount: rows.filter((item) => item.changeTypes.includes('rank')).length,
      ratioChangedCount: rows.filter((item) => item.changeTypes.includes('ratio')).length,
      dividendIncreasedCount: rows.filter((item) => item.changeTypes.includes('dividend')).length,
      financingIncreasedCount: rows.filter((item) => item.changeTypes.includes('financing')).length
    },
    rows
  }
}
