import { currentDateKey, getPositionHoldingDays, type PositionMetrics } from '../../lib/portfolio'
import {
  classifyFundamentalDividendCategory,
  type FundamentalPeerComparison,
  type FundamentalScreeningEvaluation
} from '../../lib/fundamental-screening'
import { hasDividendFinancingLabel } from '../../lib/dividend-financing'
import type {
  DividendFinancingRankingItem,
  StockQuote,
  TradingCalendarSettings,
  WatchlistColumnId,
  WatchStock
} from '../../shared/types'

export interface ColumnMeta {
  label: string
  width: number
  sortable: boolean
  className?: string
}

export interface StockRowData {
  stock: WatchStock
  quote: StockQuote | undefined
  dividendFinancing: DividendFinancingRankingItem | undefined
  fundamentalScreening: FundamentalScreeningEvaluation | undefined
  fundamentalPeerComparison: FundamentalPeerComparison | undefined
  metrics: PositionMetrics
  cumulativeProfit?: number | null
  manualIndex: number
}

export interface SortState {
  column: WatchlistColumnId
  direction: 'asc' | 'desc'
  dividendFinancingMetric?: 'ratio' | 'yield'
}

export interface SectorFilterOption {
  quoteId: string
  name: string
  count: number
}

export interface SinceAddedPerformance {
  change: number
  changePercent: number
}

export interface PreviousCloseDividendYield {
  dividendPerShare: number
  dividendYear: number
  yieldPercent: number
}

export function calculateSinceAddedPerformance(
  stock: WatchStock,
  quote: StockQuote | undefined
): SinceAddedPerformance | null {
  if (!stock.addedPrice || quote?.latest === null || quote?.latest === undefined) return null
  const change = quote.latest - stock.addedPrice
  return { change, changePercent: (change / stock.addedPrice) * 100 }
}

export function calculatePreviousCloseDividendYield(
  dividend: DividendFinancingRankingItem | undefined,
  quote: StockQuote | undefined
): PreviousCloseDividendYield | null {
  const previousYear = Number(currentDateKey().slice(0, 4)) - 1
  const annualDividend = dividend?.annualDividends?.find((point) => point.year === previousYear)
  const dividendPerShare = annualDividend?.dividendPerShare
  const previousClose = quote?.previousClose
  if (
    dividendPerShare === null ||
    dividendPerShare === undefined ||
    !Number.isFinite(dividendPerShare) ||
    dividendPerShare < 0 ||
    previousClose === null ||
    previousClose === undefined ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  ) {
    return null
  }
  return {
    dividendPerShare,
    dividendYear: previousYear,
    yieldPercent: (dividendPerShare / previousClose) * 100
  }
}

export const COLUMN_META: Record<WatchlistColumnId, ColumnMeta> = {
  stock: { label: '名称 / 代码', width: 220, sortable: true, className: 'stock-column' },
  latest: { label: '最新价', width: 72, sortable: true },
  changePercent: { label: '涨跌幅', width: 100, sortable: true },
  sinceAddedChange: { label: '添加以来', width: 118, sortable: true },
  dividendFinancingRatio: { label: '分红融资比', width: 108, sortable: true },
  valueTags: { label: '价值标签', width: 112, sortable: true },
  open: { label: '今日概览', width: 190, sortable: true },
  trading: { label: '成交', width: 112, sortable: true },
  amount: { label: '持仓天数', width: 100, sortable: true },
  radar: { label: '异动提示', width: 100, sortable: true, className: 'radar-column' },
  positionQuantity: { label: '持仓数量', width: 84, sortable: true },
  marketValue: { label: '持仓', width: 108, sortable: true },
  todayProfit: { label: '今日收益', width: 108, sortable: true },
  totalProfit: { label: '持仓收益', width: 108, sortable: true },
  operation: { label: '设置', width: 116, sortable: false, className: 'settings-column' }
}

export const ORDER_COLUMN_WIDTH = 52
export const DELETE_COLUMN_WIDTH = 40
export const TABLE_MIN_WIDTH =
  ORDER_COLUMN_WIDTH +
  DELETE_COLUMN_WIDTH +
  Object.values(COLUMN_META).reduce((total, column) => total + column.width, 0)

export function sortValue(
  row: StockRowData,
  column: WatchlistColumnId,
  tradingCalendar: TradingCalendarSettings | string[],
  dividendFinancingMetric: SortState['dividendFinancingMetric'] = 'ratio'
): string | number | null | undefined {
  switch (column) {
    case 'stock':
      return `${row.stock.name} ${row.stock.code}`
    case 'latest':
      return row.quote?.latest
    case 'changePercent':
      return row.quote?.changePercent
    case 'sinceAddedChange':
      return calculateSinceAddedPerformance(row.stock, row.quote)?.changePercent
    case 'dividendFinancingRatio':
      return dividendFinancingMetric === 'yield'
        ? calculatePreviousCloseDividendYield(row.dividendFinancing, row.quote)?.yieldPercent
        : row.dividendFinancing?.ratio
    case 'valueTags': {
      const category = classifyFundamentalDividendCategory(
        row.fundamentalScreening,
        hasDividendFinancingLabel(row.dividendFinancing)
      )
      return category === 'dual' ? 2 : category === 'fundamental' || category === 'dividend' ? 1 : 0
    }
    case 'open':
      return row.quote?.open
    case 'trading':
      return row.quote?.amount
    case 'amount': {
      const market = row.stock.market ?? 'CN'
      const calendar = Array.isArray(tradingCalendar)
        ? { closedDates: tradingCalendar, halfDayDates: [] }
        : tradingCalendar.markets[market]
      return getPositionHoldingDays(
        row.stock.position,
        calendar.closedDates,
        market,
        calendar.halfDayDates
      )
    }
    case 'radar': {
      if (!row.stock.showRadarSignals) return null
      const today = currentDateKey().replaceAll('-', '')
      const latestSignal = row.quote?.radarSignals?.find((signal) => signal.date === today)
      return latestSignal ? `${latestSignal.date} ${latestSignal.time}` : null
    }
    case 'positionQuantity':
      return row.stock.position?.quantity
    case 'marketValue':
      return row.metrics.marketValue
    case 'todayProfit':
      return row.metrics.todayProfit
    case 'totalProfit':
      return (row.stock.position?.quantity ?? 0) > 0
        ? row.metrics.totalProfit
        : row.cumulativeProfit
    case 'operation':
      return null
  }
}

export function sortRows(
  rows: StockRowData[],
  sort: SortState,
  tradingCalendar: TradingCalendarSettings | string[]
): StockRowData[] {
  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, sort.column, tradingCalendar, sort.dividendFinancingMetric)
    const rightValue = sortValue(right, sort.column, tradingCalendar, sort.dividendFinancingMetric)
    const leftMissing = leftValue === null || leftValue === undefined
    const rightMissing = rightValue === null || rightValue === undefined

    if (leftMissing && rightMissing) return left.manualIndex - right.manualIndex
    if (leftMissing) return 1
    if (rightMissing) return -1

    const compared =
      typeof leftValue === 'string' && typeof rightValue === 'string'
        ? leftValue.localeCompare(rightValue, 'zh-CN', { numeric: true })
        : Number(leftValue) - Number(rightValue)
    if (compared === 0) return left.manualIndex - right.manualIndex
    return sort.direction === 'asc' ? compared : -compared
  })
}
