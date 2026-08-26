import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Plus,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import { dailyMarketScanBoardLabel } from '../lib/daily-market-scan'
import type {
  DailyMarketScanResult,
  DailyMarketScanRow,
  DailyMarketScanSignalType,
  DailyMarketScanState,
  SearchResult,
  StockTrackingProfiles,
  WatchStock
} from '../shared/types'
import { stockMarketIdentity } from '../shared/stock-market'
import './DailyMarketScanDialog.css'

const PAGE_SIZE = 100

const SIGNAL_LABELS: Record<DailyMarketScanSignalType, string> = {
  volumeSurge: '放量异动',
  strongGain: '大涨放量',
  strongLoss: '大跌放量',
  breakout20d: '20 日新高',
  breakdown20d: '20 日新低',
  reversal: '连跌后翻红'
}

type ScanView = 'all' | DailyMarketScanSignalType
type ScanSortKey = 'changePercent' | 'volumeRatio' | 'rangeBreakPercent' | 'turnoverRate'
type ScanSortDirection = 'asc' | 'desc'

interface ScanSort {
  key: ScanSortKey
  direction: ScanSortDirection
}

const VIEW_OPTIONS: { id: ScanView; label: string }[] = [
  { id: 'all', label: '全部信号' },
  { id: 'volumeSurge', label: '放量异动' },
  { id: 'strongGain', label: '大涨放量' },
  { id: 'strongLoss', label: '大跌放量' },
  { id: 'breakout20d', label: '20 日新高' },
  { id: 'breakdown20d', label: '20 日新低' },
  { id: 'reversal', label: '连跌后翻红' }
]

const EMPTY_STATE: DailyMarketScanState = {
  running: false,
  progress: {
    stage: 'idle',
    message: '尚未执行收盘扫描。',
    completed: 0,
    total: 0
  },
  error: null
}

interface DailyMarketScanDialogProps {
  open: boolean
  watchlist: WatchStock[]
  trackingProfiles: StockTrackingProfiles
  onAddStock: (stock: SearchResult, row: DailyMarketScanRow) => void
  onViewStock: (quoteId: string) => void
  onClose: () => void
}

function directionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

function formatAmount(value: number): string {
  return `${(value / 100_000_000).toFixed(2)} 亿`
}

function formatVolume(value: number): string {
  return value >= 10_000
    ? `${(value / 10_000).toFixed(2)} 万手`
    : `${Math.round(value).toLocaleString('zh-CN')} 手`
}

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function sourceLabel(source: string): string {
  if (source === 'eastmoney-primary') return '东方财富主节点'
  if (source === 'eastmoney-delay') return '东方财富镜像节点'
  if (source === 'demo') return '浏览器演示数据'
  return source
}

function scanSortValue(row: DailyMarketScanRow, key: ScanSortKey): number | null {
  if (key === 'rangeBreakPercent') {
    return row.breakoutPercent ?? row.breakdownPercent ?? null
  }
  return row[key] ?? null
}

function compareScanRows(
  left: DailyMarketScanRow,
  right: DailyMarketScanRow,
  sort: ScanSort
): number {
  const leftValue = scanSortValue(left, sort.key)
  const rightValue = scanSortValue(right, sort.key)
  if (leftValue === null) return rightValue === null ? 0 : 1
  if (rightValue === null) return -1
  return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue
}

interface SortableHeaderProps {
  label: string
  sortKey: ScanSortKey
  sort: ScanSort
  onSort: (key: ScanSortKey) => void
}

function SortableHeader({ label, sortKey, sort, onSort }: SortableHeaderProps) {
  const active = sort.key === sortKey
  return (
    <th aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        className={active ? 'daily-scan-sort is-active' : 'daily-scan-sort'}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp size={13} />
          ) : (
            <ArrowDown size={13} />
          )
        ) : (
          <ArrowUpDown size={13} />
        )}
      </button>
    </th>
  )
}

