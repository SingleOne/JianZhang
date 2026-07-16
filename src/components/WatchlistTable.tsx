import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  GripVertical,
  MonitorUp,
  PencilLine,
  Pin,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import {
  formatAmount,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares
} from '../lib/format'
import {
  calculatePositionMetrics,
  isPositionOpenedToday,
  type PositionMetrics
} from '../lib/portfolio'
import type {
  StockPosition,
  StockQuote,
  WatchlistColumnId,
  WatchStock
} from '../shared/types'
import { normalizeWatchlistColumnOrder } from '../shared/types'
import { ExpandedStockDetails } from './ExpandedStockDetails'
import { PositionEditor } from './PositionEditor'

interface WatchlistTableProps {
  watchlist: WatchStock[]
  quotes: StockQuote[]
  columnOrder: WatchlistColumnId[]
  refreshSeconds: number
  selectedQuoteId: string | null
  onSelect: (quoteId: string) => void
  onToggleTaskbar: (quoteId: string) => void
  onEditPosition: (quoteId: string, position: StockPosition | undefined) => void
  onReorder: (sourceQuoteId: string, targetQuoteId: string) => void
  onPin: (quoteId: string) => void
  onColumnOrderChange: (columnOrder: WatchlistColumnId[]) => void
  onRemove: (quoteId: string) => void
}

interface ColumnMeta {
  label: string
  width: number
  sortable: boolean
  className?: string
}

interface StockRowData {
  stock: WatchStock
  quote: StockQuote | undefined
  metrics: PositionMetrics
  manualIndex: number
}

interface SortState {
  column: WatchlistColumnId
  direction: 'asc' | 'desc'
}

type ColumnMove = -1 | 1 | 'start' | 'end'

const COLUMN_META: Record<WatchlistColumnId, ColumnMeta> = {
  stock: { label: '名称 / 代码', width: 190, sortable: true, className: 'stock-column' },
  latest: { label: '最新价', width: 95, sortable: true },
  changePercent: { label: '涨跌幅', width: 100, sortable: true },
  open: { label: '今开', width: 88, sortable: true },
  high: { label: '最高', width: 88, sortable: true },
  low: { label: '最低', width: 88, sortable: true },
  amount: { label: '成交额', width: 110, sortable: true },
  positionQuantity: { label: '持仓数量', width: 105, sortable: true },
  cost: { label: '成本价', width: 95, sortable: true },
  marketValue: { label: '持仓市值', width: 115, sortable: true },
  todayProfit: { label: '今日收益', width: 115, sortable: true },
  totalProfit: { label: '持仓收益', width: 115, sortable: true },
  profitPercent: { label: '收益率', width: 100, sortable: true },
  operation: { label: '操作', width: 225, sortable: false, className: 'operation-column' }
}

const ORDER_COLUMN_WIDTH = 76

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function sortValue(row: StockRowData, column: WatchlistColumnId): string | number | null | undefined {
  switch (column) {
    case 'stock': return `${row.stock.name} ${row.stock.code}`
    case 'latest': return row.quote?.latest
    case 'changePercent': return row.quote?.changePercent
    case 'open': return row.quote?.open
    case 'high': return row.quote?.high
    case 'low': return row.quote?.low
    case 'amount': return row.quote?.amount
    case 'positionQuantity': return row.stock.position?.quantity
    case 'cost': return row.stock.position?.cost
    case 'marketValue': return row.metrics.marketValue
    case 'todayProfit': return row.metrics.todayProfit
    case 'totalProfit': return row.metrics.totalProfit
    case 'profitPercent': return row.metrics.profitPercent
    case 'operation': return null
  }
}

function sortRows(rows: StockRowData[], sort: SortState): StockRowData[] {
  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, sort.column)
    const rightValue = sortValue(right, sort.column)
    const leftMissing = leftValue === null || leftValue === undefined
    const rightMissing = rightValue === null || rightValue === undefined

    if (leftMissing && rightMissing) return left.manualIndex - right.manualIndex
    if (leftMissing) return 1
    if (rightMissing) return -1

    const compared = typeof leftValue === 'string' && typeof rightValue === 'string'
      ? leftValue.localeCompare(rightValue, 'zh-CN', { numeric: true })
      : Number(leftValue) - Number(rightValue)
    return sort.direction === 'asc' ? compared : -compared
  })
}

