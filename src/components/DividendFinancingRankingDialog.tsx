import {
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Plus,
  RefreshCw,
  Search,
  Trophy,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isDesktopRuntime, stockApi } from '../lib/api'
import type {
  DataSnapshotRuntimeState,
  DividendFinancingChangeItem,
  DividendFinancingChangeReport,
  DividendFinancingMarket,
  DividendFinancingQualityScoreBreakdown,
  DividendFinancingRankingItem,
  DividendFinancingSnapshot,
  DividendFinancingUpdateProgress,
  SearchResult,
  StockTrackingProfiles,
  WatchStock
} from '../shared/types'
import { useConfirmDialog } from './ConfirmDialog'

const PAGE_SIZE = 50
const MARKET_LABELS: Record<DividendFinancingMarket, string> = {
  SH: '沪市',
  SZ: '深市',
  BJ: '北交所'
}

type MarketFilter = DividendFinancingMarket | 'ALL'
type ViewMode = 'ranking' | 'changes' | 'visualization'
type SortKey =
  | 'rank'
  | 'dividendYi'
  | 'financingYi'
  | 'netReturnYi'
  | 'ratio'
  | 'dividendYield'
  | 'recent5YearDividendYi'
  | 'consecutiveDividendYears'
  | 'qualityScore'

interface DividendFinancingRankingDialogProps {
  open: boolean
  cachedSnapshot: DividendFinancingSnapshot | null
  cachedChangeReport: DividendFinancingChangeReport | null
  dataState: DataSnapshotRuntimeState
  watchlist: WatchStock[]
  trackingProfiles: StockTrackingProfiles
  onAddStock: (
    stock: SearchResult,
    item: DividendFinancingRankingItem,
    snapshotDate: string | undefined
  ) => void
  onViewStock: (quoteId: string) => void
  onSnapshotChange: (snapshot: DividendFinancingSnapshot) => void
  onChangeReportChange: (report: DividendFinancingChangeReport | null) => void
  onClose: () => void
}

interface StockActionProps {
  item: DividendFinancingRankingItem
  watchedStock?: WatchStock
  tracking: boolean
  sourceRecorded: boolean
  addingCode: string
  onAdd: (item: DividendFinancingRankingItem) => void
  onView: (quoteId: string) => void
}

