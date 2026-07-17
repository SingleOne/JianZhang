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
  Search,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
  currentDateKey,
  getPositionHoldingDays,
  isPositionOpenedToday,
  type PositionMetrics
} from '../lib/portfolio'
import type {
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  StockRadarSignal,
  TTradingAccount,
  TTradingAccounts,
  TTradingFeeSettings,
  WatchlistColumnId,
  WatchStock
} from '../shared/types'
import { normalizeWatchlistColumnOrder } from '../shared/types'
import { ExpandedStockDetails } from './ExpandedStockDetails'
import { PositionEditor } from './PositionEditor'
import { TTradingDrawer } from './TTradingDrawer'

interface WatchlistTableProps {
  watchlist: WatchStock[]
  quotes: StockQuote[]
  columnOrder: WatchlistColumnId[]
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  selectedQuoteId: string | null
  tTradingAccounts: TTradingAccounts
  tTradingFees: TTradingFeeSettings
  tradingCalendarClosedDates: string[]
  onSelect: (quoteId: string) => void
  onToggleTaskbar: (quoteId: string) => void
  onTogglePriority: (quoteId: string) => void
  onEditPosition: (
    quoteId: string,
    position: StockPosition | undefined,
    showRadarSignals: boolean,
    positionSnapshots: StockPositionSnapshot[]
  ) => void
  onUpdateTTrading: (
    quoteId: string,
    account: TTradingAccount,
    position: StockPosition | undefined
  ) => void
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

interface RadarPopoverState {
  quoteId: string
  left: number
  top: number
  placement: 'above' | 'below'
}

type ColumnMove = -1 | 1 | 'start' | 'end'

const COLUMN_META: Record<WatchlistColumnId, ColumnMeta> = {
  stock: { label: '名称 / 代码', width: 77, sortable: true, className: 'stock-column' },
  latest: { label: '最新价', width: 72, sortable: true },
  changePercent: { label: '涨跌幅', width: 76, sortable: true },
  open: { label: '今开', width: 64, sortable: true },
  high: { label: '最高', width: 64, sortable: true },
  low: { label: '最低', width: 64, sortable: true },
  amount: { label: '成交额', width: 80, sortable: true },
  radar: { label: '异动提示', width: 100, sortable: true, className: 'radar-column' },
  positionQuantity: { label: '持仓数量', width: 84, sortable: true },
  cost: { label: '成本价', width: 68, sortable: true },
  marketValue: { label: '持仓市值', width: 88, sortable: true },
  todayProfit: { label: '今日收益', width: 86, sortable: true },
  todayProfitPercent: { label: '今日收益率', width: 88, sortable: true },
  totalProfit: { label: '持仓收益', width: 86, sortable: true },
  profitPercent: { label: '收益率', width: 76, sortable: true },
  operation: { label: '设置', width: 64, sortable: false, className: 'settings-column' }
}

const ORDER_COLUMN_WIDTH = 52
const DELETE_COLUMN_WIDTH = 40
const TABLE_MIN_WIDTH = ORDER_COLUMN_WIDTH + DELETE_COLUMN_WIDTH + Object.values(COLUMN_META)
  .reduce((total, column) => total + column.width, 0)

function currentCompactDate(): string {
  return currentDateKey().replaceAll('-', '')
}

function todayRadarSignals(signals: StockRadarSignal[] | undefined): StockRadarSignal[] {
  const today = currentCompactDate()
  return signals?.filter((signal) => signal.date === today) ?? []
}

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
    case 'radar': {
      if (!row.stock.showRadarSignals) return null
      const latestSignal = todayRadarSignals(row.quote?.radarSignals)[0]
      return latestSignal ? `${latestSignal.date} ${latestSignal.time}` : null
    }
    case 'positionQuantity': return row.stock.position?.quantity
    case 'cost': return row.stock.position?.cost
    case 'marketValue': return row.metrics.marketValue
    case 'todayProfit': return row.metrics.todayProfit
    case 'todayProfitPercent': return row.metrics.todayProfitPercent
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

interface TableStockSearchProps {
  stocks: WatchStock[]
  onChoose: (quoteId: string) => void
}

function TableStockSearch({ stocks, onChoose }: TableStockSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return stocks
    return stocks.filter((stock) => (
      stock.name.toLocaleLowerCase('zh-CN').includes(normalized) || stock.code.includes(normalized)
    ))
  }, [query, stocks])

  const choose = (quoteId: string) => {
    setQuery('')
    setOpen(false)
    onChoose(quoteId)
  }

  return (
    <div
      className="table-stock-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className={`table-stock-search-field ${open ? 'is-open' : ''}`}>
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) choose(results[0].quoteId)
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="搜索当前股票"
          aria-label="搜索当前表格股票"
          aria-expanded={open}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setOpen(true)
            }}
            aria-label="清空表格搜索"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="table-stock-search-results" role="listbox">
          {results.length > 0 ? results.map((stock) => (
            <button
              className="table-stock-search-result"
              type="button"
              role="option"
              key={stock.quoteId}
              onClick={() => choose(stock.quoteId)}
            >
              <strong>{stock.name}</strong>
              <span>{stock.code}</span>
              <small>{stock.marketLabel}</small>
            </button>
          )) : <div className="table-stock-search-empty">当前表格中没有匹配股票</div>}
        </div>
      ) : null}
    </div>
  )
}

