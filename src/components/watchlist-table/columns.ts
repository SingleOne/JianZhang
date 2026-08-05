import { currentDateKey, getPositionHoldingDays, type PositionMetrics } from '../../lib/portfolio'
import {
  classifyFundamentalDividendCategory,
  type FundamentalPeerComparison,
  type FundamentalScreeningEvaluation
} from '../../lib/fundamental-screening'
import type {
  DividendFinancingRankingItem,
  StockQuote,
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
  manualIndex: number
}

export interface SortState {
  column: WatchlistColumnId
  direction: 'asc' | 'desc'
}

export interface SectorFilterOption {
  quoteId: string
  name: string
  count: number
}

export const COLUMN_META: Record<WatchlistColumnId, ColumnMeta> = {
  stock: { label: '名称 / 代码', width: 220, sortable: true, className: 'stock-column' },
  latest: { label: '最新价', width: 72, sortable: true },
  changePercent: { label: '涨跌幅', width: 76, sortable: true },
  sectorChangePercent: { label: '板块涨跌幅', width: 94, sortable: true },
  dividendFinancingRatio: { label: '分红融资比', width: 108, sortable: true },
  valueTags: { label: '价值标签', width: 112, sortable: true },
  open: { label: '今日概览', width: 190, sortable: true },
  trading: { label: '成交', width: 112, sortable: true },
  amount: { label: '持仓天数', width: 80, sortable: true },
  radar: { label: '异动提示', width: 100, sortable: true, className: 'radar-column' },
  positionQuantity: { label: '持仓数量', width: 84, sortable: true },
  cost: { label: '成本价', width: 68, sortable: true },
  marketValue: { label: '持仓市值', width: 88, sortable: true },
  todayProfit: { label: '今日收益', width: 108, sortable: true },
  totalProfit: { label: '持仓收益', width: 108, sortable: true },
  operation: { label: '设置', width: 90, sortable: false, className: 'settings-column' }
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
  tradingCalendarClosedDates: string[]
): string | number | null | undefined {
  switch (column) {
    case 'stock':
      return `${row.stock.name} ${row.stock.code}`
    case 'latest':
      return row.quote?.latest
    case 'changePercent':
      return row.quote?.changePercent
    case 'sectorChangePercent':
      return row.quote?.sector?.changePercent
    case 'dividendFinancingRatio':
      return row.dividendFinancing?.ratio
    case 'valueTags': {
      const category = classifyFundamentalDividendCategory(
        row.fundamentalScreening,
        Boolean(row.dividendFinancing)
      )
      return category === 'dual'
        ? 2
        : category === 'fundamental' || category === 'dividend'
          ? 1
          : 0
    }
    case 'open':
      return row.quote?.open
    case 'trading':
      return row.quote?.amount
    case 'amount':
      return getPositionHoldingDays(row.stock.position, tradingCalendarClosedDates)
    case 'radar': {
      if (!row.stock.showRadarSignals) return null
      const today = currentDateKey().replaceAll('-', '')
      const latestSignal = row.quote?.radarSignals?.find((signal) => signal.date === today)
      return latestSignal ? `${latestSignal.date} ${latestSignal.time}` : null
    }
    case 'positionQuantity':
      return row.stock.position?.quantity
    case 'cost':
      return row.stock.position?.cost
    case 'marketValue':
      return row.metrics.marketValue
    case 'todayProfit':
      return row.metrics.todayProfit
    case 'totalProfit':
      return row.metrics.totalProfit
    case 'operation':
      return null
  }
}

export function sortRows(
  rows: StockRowData[],
  sort: SortState,
  tradingCalendarClosedDates: string[]
): StockRowData[] {
  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, sort.column, tradingCalendarClosedDates)
    const rightValue = sortValue(right, sort.column, tradingCalendarClosedDates)
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