function formatAmount(value: number): string {
  return Math.abs(value) < 1
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ratioTier(value: number): string {
  if (value >= 1000) return 'is-top'
  if (value >= 500) return 'is-high'
  if (value >= 200) return 'is-medium'
  return 'is-base'
}

function signedClass(value: number): string {
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-zero'
}

function netReturn(item: DividendFinancingRankingItem): number {
  return item.netReturnYi ?? item.dividendYi - item.financingYi
}

function scorePartRows(breakdown: DividendFinancingQualityScoreBreakdown) {
  return [
    ['分红融资比分位', breakdown.ratio, 30],
    ['净回报额分位', breakdown.netReturn, 25],
    ['分红连续性', breakdown.continuity, 25],
    ['近期增长', breakdown.growth, 10],
    ['融资纪律', breakdown.financingDiscipline, 10]
  ] as const
}

function StockAction({
  item,
  watchedStock,
  tracking,
  sourceRecorded,
  addingCode,
  onAdd,
  onView
}: StockActionProps) {
  return watchedStock && tracking && sourceRecorded ? (
    <button
      className="secondary-button dividend-ranking-row-action"
      type="button"
      onClick={() => onView(watchedStock.quoteId)}
    >
      <Eye size={14} />
      查看自选
    </button>
  ) : (
    <button
      className="secondary-button dividend-ranking-row-action"
      type="button"
      onClick={() => onAdd(item)}
      disabled={addingCode === item.code}
    >
      {addingCode === item.code ? <span className="search-loader" /> : <Plus size={14} />}
      {watchedStock && tracking ? '记录来源' : watchedStock ? '开始追踪' : '加入并追踪'}
    </button>
  )
}

function ChangeReportPanel({ report }: { report: DividendFinancingChangeReport | null }) {
  if (!report) {
    return (
      <div className="dividend-ranking-empty-panel">
        <strong>还没有可比较的更新记录</strong>
        <span>首次手动运行更新脚本后，这里会对比更新前后的榜单快照。</span>
      </div>
    )
  }
  const changeLabels: Record<DividendFinancingChangeItem['changeTypes'][number], string> = {
    added: '新入榜',
    removed: '移出榜单',
    rank: '排名变化',
    ratio: '比例变化',
    dividend: '分红增加',
    financing: '融资增加'
  }
  return (
    <div className="dividend-change-panel">
      <div className="dividend-change-heading">
        <div>
          <strong>{report.previousSnapshotDate}</strong>
          <span> → </span>
          <strong>{report.currentSnapshotDate}</strong>
        </div>
        <span>比较 {report.rows.length} 只有变化的股票</span>
      </div>
      <div className="dividend-change-summary">
        <div>
          <span>新入榜</span>
          <strong>{report.summary.addedCount}</strong>
        </div>
        <div>
          <span>移出榜单</span>
          <strong>{report.summary.removedCount}</strong>
        </div>
        <div>
          <span>排名变化</span>
          <strong>{report.summary.rankChangedCount}</strong>
        </div>
        <div>
          <span>分红增加</span>
          <strong>{report.summary.dividendIncreasedCount}</strong>
        </div>
        <div className="is-risk">
          <span>融资增加</span>
          <strong>{report.summary.financingIncreasedCount}</strong>
        </div>
      </div>
      <div className="dividend-ranking-table-scroller">
        <table className="dividend-change-table">
          <thead>
            <tr>
              <th>股票</th>
              <th>变化类型</th>
              <th>榜单排名</th>
              <th>分红融资比</th>
              <th>新增分红</th>
              <th>新增融资</th>
              <th>质量评分</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((item) => (
              <tr key={item.code}>
                <td>
                  <div className="dividend-ranking-stock">
                    <strong>{item.name}</strong>
                    <span>
                      {item.code} · {MARKET_LABELS[item.market]}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="dividend-change-tags">
                    {item.changeTypes.map((type) => (
                      <span className={`is-${type}`} key={type}>
                        {changeLabels[type]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className={signedClass(item.rankChange ?? 0)}>
                  {item.previousRank ?? '--'} → {item.currentRank ?? '--'}
                  {item.rankChange ? (
                    <small>
                      （{item.rankChange > 0 ? '+' : ''}
                      {item.rankChange}）
                    </small>
                  ) : null}
                </td>
                <td className={signedClass(item.ratioChange ?? 0)}>
                  {item.previousRatio?.toFixed(2) ?? '--'}% →{' '}
                  {item.currentRatio?.toFixed(2) ?? '--'}%
                </td>
                <td className={signedClass(item.dividendIncreaseYi)}>
                  {item.dividendIncreaseYi > 0
                    ? `+${formatAmount(item.dividendIncreaseYi)} 亿元`
                    : '--'}
                </td>
                <td className={item.financingIncreaseYi > 0 ? 'is-negative' : 'is-zero'}>
                  {item.financingIncreaseYi > 0
                    ? `+${formatAmount(item.financingIncreaseYi)} 亿元`
                    : '--'}
                </td>
                <td className={signedClass(item.qualityScoreChange ?? 0)}>
                  {item.previousQualityScore?.toFixed(1) ?? '--'} →{' '}
                  {item.currentQualityScore?.toFixed(1) ?? '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface VisualizationPanelProps {
  rows: DividendFinancingRankingItem[]
  watchlistByCode: ReadonlyMap<string, WatchStock>
  trackingProfiles: StockTrackingProfiles
  snapshotDate: string | undefined
  addingCode: string
  onAdd: (item: DividendFinancingRankingItem) => void
  onView: (quoteId: string) => void
}

function VisualizationPanel({
  rows,
  watchlistByCode,
  trackingProfiles,
  snapshotDate,
  addingCode,
  onAdd,
  onView
}: VisualizationPanelProps) {
  const [selectedCode, setSelectedCode] = useState('')
  const [hoveredCode, setHoveredCode] = useState('')
  const drawableRows = rows.filter((item) => item.financingYi > 0 && item.dividendYi > 0)
  const activeCode = hoveredCode || selectedCode
  const selected = rows.find((item) => item.code === activeCode) ?? drawableRows[0]
  if (drawableRows.length === 0) {
    return <div className="dividend-ranking-empty-panel">当前筛选条件下没有可绘制的股票</div>
  }
  const width = 960
  const height = 480
  const margin = { left: 78, right: 28, top: 24, bottom: 58 }
  const valuesX = drawableRows.map((item) => Math.log10(item.financingYi))
  const valuesY = drawableRows.map((item) => Math.log10(item.dividendYi))
  const minLogX = Math.min(...valuesX)
  const maxLogX = Math.max(...valuesX)
  const minLogY = Math.min(...valuesY)
  const maxLogY = Math.max(...valuesY)
  const rangeX = Math.max(0.1, maxLogX - minLogX)
  const rangeY = Math.max(0.1, maxLogY - minLogY)
  const xMin = minLogX - rangeX * 0.04
  const xMax = maxLogX + rangeX * 0.04
  const yMin = minLogY - rangeY * 0.06
  const yMax = maxLogY + rangeY * 0.06
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const xForLog = (value: number) => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth
  const yForLog = (value: number) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight
  const xFor = (value: number) => xForLog(Math.log10(value))
  const yFor = (value: number) => yForLog(Math.log10(value))
  const ticks = Array.from({ length: 5 }, (_, index) => index / 4)
  const ratioLines = [1, 2, 5, 10].flatMap((ratio) => {
    const startLogX = Math.max(xMin, yMin - Math.log10(ratio))
    const endLogX = Math.min(xMax, yMax - Math.log10(ratio))
    if (startLogX >= endLogX) return []
    return [{ ratio, startLogX, endLogX }]
  })

  return (
    <div className="dividend-visualization-panel">
      <div className="dividend-scatter-intro">
        <span>
          横轴累计融资、纵轴累计分红，均为对数刻度；点越靠左上，历史股东现金回报特征越强。
        </span>
        <div className="dividend-scatter-legend">
          {(Object.keys(MARKET_LABELS) as DividendFinancingMarket[]).map((market) => (
            <span className={`is-${market.toLowerCase()}`} key={market}>
              {MARKET_LABELS[market]}
            </span>
          ))}
        </div>
      </div>
      <div className="dividend-scatter-layout">
        <svg
          className="dividend-scatter"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="累计融资与累计分红散点图"
        >
          {ticks.map((position) => {
            const xLog = xMin + (xMax - xMin) * position
            const yLog = yMin + (yMax - yMin) * position
            return (
              <g key={position}>
                <line
                  className="dividend-scatter-grid"
                  x1={xForLog(xLog)}
                  x2={xForLog(xLog)}
                  y1={margin.top}
                  y2={height - margin.bottom}
                />
                <text
                  className="dividend-scatter-axis-label"
                  x={xForLog(xLog)}
                  y={height - 28}
                  textAnchor="middle"
                >
                  {formatAmount(10 ** xLog)}
                </text>
                <line
                  className="dividend-scatter-grid"
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={yForLog(yLog)}
                  y2={yForLog(yLog)}
                />
                <text
                  className="dividend-scatter-axis-label"
                  x={margin.left - 10}
                  y={yForLog(yLog) + 4}
                  textAnchor="end"
                >
                  {formatAmount(10 ** yLog)}
                </text>
              </g>
            )
          })}
          {ratioLines.map((line) => (
            <g key={line.ratio}>
              <line
                className="dividend-scatter-ratio-line"
                x1={xForLog(line.startLogX)}
                y1={yForLog(line.startLogX + Math.log10(line.ratio))}
                x2={xForLog(line.endLogX)}
                y2={yForLog(line.endLogX + Math.log10(line.ratio))}
              />
              <text
                className="dividend-scatter-ratio-label"
                x={xForLog(line.endLogX) - 5}
                y={yForLog(line.endLogX + Math.log10(line.ratio)) - 7}
                textAnchor="end"
              >
                {line.ratio * 100}%
              </text>
            </g>
          ))}
          <text
            className="dividend-scatter-title-label"
            x={width / 2}
            y={height - 5}
            textAnchor="middle"
          >
            累计A股融资（亿元，对数）
          </text>
          <text
            className="dividend-scatter-title-label"
            transform={`translate(18 ${height / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            累计A股分红（亿元，对数）
          </text>
          {drawableRows.map((item) => (
            <circle
              key={item.code}
              className={`dividend-scatter-point is-${item.market.toLowerCase()} ${activeCode === item.code ? 'is-active' : ''}`}
              cx={xFor(item.financingYi)}
              cy={yFor(item.dividendYi)}
              r={activeCode === item.code ? 6 : 3.5}
              tabIndex={0}
              role="button"
              aria-label={`${item.name}，分红融资比 ${item.ratio.toFixed(2)}%`}
              onMouseEnter={() => setHoveredCode(item.code)}
              onMouseLeave={() => setHoveredCode('')}
              onFocus={() => setHoveredCode(item.code)}
              onBlur={() => setHoveredCode('')}
              onClick={() => setSelectedCode(item.code)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedCode(item.code)
              }}
            >
              <title>
                {item.name} {item.code} · 分红 {formatAmount(item.dividendYi)}亿 · 融资{' '}
                {formatAmount(item.financingYi)}亿
              </title>
            </circle>
          ))}
        </svg>
        {selected ? (
          <aside className="dividend-scatter-selection">
            <div>
              <span>
                {selected.code} · {MARKET_LABELS[selected.market]}
              </span>
              <strong>{selected.name}</strong>
            </div>
            <dl>
              <div>
                <dt>分红融资比</dt>
                <dd>{selected.ratio.toFixed(2)}%</dd>
              </div>
              <div>
                <dt>累计分红</dt>
                <dd>{formatAmount(selected.dividendYi)} 亿元</dd>
              </div>
              <div>
                <dt>累计融资</dt>
                <dd>{formatAmount(selected.financingYi)} 亿元</dd>
              </div>
              <div>
                <dt>净回报额</dt>
                <dd className={signedClass(netReturn(selected))}>
                  {formatAmount(netReturn(selected))} 亿元
                </dd>
              </div>
              <div>
                <dt>连续分红</dt>
                <dd>{selected.consecutiveDividendYears ?? '--'} 年</dd>
              </div>
              <div>
                <dt>质量评分</dt>
                <dd>{selected.qualityScore?.toFixed(1) ?? '--'} / 100</dd>
              </div>
            </dl>
            <StockAction
              item={selected}
              watchedStock={watchlistByCode.get(selected.code)}
              tracking={
                trackingProfiles[watchlistByCode.get(selected.code)?.quoteId ?? '']?.status ===
                'tracking'
              }
              sourceRecorded={
                trackingProfiles[watchlistByCode.get(selected.code)?.quoteId ?? '']?.sources.some(
                  (source) =>
                    source.type === 'dividendFinancing' &&
                    source.detail?.snapshotDate === snapshotDate
                ) ?? false
              }
              addingCode={addingCode}
              onAdd={onAdd}
              onView={onView}
            />
          </aside>
        ) : null}
      </div>
    </div>
  )
}

export function DividendFinancingRankingDialog({
  open,
  cachedSnapshot,
  cachedChangeReport,
  dataState,
  watchlist,
  trackingProfiles,
  onAddStock,
  onViewStock,
  onSnapshotChange,
  onChangeReportChange,
  onClose
}: DividendFinancingRankingDialogProps) {
  const confirm = useConfirmDialog()
  const [snapshot, setSnapshot] = useState<DividendFinancingSnapshot | null>(null)
  const [changeReport, setChangeReport] = useState<DividendFinancingChangeReport | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('ranking')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [threshold, setThreshold] = useState(100)
  const [market, setMarket] = useState<MarketFilter>('ALL')
  const [onlyWatchlist, setOnlyWatchlist] = useState(false)
  const [minNetReturn, setMinNetReturn] = useState(0)
  const [minDividend, setMinDividend] = useState(0)
  const [minFinancing, setMinFinancing] = useState(0)
  const [minDividendYield, setMinDividendYield] = useState(0)
  const [minConsecutiveYears, setMinConsecutiveYears] = useState(0)
  const [minQualityScore, setMinQualityScore] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('qualityScore')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [addingCode, setAddingCode] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<DividendFinancingUpdateProgress | null>(null)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const methodologyRef = useRef<HTMLDivElement>(null)

  const closeDialog = useCallback(() => {
    setMethodologyOpen(false)
    onClose()
  }, [onClose])

  useEffect(() => stockApi.onDividendFinancingUpdateProgress(setUpdateProgress), [])

  useEffect(() => {
    if (!open) return
    if (cachedSnapshot) {
      setSnapshot(cachedSnapshot)
      setChangeReport(cachedChangeReport)
      setLoadError('')
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setLoadError('')
    Promise.all([
      stockApi.getDividendFinancingSnapshot(),
      stockApi.getDividendFinancingChangeReport()
    ])
      .then(([data, changes]) => {
        if (!active) return
        setSnapshot(data)
        setChangeReport(changes)
        if (data) onSnapshotChange(data)
        onChangeReportChange(changes)
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : '分红融资榜读取失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [cachedChangeReport, cachedSnapshot, onChangeReportChange, onSnapshotChange, open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.confirm-dialog-backdrop'))
        closeDialog()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeDialog, open])

  useEffect(() => {
    if (!open || !methodologyOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!methodologyRef.current?.contains(event.target as Node)) setMethodologyOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [methodologyOpen, open])

  useEffect(
    () => setPage(1),
    [
      market,
      minConsecutiveYears,
      minDividend,
      minDividendYield,
      minFinancing,
      minNetReturn,
      minQualityScore,
      onlyWatchlist,
      query,
      threshold
    ]
  )

  const watchlistByCode = useMemo(
    () => new Map(watchlist.map((stock) => [stock.code, stock])),
    [watchlist]
  )
  const normalizedQuery = query.trim().replaceAll(' ', '').toLowerCase()
  const filteredRows = useMemo(() => {
    if (!snapshot) return []
    const rows = snapshot.rows.filter((item) => {
      if (item.ratio < threshold) return false
      if (netReturn(item) < minNetReturn) return false
      if (item.dividendYi < minDividend || item.financingYi < minFinancing) return false
      if (
        minDividendYield > 0 &&
        (item.dividendYield === null ||
          item.dividendYield === undefined ||
          item.dividendYield < minDividendYield)
      ) {
        return false
      }
      if ((item.consecutiveDividendYears ?? 0) < minConsecutiveYears) return false
      if ((item.qualityScore ?? 0) < minQualityScore) return false
      if (market !== 'ALL' && item.market !== market) return false
      if (onlyWatchlist && !watchlistByCode.has(item.code)) return false
      if (!normalizedQuery) return true
      return `${item.code}${item.name.replaceAll(' ', '')}`.toLowerCase().includes(normalizedQuery)
    })
    return rows.sort((left, right) => {
      const leftValue = sortKey === 'netReturnYi' ? netReturn(left) : left[sortKey]
      const rightValue = sortKey === 'netReturnYi' ? netReturn(right) : right[sortKey]
      if (leftValue === null || leftValue === undefined) {
        return rightValue === null || rightValue === undefined ? 0 : 1
      }
      if (rightValue === null || rightValue === undefined) return -1
      const value = leftValue - rightValue
      return sortDirection === 'asc' ? value : -value
    })
  }, [
    market,
    minConsecutiveYears,
    minDividend,
    minDividendYield,
    minFinancing,
    minNetReturn,
    minQualityScore,
    normalizedQuery,
    onlyWatchlist,
    snapshot,
    sortDirection,
    sortKey,
    threshold,
    watchlistByCode
  ])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const tierCounts = useMemo(() => {
    const rows = snapshot?.rows ?? []
    return [1000, 500, 200].map((value) => ({
      value,
      count: rows.filter((item) => item.ratio >= value).length
    }))
  }, [snapshot])
  const updateRunning = updating || dataState.status === 'queued' || dataState.status === 'updating'

  const changeSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(nextKey)
      setSortDirection(nextKey === 'rank' ? 'asc' : 'desc')
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDirection === 'asc' ? '↑' : '↓') : ''

  const addStock = async (item: DividendFinancingRankingItem) => {
    setAddingCode(item.code)
    setActionMessage('')
    try {
      const results = await stockApi.searchStocks(item.code)
      const result = results.find((stock) => stock.code === item.code)
      if (!result) throw new Error(`未找到 ${item.code} 的当前行情信息`)
      onAddStock(result, item, snapshot?.snapshotDate)
      setActionMessage(`${result.name}已开始追踪，并加入追踪分组`)
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : '加入自选失败')
    } finally {
      setAddingCode('')
    }
  }

  const runUpdate = async () => {
    const confirmed = await confirm({
      title: '运行分红融资榜更新脚本',
      message:
        '脚本将访问东方财富、同花顺和新浪公开数据，处理全部A股通常耗时较长。运行前会检查 Python 3 和 requests 环境。',
      confirmLabel: '开始运行'
    })
    if (!confirmed) return

    setUpdating(true)
    setActionMessage('')
    try {
      const result = await stockApi.runDividendFinancingUpdate()
      setSnapshot(result.snapshot)
      setChangeReport(result.changeReport)
      onSnapshotChange(result.snapshot)
      onChangeReportChange(result.changeReport)
      setActionMessage(`数据已更新，报告保存于 ${result.reportPath}`)
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : '更新脚本运行失败')
    } finally {
      setUpdating(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="dividend-ranking-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section
        className="dividend-ranking-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dividend-ranking-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dividend-ranking-header">
          <div className="dividend-ranking-title-icon" aria-hidden="true">
            <Trophy size={21} />
          </div>
          <div className="dividend-ranking-title">
            <h2 id="dividend-ranking-title">A股分红融资回报分析</h2>
            <span>
              {snapshot
                ? `数据快照 ${snapshot.snapshotDate} · ${snapshot.rows.length} 只股票`
                : dataState.progressMessage || '尚无分红融资榜快照'}
            </span>
          </div>
          <div className="dividend-ranking-header-actions">
            {snapshot && (dataState.status === 'stale' || dataState.status === 'failed') ? (
              <div className={`dividend-ranking-header-notice is-${dataState.status}`}>
                <span>
                  <strong>
                    {dataState.status === 'stale' ? '当前数据已过期' : '最近一次更新失败'}
                  </strong>
                  <small>{dataState.staleReason || dataState.error}</small>
                </span>
                <button type="button" onClick={runUpdate} disabled={updateRunning}>
                  <RefreshCw size={14} className={updateRunning ? 'is-spinning' : ''} />
                  {updateRunning ? '更新中' : '立即更新'}
                </button>
              </div>
            ) : null}
            <button
              className="icon-button dividend-ranking-close"
              type="button"
              onClick={closeDialog}
              aria-label="关闭分红融资榜"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="dividend-ranking-loading">
            <span className="search-loader" />
            正在读取榜单数据…
          </div>
        ) : !snapshot ? (
          <div className={`dividend-ranking-no-data is-${dataState.status}`}>
            {updateRunning ? <span className="search-loader" /> : <Database size={28} />}
            <strong>
              {updateRunning
                ? '正在首次获取分红融资榜数据'
                : dataState.status === 'failed' || loadError
                  ? '分红融资榜获取失败'
                  : '尚无分红融资榜数据'}
            </strong>
            <p>
              {loadError ||
                dataState.error ||
                dataState.progressMessage ||
                '点击下方按钮获取最新数据。'}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={runUpdate}
              disabled={!isDesktopRuntime || updateRunning}
            >
              <RefreshCw size={15} className={updateRunning ? 'is-spinning' : ''} />
              {updateRunning ? '获取中' : '重新获取'}
            </button>
          </div>
        ) : (
          <>
            <div className="dividend-ranking-summary">
              <div>
                <span>入选股票</span>
                <strong>{snapshot.rows.length}</strong>
              </div>
              {tierCounts.map((item) => (
                <div key={item.value}>
                  <span>{item.value}% 以上</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>

            <div className="dividend-ranking-tabs">
              <div
                className="dividend-ranking-tab-list"
                role="tablist"
                aria-label="分红融资分析类型"
              >
                <button
                  className={viewMode === 'ranking' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'ranking'}
                  onClick={() => setViewMode('ranking')}
                >
                  深度榜单
                </button>
                <button
                  className={viewMode === 'changes' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'changes'}
                  onClick={() => setViewMode('changes')}
                >
                  更新变化
                </button>
                <button
                  className={viewMode === 'visualization' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'visualization'}
                  onClick={() => setViewMode('visualization')}
                >
                  可视化选股
                </button>
              </div>
              <div className="dividend-ranking-tab-actions">
                <div className="dividend-ranking-methodology-control" ref={methodologyRef}>
                  <button
                    className="dividend-ranking-methodology-trigger"
                    type="button"
                    aria-expanded={methodologyOpen}
                    onClick={() => setMethodologyOpen((current) => !current)}
                  >
                    <Database size={14} />
                    统计口径与评分
                  </button>
                  {methodologyOpen ? (
                    <div
                      className="dividend-ranking-methodology"
                      role="dialog"
                      aria-label="统计口径与评分"
                    >
                      <p>
                        净回报额 = 上市以来累计A股现金分红 − 累计A股股权融资；分红融资比 = 分红 ÷
                        融资 × 100%。
                      </p>
                      <p>
                        年度分红按已实施事件拆分，再按精确累计分红总额等比例校准；融资只统计IPO、增发和配股的募集净额。
                      </p>
                      <p>
                        股息率 = 最近完整年度每股分红 ÷ 更新时前收盘价 ×
                        100%；年度分红或前收盘价缺失时显示“--”。
                      </p>
                      <p>
                        回报质量评分：比例分位30分、净回报分位25分、连续性25分、近期增长10分、融资纪律10分，只在当前“超过100%”样本内比较。
                      </p>
                      <p>
                        融资额很小会放大比例，请结合“最低融资额”、净回报额和累计分红筛选，避免只看极端比例。
                      </p>
                      <p>
                        识别有效股票 {snapshot.activeStockCount} 只，精确复核{' '}
                        {snapshot.exactCandidateCount} 只；接口失败：融资{' '}
                        {snapshot.financingErrorCount} 只、分红 {snapshot.dividendErrorCount}{' '}
                        只。数据不构成投资建议。
                      </p>
                    </div>
                  ) : null}
                </div>
                <button
                  className="secondary-button dividend-ranking-update"
                  type="button"
                  onClick={runUpdate}
                  disabled={!isDesktopRuntime || updateRunning}
                  title={
                    isDesktopRuntime ? '手动运行 Python 数据更新脚本' : '仅桌面版支持运行更新脚本'
                  }
                >
                  <RefreshCw size={15} className={updateRunning ? 'is-spinning' : ''} />
                  {updateRunning ? '脚本运行中' : '运行更新脚本'}
                </button>
              </div>
            </div>

            {updateProgress || actionMessage ? (
              <div
                className={`dividend-ranking-progress ${updateProgress?.stage ? `is-${updateProgress.stage}` : ''}`}
              >
                <span>{updateRunning ? <span className="search-loader" /> : null}</span>
                <p>
                  {updateRunning
                    ? updateProgress?.message || dataState.progressMessage || '更新脚本正在运行…'
                    : actionMessage || updateProgress?.message}
                </p>
              </div>
            ) : null}

            {viewMode !== 'changes' ? (
              <div className="dividend-ranking-filters">
                <div className="dividend-ranking-toolbar">
                  <label className="dividend-ranking-search">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索股票名称或代码"
                      aria-label="搜索分红融资榜"
                      autoFocus
                    />
                    {query ? (
                      <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                        <X size={14} />
                      </button>
                    ) : null}
                  </label>
                  <label>
                    比例
                    <select
                      value={threshold}
                      onChange={(event) => setThreshold(Number(event.target.value))}
                    >
                      <option value={100}>100% 以上</option>
                      <option value={200}>200% 以上</option>
                      <option value={500}>500% 以上</option>
                      <option value={1000}>1000% 以上</option>
                    </select>
                  </label>
                  <label>
                    市场
                    <select
                      value={market}
                      onChange={(event) => setMarket(event.target.value as MarketFilter)}
                    >
                      <option value="ALL">全部市场</option>
                      <option value="SH">沪市</option>
                      <option value="SZ">深市</option>
                      <option value="BJ">北交所</option>
                    </select>
                  </label>
                  <label className="dividend-ranking-watchlist-filter">
                    <input
                      type="checkbox"
                      checked={onlyWatchlist}
                      onChange={(event) => setOnlyWatchlist(event.target.checked)}
                    />
                    仅看自选
                  </label>
                  <span className="dividend-ranking-result-count">
                    当前 {filteredRows.length} 只
                  </span>
                </div>
                <div className="dividend-ranking-deep-filters">
                  <span>深度条件</span>
                  <label>
                    净回报 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minNetReturn}
                      onChange={(event) => setMinNetReturn(Number(event.target.value))}
                    />{' '}
                    亿
                  </label>
                  <label>
                    累计分红 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minDividend}
                      onChange={(event) => setMinDividend(Number(event.target.value))}
                    />{' '}
                    亿
                  </label>
                  <label>
                    股息率 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={minDividendYield}
                      onChange={(event) => setMinDividendYield(Number(event.target.value))}
                    />{' '}
                    %
                  </label>
                  <label title="适当提高此值可排除小融资分母造成的极端比例">
                    累计融资 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minFinancing}
                      onChange={(event) => setMinFinancing(Number(event.target.value))}
                    />{' '}
                    亿
                  </label>
                  <label>
                    连续分红 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minConsecutiveYears}
                      onChange={(event) => setMinConsecutiveYears(Number(event.target.value))}
                    />{' '}
                    年
                  </label>
                  <label>
                    质量评分 ≥{' '}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={minQualityScore}
                      onChange={(event) => setMinQualityScore(Number(event.target.value))}
                    />{' '}
                    分
                  </label>
                </div>
              </div>
            ) : null}

            {viewMode === 'changes' ? <ChangeReportPanel report={changeReport} /> : null}
            {viewMode === 'visualization' ? (
              <VisualizationPanel
                rows={filteredRows}
                watchlistByCode={watchlistByCode}
                trackingProfiles={trackingProfiles}
                snapshotDate={snapshot?.snapshotDate}
                addingCode={addingCode}
                onAdd={(item) => void addStock(item)}
                onView={onViewStock}
              />
            ) : null}
            {viewMode === 'ranking' ? (
              <>
                <div className="dividend-ranking-table-scroller">
                  <table className="dividend-ranking-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" onClick={() => changeSort('rank')}>
                            排名{sortIndicator('rank')}
                          </button>
                        </th>
                        <th>股票</th>
                        <th>
                          <button type="button" onClick={() => changeSort('dividendYi')}>
                            累计分红{sortIndicator('dividendYi')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('financingYi')}>
                            累计融资{sortIndicator('financingYi')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('netReturnYi')}>
                            净回报额{sortIndicator('netReturnYi')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('ratio')}>
                            分红融资比{sortIndicator('ratio')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('dividendYield')}>
                            股息率{sortIndicator('dividendYield')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('recent5YearDividendYi')}>
                            近5年分红{sortIndicator('recent5YearDividendYi')}
                          </button>
                        </th>
                        <th>
                          <button
                            type="button"
                            onClick={() => changeSort('consecutiveDividendYears')}
                          >
                            连续分红{sortIndicator('consecutiveDividendYears')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('qualityScore')}>
                            质量评分{sortIndicator('qualityScore')}
                          </button>
                        </th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((item) => (
                        <tr key={item.code}>
                          <td className="dividend-ranking-rank">{item.rank}</td>
                          <td>
                            <div className="dividend-ranking-stock">
                              <strong>{item.name}</strong>
                              <span>
                                {item.code}
                                <em>{MARKET_LABELS[item.market]}</em>
                              </span>
                            </div>
                          </td>
                          <td className="dividend-ranking-number">
                            {formatAmount(item.dividendYi)}
                            <small>亿元</small>
                          </td>
                          <td className="dividend-ranking-number">
                            {formatAmount(item.financingYi)}
                            <small>亿元</small>
                          </td>
                          <td
                            className={`dividend-ranking-number dividend-return-value ${signedClass(netReturn(item))}`}
                          >
                            {formatAmount(netReturn(item))}
                            <small>亿元</small>
                          </td>
                          <td>
                            <strong className={`dividend-ranking-ratio ${ratioTier(item.ratio)}`}>
                              {item.ratio.toFixed(2)}%
                            </strong>
                          </td>
                          <td
                            className={`dividend-ranking-number ${
                              item.dividendYield === null || item.dividendYield === undefined
                                ? ''
                                : signedClass(item.dividendYield)
                            }`}
                          >
                            {item.dividendYield === null || item.dividendYield === undefined
                              ? '--'
                              : item.dividendYield.toFixed(2)}
                            <small>
                              {item.dividendYield === null || item.dividendYield === undefined
                                ? ''
                                : `% · ${item.lastDividendYear ?? '--'}年`}
                            </small>
                          </td>
                          <td className="dividend-ranking-number">
                            {item.recent5YearDividendYi === undefined
                              ? '--'
                              : formatAmount(item.recent5YearDividendYi)}
                            <small>{item.recent5YearDividendYi === undefined ? '' : '亿元'}</small>
                          </td>
                          <td className="dividend-ranking-number">
                            {item.consecutiveDividendYears ?? '--'}
                            <small>{item.consecutiveDividendYears === undefined ? '' : '年'}</small>
                          </td>
                          <td>
                            {item.qualityScoreBreakdown ? (
                              <details className="dividend-quality-score">
                                <summary>
                                  <strong>{item.qualityScore?.toFixed(1)}</strong>
                                  <span>第 {item.scoreRank} 名</span>
                                </summary>
                                <div>
                                  {scorePartRows(item.qualityScoreBreakdown).map(
                                    ([label, value, maximum]) => (
                                      <p key={label}>
                                        <span>{label}</span>
                                        <strong>
                                          {value.toFixed(1)} / {maximum}
                                        </strong>
                                      </p>
                                    )
                                  )}
                                </div>
                              </details>
                            ) : (
                              '--'
                            )}
                          </td>
                          <td>
                            <StockAction
                              item={item}
                              watchedStock={watchlistByCode.get(item.code)}
                              tracking={
                                trackingProfiles[watchlistByCode.get(item.code)?.quoteId ?? '']
                                  ?.status === 'tracking'
                              }
                              sourceRecorded={
                                trackingProfiles[
                                  watchlistByCode.get(item.code)?.quoteId ?? ''
                                ]?.sources.some(
                                  (source) =>
                                    source.type === 'dividendFinancing' &&
                                    source.detail?.snapshotDate === snapshot?.snapshotDate
                                ) ?? false
                              }
                              addingCode={addingCode}
                              onAdd={(stock) => void addStock(stock)}
                              onView={onViewStock}
                            />
                          </td>
                        </tr>
                      ))}
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td className="dividend-ranking-empty" colSpan={11}>
                            当前筛选条件下没有股票
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <footer className="dividend-ranking-footer">
                  <span>数据源：同花顺F10、东方财富F10 · 快照数据不随实时行情自动更新</span>
                  <div>
                    <span>
                      {filteredRows.length === 0
                        ? '0 条'
                        : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filteredRows.length)} / ${filteredRows.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={currentPage === 1}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <strong>
                      {currentPage} / {pageCount}
                    </strong>
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                      disabled={currentPage === pageCount}
                      aria-label="下一页"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </footer>
              </>
            ) : null}
          </>
        )}
      </section>
    </div>,
    document.body
  )
}