export function WatchlistTable({
  watchlist,
  quotes,
  columnOrder,
  priorityRefreshSeconds,
  regularRefreshSeconds,
  selectedQuoteId,
  tTradingAccounts,
  tTradingFees,
  tradingCalendarClosedDates,
  onSelect,
  onToggleTaskbar,
  onTogglePriority,
  onEditPosition,
  onUpdateTTrading,
  onReorder,
  onPin,
  onColumnOrderChange,
  onRemove
}: WatchlistTableProps) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [draggingQuoteId, setDraggingQuoteId] = useState<string | null>(null)
  const [dragOverQuoteId, setDragOverQuoteId] = useState<string | null>(null)
  const [editingStock, setEditingStock] = useState<WatchStock | null>(null)
  const [tTradingStock, setTTradingStock] = useState<WatchStock | null>(null)
  const [closingQuoteIds, setClosingQuoteIds] = useState<Set<string>>(() => new Set())
  const [radarPopover, setRadarPopover] = useState<RadarPopoverState | null>(null)
  const [locatedQuoteId, setLocatedQuoteId] = useState<string | null>(null)
  const tableScrollerRef = useRef<HTMLDivElement>(null)
  const radarAnchorRef = useRef<HTMLButtonElement | null>(null)
  const radarPopoverRef = useRef<HTMLDivElement>(null)
  const locateTimerRef = useRef<number | undefined>(undefined)
  const locateFrameRef = useRef<number | undefined>(undefined)
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
  const displayedStocks = useMemo(() => displayedRows.map(({ stock }) => stock), [displayedRows])
  const activeRadarRow = radarPopover
    ? rows.find(({ stock }) => stock.quoteId === radarPopover.quoteId)
    : undefined

  useEffect(() => () => {
    window.clearTimeout(locateTimerRef.current)
    window.cancelAnimationFrame(locateFrameRef.current ?? 0)
  }, [])

  useEffect(() => {
    if (!radarPopover) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (radarPopoverRef.current?.contains(target) || radarAnchorRef.current?.contains(target)) return
      setRadarPopover(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRadarPopover(null)
    }
    const closePopover = () => setRadarPopover(null)
    const scroller = tableScrollerRef.current
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closePopover)
    scroller?.addEventListener('scroll', closePopover)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closePopover)
      scroller?.removeEventListener('scroll', closePopover)
    }
  }, [radarPopover])

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

  const toggleStockDetails = (quoteId: string) => {
    setClosingQuoteIds((current) => {
      const next = new Set(current)
      if (selectedQuoteId) next.add(selectedQuoteId)
      if (selectedQuoteId !== quoteId) next.delete(quoteId)
      return next
    })
    onSelect(quoteId)
  }

  const finishClosingStockDetails = (quoteId: string) => {
    setClosingQuoteIds((current) => {
      const next = new Set(current)
      next.delete(quoteId)
      return next
    })
  }

  const scrollToStock = (quoteId: string) => {
    const scroller = tableScrollerRef.current
    const row = scroller?.querySelector<HTMLTableRowElement>(`tr[data-quote-id="${quoteId}"]`)
    if (!scroller || !row) return

    const scrollerRect = scroller.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const targetTop = scroller.scrollTop
      + rowRect.top - scrollerRect.top
      - (scroller.clientHeight - rowRect.height) / 2
    scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    row.focus({ preventScroll: true })
    window.clearTimeout(locateTimerRef.current)
    window.cancelAnimationFrame(locateFrameRef.current ?? 0)
    setLocatedQuoteId(null)
    locateFrameRef.current = window.requestAnimationFrame(() => {
      setLocatedQuoteId(quoteId)
      locateTimerRef.current = window.setTimeout(() => setLocatedQuoteId(null), 2000)
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
          <TableStockSearch stocks={displayedStocks} onChoose={scrollToStock} />
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

      <div className="table-scroller" ref={tableScrollerRef}>
        <table className="watchlist-table" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <colgroup>
            <col style={{ width: ORDER_COLUMN_WIDTH }} />
            <col style={{ width: COLUMN_META.operation.width }} />
            {adjustableColumnOrder.map((columnId) => (
              <col key={columnId} style={{ width: COLUMN_META[columnId].width }} />
            ))}
            <col style={{ width: DELETE_COLUMN_WIDTH }} />
          </colgroup>
          <thead>
            <tr>
              <th className="order-column">排序</th>
              <th className="settings-column">{COLUMN_META.operation.label}</th>
              {adjustableColumnOrder.map((columnId) => {
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
              <th className="delete-column">删除</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.map(({ stock, quote, metrics, manualIndex }) => {
              const selected = selectedQuoteId === stock.quoteId
              const closing = closingQuoteIds.has(stock.quoteId)
              const quoteDirection = valueClass(quote?.changePercent)
              const currentRadarSignals = stock.showRadarSignals
                ? todayRadarSignals(quote?.radarSignals)
                : []
              const latestRadarSignal = currentRadarSignals[0]
              return (
                <Fragment key={stock.quoteId}>
                  <tr
                    data-quote-id={stock.quoteId}
                    className={`stock-row ${selected ? 'is-selected' : ''} ${locatedQuoteId === stock.quoteId ? 'is-located' : ''} ${draggingQuoteId === stock.quoteId ? 'is-dragging' : ''} ${dragOverQuoteId === stock.quoteId ? 'is-drag-over' : ''}`}
                    onClick={() => toggleStockDetails(stock.quoteId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') toggleStockDetails(stock.quoteId)
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
                    <td className="settings-column">
                      <div className="row-actions">
                        <button
                          className={`row-action-button ${stock.isPriority ? 'is-active' : ''} ${stock.position ? 'is-locked' : ''}`}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onTogglePriority(stock.quoteId) }}
                          aria-pressed={stock.isPriority}
                          aria-disabled={Boolean(stock.position)}
                          aria-label={stock.isPriority ? `取消重点关注 ${stock.name}` : `重点关注 ${stock.name}`}
                          title={stock.position
                            ? '持仓股票已自动设为重点关注'
                            : stock.isPriority ? '取消重点关注' : '设为重点关注'}
                        >
                          <Star size={15} fill={stock.isPriority ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          className={`row-action-button ${stock.showInTaskbar ? 'is-active' : ''}`}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onToggleTaskbar(stock.quoteId) }}
                          aria-pressed={stock.showInTaskbar}
                          aria-label={stock.showInTaskbar ? `取消在任务栏显示 ${stock.name}` : `在任务栏显示 ${stock.name}`}
                          title={stock.showInTaskbar ? '取消任务栏展示' : '直接在任务栏显示实时价格'}
                        >
                          <MonitorUp size={15} />
                        </button>
                        <button
                          className={`row-action-button ${stock.position ? 'has-position' : ''}`}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setEditingStock(stock) }}
                          aria-label={`编辑 ${stock.name} 的持仓`}
                          title="编辑持仓数量和成本"
                        >
                          <PencilLine size={15} />
                        </button>
                        <button
                          className={`row-action-button ${tTradingAccounts[stock.quoteId]?.activeBatch ? 'is-active' : ''}`}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setTTradingStock(stock) }}
                          aria-label={`管理 ${stock.name} 的T仓交易`}
                          title={tTradingAccounts[stock.quoteId]?.activeBatch ? '继续记录当前T批次' : 'T仓管理'}
                        >
                          <span className="t-letter-icon" aria-hidden="true">T</span>
                        </button>
                      </div>
                    </td>
                    {adjustableColumnOrder.map((columnId) => {
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
                        case 'radar':
                          return (
                            <td className="radar-column" key={columnId}>
                              {latestRadarSignal ? (
                                <button
                                  className={`radar-summary-button is-${latestRadarSignal.direction}`}
                                  type="button"
                                  aria-expanded={radarPopover?.quoteId === stock.quoteId}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    if (radarPopover?.quoteId === stock.quoteId) {
                                      setRadarPopover(null)
                                      return
                                    }
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    radarAnchorRef.current = event.currentTarget
                                    const placement = rect.bottom + 280 > window.innerHeight && rect.top > 280
                                      ? 'above'
                                      : 'below'
                                    setRadarPopover({
                                      quoteId: stock.quoteId,
                                      left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
                                      top: placement === 'above' ? rect.top - 7 : rect.bottom + 7,
                                      placement
                                    })
                                  }}
                                  title={`今日 ${currentRadarSignals.length} 条异动，点击查看近 5 日详情`}
                                >
                                  <span>今日有异动</span>
                                  <b>{currentRadarSignals.length}</b>
                                </button>
                              ) : '--'}
                            </td>
                          )
                        case 'positionQuantity': {
                          const holdingDays = getPositionHoldingDays(
                            stock.position,
                            tradingCalendarClosedDates
                          )
                          const openedToday = isPositionOpenedToday(stock.position)
                          return (
                            <td className="position-value-cell" key={columnId}>
                              <span className="position-quantity-cell">
                                <span>{formatShares(stock.position?.quantity)}</span>
                                {holdingDays ? (
                                  <small
                                    className={openedToday ? 'is-today' : undefined}
                                    title={`建仓日期：${stock.position?.openedOn}`}
                                  >
                                    {openedToday ? '今日建仓' : `持仓 ${holdingDays} 天`}
                                  </small>
                                ) : null}
                              </span>
                            </td>
                          )
                        }
                        case 'cost': return <td className="position-value-cell" key={columnId}>{formatPrice(stock.position?.cost)}</td>
                        case 'marketValue': return <td className="position-value-cell" key={columnId}>{formatCurrency(metrics.marketValue)}</td>
                        case 'todayProfit': return <td className={valueClass(metrics.todayProfit)} key={columnId}>{formatProfit(metrics.todayProfit)}</td>
                        case 'todayProfitPercent': return <td className={valueClass(metrics.todayProfitPercent)} key={columnId}>{formatPercent(metrics.todayProfitPercent)}</td>
                        case 'totalProfit': return <td className={valueClass(metrics.totalProfit)} key={columnId}>{formatProfit(metrics.totalProfit)}</td>
                        case 'profitPercent': return <td className={valueClass(metrics.profitPercent)} key={columnId}>{formatPercent(metrics.profitPercent)}</td>
                        case 'operation': return null
                      }
                    })}
                    <td className="delete-column">
                      <button
                        className="icon-button remove-button"
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onRemove(stock.quoteId) }}
                        aria-label={`移除 ${stock.name}`}
                        title="移除自选"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                  {selected || closing ? (
                    <tr className={`expanded-row ${closing && !selected ? 'is-closing' : 'is-opening'}`}>
                      <td colSpan={adjustableColumnOrder.length + 3}>
                        <div
                          className="expanded-row-motion"
                          onAnimationEnd={(event) => {
                            if (event.currentTarget === event.target && closing && !selected) {
                              finishClosingStockDetails(stock.quoteId)
                            }
                          }}
                        >
                          <div className="expanded-row-content">
                            <ExpandedStockDetails
                              stock={stock}
                              quote={quote}
                              refreshSeconds={stock.isPriority ? priorityRefreshSeconds : regularRefreshSeconds}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {radarPopover && activeRadarRow?.quote?.radarSignals?.length ? (
        <div
          className={`radar-popover is-${todayRadarSignals(activeRadarRow.quote.radarSignals)[0]?.direction ?? 'up'} ${radarPopover.placement === 'above' ? 'is-above' : ''}`}
          style={{ left: radarPopover.left, top: radarPopover.top }}
          ref={radarPopoverRef}
          role="dialog"
          aria-label={`${activeRadarRow.stock.name}近5日异动提示`}
        >
          <div className="radar-popover-heading">
            <span>
              <strong>{activeRadarRow.stock.name}</strong>
              <small>{activeRadarRow.stock.code}</small>
            </span>
            <b>近 5 日异动</b>
            <button
              className="icon-button radar-popover-close"
              type="button"
              onClick={() => setRadarPopover(null)}
              aria-label="关闭异动提示"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="radar-popover-list">
            {activeRadarRow.quote.radarSignals.map((signal) => (
              <div className={`radar-popover-item is-${signal.direction}`} key={`${signal.date}-${signal.type}`}>
                <time>{signal.date.slice(4, 6)}-{signal.date.slice(6, 8)} {signal.time}</time>
                <strong>{signal.label}</strong>
                {signal.info ? <small>{signal.info}</small> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {editingStock ? (
        <PositionEditor
          key={editingStock.quoteId}
          stock={watchlist.find((stock) => stock.quoteId === editingStock.quoteId) ?? editingStock}
          quote={quotes.find((quote) => quote.quoteId === editingStock.quoteId)}
          onClose={() => setEditingStock(null)}
          onSave={(position, showRadarSignals, positionSnapshots) => {
            onEditPosition(editingStock.quoteId, position, showRadarSignals, positionSnapshots)
            setEditingStock(null)
          }}
        />
      ) : null}

      {tTradingStock ? (
        <TTradingDrawer
          key={tTradingStock.quoteId}
          stock={watchlist.find((stock) => stock.quoteId === tTradingStock.quoteId) ?? tTradingStock}
          quote={quotes.find((quote) => quote.quoteId === tTradingStock.quoteId)}
          account={tTradingAccounts[tTradingStock.quoteId]}
          feeSettings={tTradingFees}
          onClose={() => setTTradingStock(null)}
          onApply={(account, position) => {
            onUpdateTTrading(tTradingStock.quoteId, account, position)
          }}
        />
      ) : null}
    </div>
  )
}