export function WatchlistTable({
  watchlist,
  quotes,
  columnOrder,
  refreshSeconds,
  selectedQuoteId,
  onSelect,
  onToggleTaskbar,
  onEditPosition,
  onReorder,
  onPin,
  onColumnOrderChange,
  onRemove
}: WatchlistTableProps) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [draggingQuoteId, setDraggingQuoteId] = useState<string | null>(null)
  const [dragOverQuoteId, setDragOverQuoteId] = useState<string | null>(null)
  const [editingStock, setEditingStock] = useState<WatchStock | null>(null)
  const renderedColumnOrder = useMemo(
    () => normalizeWatchlistColumnOrder(columnOrder),
    [columnOrder]
  )
  const adjustableColumnOrder = useMemo(
    () => renderedColumnOrder.slice(0, -1),
    [renderedColumnOrder]
  )
  const [columnMenuOrder, setColumnMenuOrder] = useState<WatchlistColumnId[]>(
    () => adjustableColumnOrder
  )

  const rows = useMemo(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return watchlist.map((stock, manualIndex) => {
      const quote = quoteMap.get(stock.quoteId)
      return { stock, quote, metrics: calculatePositionMetrics(stock.position, quote), manualIndex }
    })
  }, [quotes, watchlist])

  const displayedRows = useMemo(() => sort ? sortRows(rows, sort) : rows, [rows, sort])

  if (watchlist.length === 0) {
    return (
      <div className="empty-watchlist">
        <div className="empty-watchlist-icon"><MonitorUp size={24} /></div>
        <strong>还没有自选股票</strong>
        <span>在上方输入股票代码或名称开始添加</span>
      </div>
    )
  }

  const moveColumn = (columnId: WatchlistColumnId, move: ColumnMove) => {
    const currentIndex = adjustableColumnOrder.indexOf(columnId)
    if (currentIndex === -1) return

    const nextIndex = move === 'start'
      ? 0
      : move === 'end'
        ? adjustableColumnOrder.length - 1
        : currentIndex + move
    if (nextIndex < 0 || nextIndex >= adjustableColumnOrder.length || nextIndex === currentIndex) return

    const nextOrder = [...adjustableColumnOrder]
    const [movedColumn] = nextOrder.splice(currentIndex, 1)
    nextOrder.splice(nextIndex, 0, movedColumn)
    onColumnOrderChange([...nextOrder, 'operation'])
  }

  const changeSort = (column: WatchlistColumnId) => {
    if (!COLUMN_META[column].sortable) return
    setSort((current) => {
      if (current?.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: column === 'stock' ? 'asc' : 'desc' }
    })
  }

  return (
    <div className="watchlist-table-area">
      <div className="table-toolbar">
        <span>
          {sort
            ? `当前按“${COLUMN_META[sort.column].label}”${sort.direction === 'asc' ? '升序' : '降序'}排列`
            : '当前为手动排序 · 使用最左侧的拖动手柄或置顶按钮调整顺序'}
        </span>
        <div className="table-toolbar-actions">
          <button
            className="secondary-button table-tool-button"
            type="button"
            disabled={!sort}
            onClick={() => setSort(null)}
            title="返回最近一次手动调整并保存的顺序"
          >
            <RotateCcw size={15} />
            恢复手动排序
          </button>
          <details
            className="column-order-menu"
            onToggle={(event) => {
              if (event.currentTarget.open) setColumnMenuOrder([...adjustableColumnOrder])
            }}
          >
            <summary className="secondary-button table-tool-button">
              <Columns3 size={15} />
              调整列位置
            </summary>
            <div className="column-order-popover">
              <div className="column-order-heading">
                <strong>列显示顺序</strong>
                <span>顺序将在下次打开时更新</span>
              </div>
              {columnMenuOrder.map((columnId) => {
                const currentIndex = adjustableColumnOrder.indexOf(columnId)
                const isFirst = currentIndex === 0
                const isLast = currentIndex === adjustableColumnOrder.length - 1
                return (
                  <div className="column-order-item" key={columnId}>
                    <span>{COLUMN_META[columnId].label}</span>
                    <span>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isFirst}
                        onClick={() => moveColumn(columnId, 'start')}
                        aria-label={`将${COLUMN_META[columnId].label}列移到最左侧`}
                        title="移到最左侧"
                      >
                        <ChevronsLeft size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isFirst}
                        onClick={() => moveColumn(columnId, -1)}
                        aria-label={`向左移动${COLUMN_META[columnId].label}列`}
                        title="向左移动一列"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isLast}
                        onClick={() => moveColumn(columnId, 1)}
                        aria-label={`向右移动${COLUMN_META[columnId].label}列`}
                        title="向右移动一列"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isLast}
                        onClick={() => moveColumn(columnId, 'end')}
                        aria-label={`将${COLUMN_META[columnId].label}列移到最右侧`}
                        title="移到最右侧"
                      >
                        <ChevronsRight size={14} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      </div>

      <div className="table-scroller">
        <table className="watchlist-table">
          <colgroup>
            <col style={{ width: ORDER_COLUMN_WIDTH }} />
            {renderedColumnOrder.map((columnId) => (
              <col key={columnId} style={{ width: COLUMN_META[columnId].width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="order-column">排序</th>
              {renderedColumnOrder.map((columnId) => {
                const meta = COLUMN_META[columnId]
                const activeSort = sort?.column === columnId ? sort : null
                return (
                  <th
                    className={meta.className}
                    key={columnId}
                    aria-sort={activeSort ? (activeSort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {meta.sortable ? (
                      <button
                        className={`column-sort-button ${activeSort ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => changeSort(columnId)}
                        title={`按${meta.label}排序`}
                      >
                        <span>{meta.label}</span>
                        {activeSort?.direction === 'asc' ? <ArrowUp size={13} />
                          : activeSort?.direction === 'desc' ? <ArrowDown size={13} />
                            : <ArrowUpDown size={13} />}
                      </button>
                    ) : meta.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map(({ stock, quote, metrics, manualIndex }) => {
              const selected = selectedQuoteId === stock.quoteId
              const quoteDirection = valueClass(quote?.changePercent)
              return (
                <Fragment key={stock.quoteId}>
                  <tr
                    className={`stock-row ${selected ? 'is-selected' : ''} ${draggingQuoteId === stock.quoteId ? 'is-dragging' : ''} ${dragOverQuoteId === stock.quoteId ? 'is-drag-over' : ''}`}
                    onClick={() => onSelect(stock.quoteId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelect(stock.quoteId)
                    }}
                    onDragOver={(event) => {
                      if (sort || !draggingQuoteId || draggingQuoteId === stock.quoteId) return
                      event.preventDefault()
                      setDragOverQuoteId(stock.quoteId)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggingQuoteId && draggingQuoteId !== stock.quoteId) {
                        onReorder(draggingQuoteId, stock.quoteId)
                      }
                      setDraggingQuoteId(null)
                      setDragOverQuoteId(null)
                    }}
                    tabIndex={0}
                    aria-expanded={selected}
                  >
                    <td className="order-column">
                      <div className="row-order-actions">
                        <span
                          className={`row-drag-handle ${sort ? 'is-disabled' : ''}`}
                          draggable={!sort}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event) => {
                            event.stopPropagation()
                            event.dataTransfer.effectAllowed = 'move'
                            setDraggingQuoteId(stock.quoteId)
                          }}
                          onDragEnd={() => {
                            setDraggingQuoteId(null)
                            setDragOverQuoteId(null)
                          }}
                          title={sort ? '请先恢复手动排序' : '拖动调整股票顺序'}
                        >
                          <GripVertical size={15} />
                        </span>
                        <button
                          className="icon-button row-pin-button"
                          type="button"
                          disabled={!sort && manualIndex === 0}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSort(null)
                            onPin(stock.quoteId)
                          }}
                          aria-label={`置顶 ${stock.name}`}
                          title={sort ? '置顶并恢复手动排序' : '置顶'}
                        >
                          <Pin size={13} />
                        </button>
                      </div>
                    </td>
                    {renderedColumnOrder.map((columnId) => {
                      switch (columnId) {
                        case 'stock':
                          return (
                            <td className="stock-column" key={columnId}>
                              <div className="stock-identity">
                                <span>
                                  <strong>{stock.name}</strong>
                                  <small>{stock.code} · {stock.marketLabel}</small>
                                </span>
                              </div>
                            </td>
                          )
                        case 'latest':
                          return <td key={columnId}><strong className={`latest-price ${quoteDirection}`}>{formatPrice(quote?.latest)}</strong></td>
                        case 'changePercent':
                          return (
                            <td key={columnId}>
                              <div className={`change-cell ${quoteDirection}`}>
                                <strong>{formatPercent(quote?.changePercent)}</strong>
                                <small>{quote?.change === null || quote?.change === undefined ? '--' : `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}`}</small>
                              </div>
                            </td>
                          )
                        case 'open': return <td key={columnId}>{formatPrice(quote?.open)}</td>
                        case 'high': return <td key={columnId}>{formatPrice(quote?.high)}</td>
                        case 'low': return <td key={columnId}>{formatPrice(quote?.low)}</td>
                        case 'amount': return <td key={columnId}>{formatAmount(quote?.amount)}</td>
                        case 'positionQuantity':
                          return (
                            <td key={columnId}>
                              <span className="position-quantity-cell">
                                <span>{formatShares(stock.position?.quantity)}</span>
                                {isPositionOpenedToday(stock.position) ? <small>本日</small> : null}
                              </span>
                            </td>
                          )
                        case 'cost': return <td key={columnId}>{formatPrice(stock.position?.cost)}</td>
                        case 'marketValue': return <td key={columnId}>{formatCurrency(metrics.marketValue)}</td>
                        case 'todayProfit': return <td className={valueClass(metrics.todayProfit)} key={columnId}>{formatProfit(metrics.todayProfit)}</td>
                        case 'totalProfit': return <td className={valueClass(metrics.totalProfit)} key={columnId}>{formatProfit(metrics.totalProfit)}</td>
                        case 'profitPercent': return <td className={valueClass(metrics.profitPercent)} key={columnId}>{formatPercent(metrics.profitPercent)}</td>
                        case 'operation':
                          return (
                            <td className="operation-column" key={columnId}>
                              <div className="row-actions">
                                <button
                                  className={`row-action-button ${stock.showInTaskbar ? 'is-active' : ''}`}
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); onToggleTaskbar(stock.quoteId) }}
                                  aria-pressed={stock.showInTaskbar}
                                  title={stock.showInTaskbar ? '取消任务栏展示' : '直接在任务栏显示实时价格'}
                                >
                                  <MonitorUp size={15} />
                                  <span>{stock.showInTaskbar ? '已显示' : '任务栏'}</span>
                                </button>
                                <button
                                  className={`row-action-button ${stock.position ? 'has-position' : ''}`}
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); setEditingStock(stock) }}
                                  title="编辑持仓数量和成本"
                                >
                                  <PencilLine size={15} />
                                  <span>持仓</span>
                                </button>
                                <button
                                  className="icon-button remove-button"
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); onRemove(stock.quoteId) }}
                                  aria-label={`移除 ${stock.name}`}
                                  title="移除自选"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          )
                      }
                    })}
                  </tr>
                  {selected ? (
                    <tr className="expanded-row">
                      <td colSpan={renderedColumnOrder.length + 1}>
                        <ExpandedStockDetails stock={stock} quote={quote} refreshSeconds={refreshSeconds} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {editingStock ? (
        <PositionEditor
          key={editingStock.quoteId}
          stock={editingStock}
          onClose={() => setEditingStock(null)}
          onSave={(position) => {
            onEditPosition(editingStock.quoteId, position)
            setEditingStock(null)
          }}
        />
      ) : null}
    </div>
  )
}
