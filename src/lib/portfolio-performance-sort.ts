import type { PortfolioPerformanceAggregate } from './portfolio-performance'

export type PortfolioPerformanceSortKey =
  | 'label'
  | 'native'
  | 'totalProfit'
  | 'cumulativeProfit'
  | 'realizedProfit'
  | 'unrealizedProfit'
  | 'dividendIncome'
  | 'expenses'
  | 'corporateActionIncome'
  | 'priceContribution'
  | 'exchangeRateContribution'
  | 'completeness'

export interface PortfolioPerformanceSort {
  key: PortfolioPerformanceSortKey
  direction: 'asc' | 'desc'
}

type SortValue = string | number | null

function sortValues(
  row: PortfolioPerformanceAggregate,
  key: PortfolioPerformanceSortKey
): SortValue[] {
  if (key === 'label') return [row.label]
  if (key === 'native') {
    const slices = row.currentCycle.native
    if (slices.length === 0 || slices.every((slice) => slice.totalProfit === null)) return [null]
    return [
      slices.map((slice) => slice.currency).join(','),
      ...slices.map((slice) => slice.totalProfit)
    ]
  }
  if (key === 'cumulativeProfit') return [row.cumulative.cny.totalProfit]
  if (key === 'completeness') {
    return [row.currentCycle, row.cumulative].map((summary) =>
      summary.stockCount > 0 ? summary.includedStockCount / summary.stockCount : null
    )
  }
  const cny = row.currentCycle.cny
  if (key === 'expenses') {
    return [
      cny.withholdingTax === null || cny.tradeFees === null || cny.corporateActionFees === null
        ? null
        : -(cny.withholdingTax + cny.tradeFees + cny.corporateActionFees)
    ]
  }
  return [cny[key]]
}

export function sortPortfolioPerformanceRows(
  rows: PortfolioPerformanceAggregate[],
  sort: PortfolioPerformanceSort | null
): PortfolioPerformanceAggregate[] {
  if (!sort) return rows
  const direction = sort.direction === 'asc' ? 1 : -1
  const keyedRows = rows.map((row) => ({ row, values: sortValues(row, sort.key) }))
  keyedRows.sort((left, right) => {
    for (let index = 0; index < Math.max(left.values.length, right.values.length); index += 1) {
      const leftValue = left.values[index] ?? null
      const rightValue = right.values[index] ?? null
      if (leftValue === rightValue) continue
      if (leftValue === null) return 1
      if (rightValue === null) return -1
      const compared =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), 'zh-CN', { numeric: true })
      if (compared !== 0) return compared * direction
    }
    return 0
  })
  return keyedRows.map(({ row }) => row)
}
