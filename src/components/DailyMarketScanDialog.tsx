import {
  Activity,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import type {
  DailyMarketScanResult,
  DailyMarketScanSignalType,
  DailyMarketScanState,
  SearchResult,
  WatchStock
} from '../shared/types'
import './DailyMarketScanDialog.css'

const PAGE_SIZE = 100

const SIGNAL_LABELS: Record<DailyMarketScanSignalType, string> = {
  volumeSurge: '放量异动',
  strongGain: '大涨放量',
  breakout20d: '20 日新高',
  reversal: '连跌后翻红'
}

type ScanView = 'all' | DailyMarketScanSignalType

const VIEW_OPTIONS: { id: ScanView; label: string }[] = [
  { id: 'all', label: '全部信号' },
  { id: 'volumeSurge', label: '放量异动' },
  { id: 'strongGain', label: '大涨放量' },
  { id: 'breakout20d', label: '20 日新高' },
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
  onAddStock: (stock: SearchResult) => void
  onViewStock: (quoteId: string) => void
  onClose: () => void
}

function directionClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatPercent(value: number | null): string {
  if (value === null) return '--'
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

export function DailyMarketScanDialog({
  open,
  watchlist,
  onAddStock,
  onViewStock,
  onClose
}: DailyMarketScanDialogProps) {
  const [result, setResult] = useState<DailyMarketScanResult | null>(null)
  const [scanState, setScanState] = useState<DailyMarketScanState>(EMPTY_STATE)
  const [activeView, setActiveView] = useState<ScanView>('all')
  const [page, setPage] = useState(1)
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

  useEffect(() => {
    setPage(1)
  }, [activeView, result])

  const counts = useMemo(() => {
    const next = new Map<DailyMarketScanSignalType, number>()
    for (const row of result?.rows ?? []) {
      for (const signal of row.signals) next.set(signal, (next.get(signal) ?? 0) + 1)
    }
    return next
  }, [result])

  const filteredRows = useMemo(() => {
    const rows = (result?.rows ?? []).filter(
      (row) => activeView === 'all' || row.signals.includes(activeView)
    )
    return rows.sort((left, right) => {
      if (activeView === 'strongGain' || activeView === 'reversal') {
        return right.changePercent - left.changePercent
      }
      if (activeView === 'breakout20d') {
        return (right.breakoutPercent ?? 0) - (left.breakoutPercent ?? 0)
      }
      return right.volumeRatio - left.volumeRatio
    })
  }, [activeView, result])

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
    onAddStock({
      code: row.code,
      name: row.name,
      quoteId: row.quoteId,
      marketLabel: row.marketLabel
    })
    setActionMessage(`${row.name}已加入自选`)
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

            <div className="daily-scan-tabs" role="tablist" aria-label="收盘扫描信号分类">
              {VIEW_OPTIONS.map((option) => {
                const count =
                  option.id === 'all' ? result.rows.length : (counts.get(option.id) ?? 0)
                return (
                  <button
                    className={activeView === option.id ? 'is-active' : ''}
                    type="button"
                    role="tab"
                    aria-selected={activeView === option.id}
                    onClick={() => setActiveView(option.id)}
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
                    <th>涨跌幅</th>
                    <th>成交额</th>
                    <th>成交量</th>
                    <th>20 日均量</th>
                    <th>量比</th>
                    <th>突破幅度</th>
                    <th>前 5 日累计</th>
                    <th>信号</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const watched = watchlistQuoteIds.has(row.quoteId)
                    return (
                      <tr key={row.quoteId}>
                        <td>
                          <span className="daily-scan-stock">
                            <strong>{row.name}</strong>
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
                        <td className={directionClass(row.breakoutPercent)}>
                          {formatPercent(row.breakoutPercent)}
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
                            onClick={() => (watched ? onViewStock(row.quoteId) : addStock(row))}
                          >
                            {watched ? <Eye size={14} /> : <Plus size={14} />}
                            {watched ? '查看' : '自选'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {visibleRows.length === 0 ? (
                <div className="daily-scan-no-signals">该分类当前没有命中股票。</div>
              ) : null}
            </div>

            <footer className="daily-scan-footer">
              <span>量比使用此前 20 个交易日均量；不同分类之间允许重叠。</span>
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