export function DailyMarketScanDialog({
  open,
  watchlist,
  trackingProfiles,
  onAddStock,
  onViewStock,
  onClose
}: DailyMarketScanDialogProps) {
  const [result, setResult] = useState<DailyMarketScanResult | null>(null)
  const [scanState, setScanState] = useState<DailyMarketScanState>(EMPTY_STATE)
  const [selectedSignals, setSelectedSignals] = useState<DailyMarketScanSignalType[]>([])
  const [sort, setSort] = useState<ScanSort>({ key: 'volumeRatio', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    const unsubscribe = stockApi.onDailyMarketScanProgress((state) => {
      if (active) setScanState(state)
    })
    Promise.all([stockApi.getDailyMarketScanResult(), stockApi.getDailyMarketScanState()])
      .then(([snapshot, state]) => {
        if (!active) return
        setResult(snapshot)
        setScanState(state)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '收盘扫描结果读取失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [open])

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')

  const searchedRows = useMemo(() => {
    const rows = result?.rows ?? []
    if (!normalizedQuery) return rows
    return rows.filter((row) => {
      const boardLabel = dailyMarketScanBoardLabel(row.code) ?? ''
      const signalLabels = row.signals.map((signal) => SIGNAL_LABELS[signal]).join(' ')
      return [row.name, row.code, row.marketLabel, boardLabel, signalLabels]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedQuery)
    })
  }, [normalizedQuery, result])

  useEffect(() => {
    setPage(1)
  }, [normalizedQuery, result, selectedSignals])

  const counts = useMemo(() => {
    const next = new Map<DailyMarketScanSignalType, number>()
    for (const row of searchedRows) {
      for (const signal of row.signals) next.set(signal, (next.get(signal) ?? 0) + 1)
    }
    return next
  }, [searchedRows])

  const filteredRows = useMemo(() => {
    const rows = searchedRows.filter((row) =>
      selectedSignals.every((signal) => row.signals.includes(signal))
    )
    return rows.sort((left, right) => compareScanRows(left, right, sort))
  }, [searchedRows, selectedSignals, sort])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const watchlistQuoteIds = useMemo(
    () => new Set(watchlist.map((stock) => stock.quoteId)),
    [watchlist]
  )
  const progressPercent =
    scanState.progress.total > 0
      ? Math.min(100, (scanState.progress.completed / scanState.progress.total) * 100)
      : 0

  const runScan = async () => {
    setError('')
    setActionMessage('')
    try {
      const snapshot = await stockApi.runDailyMarketScan()
      setResult(snapshot)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '收盘扫描失败')
    }
  }

  const addStock = (row: DailyMarketScanResult['rows'][number]) => {
    onAddStock(
      {
        code: row.code,
        name: row.name,
        quoteId: row.quoteId,
        marketLabel: dailyMarketScanBoardLabel(row.code) ?? row.marketLabel,
        ...stockMarketIdentity(row.quoteId)
      },
      row
    )
    setActionMessage(`${row.name}已开始追踪，并加入追踪分组`)
  }

  const toggleSignal = (signal: DailyMarketScanSignalType) => {
    setSelectedSignals((current) =>
      current.includes(signal) ? current.filter((item) => item !== signal) : [...current, signal]
    )
  }

  const changeSort = (key: ScanSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }))
  }

  if (!open) return null

  return createPortal(
    <div className="daily-scan-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="daily-scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-scan-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="daily-scan-header">
          <div className="daily-scan-title-icon" aria-hidden="true">
            <Activity size={22} />
          </div>
          <div className="daily-scan-title">
            <h2 id="daily-scan-title">A 股收盘扫描</h2>
            <span>
              {result
                ? `${result.tradingDate} · ${sourceLabel(result.source)} · 生成于 ${formatGeneratedAt(result.generatedAt)}`
                : '扫描全市场活跃股票的量价异动'}
            </span>
          </div>
          <button
            className="icon-button daily-scan-close"
            type="button"
            onClick={onClose}
            aria-label="关闭收盘扫描"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        {scanState.running ? (
          <div className="daily-scan-progress" role="status">
            <span className="search-loader" />
            <div>
              <strong>{scanState.progress.message}</strong>
              <span>
                <i style={{ width: `${progressPercent}%` }} />
              </span>
            </div>
          </div>
        ) : null}

        {error || scanState.error ? (
          <div className="daily-scan-error">
            <AlertCircle size={15} />
            {error || scanState.error}
          </div>
        ) : null}

        {loading && !result ? (
          <div className="daily-scan-empty">
            <span className="search-loader" />
            正在读取最近一次扫描结果…
          </div>
        ) : !result ? (
          <div className="daily-scan-empty">
            <Database size={34} />
            <strong>尚无收盘扫描结果</strong>
            <p>
              建议在交易日收盘后运行。将筛选成交额超过 5000 万元的沪深京 A 股，并计算最近 20
              个交易日的量价信号。
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void runScan()}
              disabled={scanState.running}
            >
              <Activity size={16} />
              开始扫描
            </button>
          </div>
        ) : (
          <>
            <div className="daily-scan-toolbar">
              <div className="daily-scan-summary">
                <span>
                  <small>全市场</small>
                  <strong>{result.universeCount.toLocaleString('zh-CN')}</strong>
                </span>
                <span>
                  <small>活跃标的</small>
                  <strong>{result.activeCount.toLocaleString('zh-CN')}</strong>
                </span>
                <span>
                  <small>命中股票</small>
                  <strong>{result.rows.length.toLocaleString('zh-CN')}</strong>
                </span>
                <span>
                  <small>异动信号</small>
                  <strong>{result.signalCount.toLocaleString('zh-CN')}</strong>
                </span>
                <span>
                  <small>K 线失败</small>
                  <strong className={result.klineFailureCount ? 'is-warning' : ''}>
                    {result.klineFailureCount.toLocaleString('zh-CN')}
                  </strong>
                </span>
              </div>
              <div className="daily-scan-toolbar-actions">
                <label className="daily-scan-filter">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="筛选名称、代码、板块或信号"
                    aria-label="筛选收盘扫描结果"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="清空筛选"
                      title="清空筛选"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </label>
                <button
                  className="secondary-button daily-scan-run"
                  type="button"
                  onClick={() => void runScan()}
                  disabled={scanState.running}
                >
                  <RefreshCw size={15} className={scanState.running ? 'is-spinning' : ''} />
                  {scanState.running ? '扫描中' : '重新扫描'}
                </button>
              </div>
            </div>

            <div className="daily-scan-tabs" role="group" aria-label="收盘扫描信号组合筛选">
              <span className="daily-scan-combination-hint">组合筛选（同时满足）</span>
              {VIEW_OPTIONS.map((option) => {
                const count =
                  option.id === 'all' ? searchedRows.length : (counts.get(option.id) ?? 0)
                const signal = option.id === 'all' ? null : option.id
                const active =
                  signal === null ? selectedSignals.length === 0 : selectedSignals.includes(signal)
                return (
                  <button
                    className={active ? 'is-active' : ''}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      signal === null ? setSelectedSignals([]) : toggleSignal(signal)
                    }
                    key={option.id}
                  >
                    {option.label}
                    <span>{count}</span>
                  </button>
                )
              })}
            </div>

            {actionMessage ? (
              <div className="daily-scan-action-message">{actionMessage}</div>
            ) : null}

            <div className="daily-scan-table-wrap">
              <table className="daily-scan-table">
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>收盘价</th>
                    <SortableHeader
                      label="涨跌幅"
                      sortKey="changePercent"
                      sort={sort}
                      onSort={changeSort}
                    />
                    <th>成交额</th>
                    <th>成交量</th>
                    <th>20 日均量</th>
                    <SortableHeader
                      label="量比"
                      sortKey="volumeRatio"
                      sort={sort}
                      onSort={changeSort}
                    />
                    <SortableHeader
                      label="换手率"
                      sortKey="turnoverRate"
                      sort={sort}
                      onSort={changeSort}
                    />
                    <SortableHeader
                      label="新高/新低幅度"
                      sortKey="rangeBreakPercent"
                      sort={sort}
                      onSort={changeSort}
                    />
                    <th>前 5 日累计</th>
                    <th>信号</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const watched = watchlistQuoteIds.has(row.quoteId)
                    const trackingProfile = trackingProfiles[row.quoteId]
                    const tracking = trackingProfile?.status === 'tracking'
                    const sourceRecorded =
                      trackingProfile?.sources.some(
                        (source) =>
                          source.type === 'dailyScan' &&
                          source.detail?.tradingDate === row.tradingDate
                      ) ?? false
                    const viewExisting = watched && tracking && sourceRecorded
                    const boardLabel = dailyMarketScanBoardLabel(row.code)
                    const rangeBreakPercent = row.breakoutPercent ?? row.breakdownPercent ?? null
                    return (
                      <tr key={row.quoteId}>
                        <td>
                          <span className="daily-scan-stock">
                            <strong>
                              {row.name}
                              {boardLabel ? (
                                <span
                                  className={`daily-scan-board-badge ${boardLabel === '创业板' ? 'is-chinext' : 'is-star'}`}
                                >
                                  {boardLabel}
                                </span>
                              ) : null}
                            </strong>
                            <small>
                              {row.code} · {row.marketLabel}
                            </small>
                          </span>
                        </td>
                        <td>{row.latest.toFixed(2)}</td>
                        <td className={directionClass(row.changePercent)}>
                          {formatPercent(row.changePercent)}
                        </td>
                        <td>{formatAmount(row.amount)}</td>
                        <td>{formatVolume(row.volume)}</td>
                        <td>{formatVolume(row.averageVolume20d)}</td>
                        <td>
                          <strong>{row.volumeRatio.toFixed(2)}x</strong>
                        </td>
                        <td>{formatPercent(row.turnoverRate)}</td>
                        <td className={directionClass(rangeBreakPercent)}>
                          {formatPercent(rangeBreakPercent)}
                        </td>
                        <td className={directionClass(row.previousFiveDayReturn)}>
                          {formatPercent(row.previousFiveDayReturn)}
                        </td>
                        <td>
                          <span className="daily-scan-tags">
                            {row.signals.map((signal) => (
                              <em className={`is-${signal}`} key={signal}>
                                {SIGNAL_LABELS[signal]}
                              </em>
                            ))}
                          </span>
                        </td>
                        <td>
                          <button
                            className="daily-scan-row-action"
                            type="button"
                            onClick={() =>
                              viewExisting ? onViewStock(row.quoteId) : addStock(row)
                            }
                          >
                            {viewExisting ? <Eye size={14} /> : <Plus size={14} />}
                            {viewExisting
                              ? '查看'
                              : watched && tracking
                                ? '记录来源'
                                : watched
                                  ? '开始追踪'
                                  : '加入并追踪'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {visibleRows.length === 0 ? (
                <div className="daily-scan-no-signals">
                  {normalizedQuery
                    ? `没有找到与“${deferredQuery.trim()}”匹配的扫描结果。`
                    : selectedSignals.length > 1
                      ? '没有同时满足当前标签组合的股票。'
                      : '当前筛选条件没有命中股票。'}
                </div>
              ) : null}
            </div>

            <footer className="daily-scan-footer">
              <span>标签可多选并按同时满足筛选；量比使用此前 20 个交易日均量。</span>
              <div>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  aria-label="上一页"
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  第 {page} / {pageCount} 页 · 共 {filteredRows.length.toLocaleString('zh-CN')} 只
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount}
                  aria-label="下一页"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body
  )
}
