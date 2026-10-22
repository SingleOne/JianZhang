import { describe, expect, it } from 'vitest'
import type {
  NativePerformanceSlice,
  PortfolioPerformanceAggregate,
  PortfolioPerformanceAggregateSummary
} from './portfolio-performance'
import { sortPortfolioPerformanceRows } from './portfolio-performance-sort'

function summary(value: number | null): PortfolioPerformanceAggregateSummary {
  return {
    stockCount: 1,
    includedStockCount: value === null ? 0 : 1,
    excludedStockCount: value === null ? 1 : 0,
    native: [],
    cny: {
      totalProfit: value,
      realizedProfit: 0,
      unrealizedProfit: 0,
      dividendIncome: 0,
      withholdingTax: 0,
      tradeFees: 0,
      corporateActionFees: 0,
      corporateActionIncome: 0,
      priceContribution: 0,
      exchangeRateContribution: 0,
      manualAdjustment: 0
    },
    issueCounts: {}
  }
}

function row(id: string, value: number | null): PortfolioPerformanceAggregate {
  return {
    id,
    label: id,
    scope: 'stock',
    currentCycle: summary(value),
    cumulative: summary(value)
  }
}

function native(currency: NativePerformanceSlice['currency'], value: number | null) {
  return {
    currency,
    totalProfit: value,
    realizedProfit: value ?? 0,
    unrealizedProfit: 0,
    dividendIncome: 0,
    withholdingTax: 0,
    tradeFees: 0,
    corporateActionFees: 0,
    corporateActionIncome: 0,
    manualAdjustment: 0,
    complete: value !== null
  }
}

const ids = (rows: PortfolioPerformanceAggregate[]) => rows.map((item) => item.id)

describe('portfolio performance table sorting', () => {
  it('preserves the report order until a column is selected', () => {
    const rows = [row('second', 20), row('first', 100)]
    expect(sortPortfolioPerformanceRows(rows, null)).toBe(rows)
  })

  it.each(['asc', 'desc'] as const)(
    'sorts signed numbers in %s order with missing values last and stable ties',
    (direction) => {
      const rows = [
        row('missing', null),
        row('twenty', 20),
        row('hundred', 100),
        row('negative', -5),
        row('zero', 0),
        row('anotherTwenty', 20)
      ]
      const originalIds = ids(rows)
      const sorted = sortPortfolioPerformanceRows(rows, { key: 'totalProfit', direction })
      expect(ids(sorted)).toEqual(
        direction === 'asc'
          ? ['negative', 'zero', 'twenty', 'anotherTwenty', 'hundred', 'missing']
          : ['hundred', 'twenty', 'anotherTwenty', 'zero', 'negative', 'missing']
      )
      expect(ids(rows)).toEqual(originalIds)
    }
  )

  it('sorts cumulative profit independently of current-cycle profit', () => {
    const rows = [row('currentWinner', 100), row('cumulativeWinner', 20)]
    rows[0].cumulative.cny.totalProfit = -200
    rows[1].cumulative.cny.totalProfit = 300
    expect(
      ids(sortPortfolioPerformanceRows(rows, { key: 'cumulativeProfit', direction: 'desc' }))
    ).toEqual(['cumulativeWinner', 'currentWinner'])
  })

  it('sorts expenses by their displayed negative amounts and keeps unknown fees last', () => {
    const rows = [row('largeExpense', 0), row('unknownExpense', 0), row('smallExpense', 0)]
    Object.assign(rows[0].currentCycle.cny, {
      withholdingTax: 2,
      tradeFees: 8,
      corporateActionFees: 5
    })
    rows[1].currentCycle.cny.tradeFees = null
    rows[2].currentCycle.cny.tradeFees = 3
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'expenses', direction: 'desc' }))).toEqual(
      ['smallExpense', 'largeExpense', 'unknownExpense']
    )
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'expenses', direction: 'asc' }))).toEqual([
      'largeExpense',
      'smallExpense',
      'unknownExpense'
    ])
  })

  it('uses natural ordering for object names containing numbers', () => {
    const rows = [row('组合10', 0), row('组合2', 0)]
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'label', direction: 'asc' }))).toEqual([
      '组合2',
      '组合10'
    ])
  })

  it('groups native returns by currency before comparing amounts and leaves unknown returns last', () => {
    const rows = [row('usd', 0), row('hkdHigh', 0), row('unknown', 0), row('hkdLow', 0)]
    rows[0].currentCycle.native = [native('USD', -100)]
    rows[1].currentCycle.native = [native('HKD', 100)]
    rows[2].currentCycle.native = [native('CNY', null)]
    rows[3].currentCycle.native = [native('HKD', 20)]
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'native', direction: 'asc' }))).toEqual([
      'hkdLow',
      'hkdHigh',
      'usd',
      'unknown'
    ])
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'native', direction: 'desc' }))).toEqual([
      'usd',
      'hkdHigh',
      'hkdLow',
      'unknown'
    ])
  })

  it('compares multi-currency returns within matching currency combinations without adding currencies', () => {
    const rows = [row('largerSecondCurrency', 0), row('largerFirstCurrency', 0)]
    rows[0].currentCycle.native = [native('HKD', 10), native('USD', 1000)]
    rows[1].currentCycle.native = [native('HKD', 20), native('USD', 1)]
    const originalSlices = [...rows[0].currentCycle.native]
    expect(ids(sortPortfolioPerformanceRows(rows, { key: 'native', direction: 'desc' }))).toEqual([
      'largerFirstCurrency',
      'largerSecondCurrency'
    ])
    expect(rows[0].currentCycle.native).toEqual(originalSlices)
  })

  it('sorts completeness by current and cumulative inclusion ratios rather than stock counts', () => {
    const rows = [row('manyPartial', 0), row('fullyComplete', 0), row('currentComplete', 0)]
    Object.assign(rows[0].currentCycle, {
      stockCount: 10,
      includedStockCount: 9,
      excludedStockCount: 1
    })
    Object.assign(rows[2].cumulative, {
      stockCount: 2,
      includedStockCount: 1,
      excludedStockCount: 1
    })
    expect(
      ids(sortPortfolioPerformanceRows(rows, { key: 'completeness', direction: 'desc' }))
    ).toEqual(['fullyComplete', 'currentComplete', 'manyPartial'])
  })
})
