import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleX,
  Database,
  Eye,
  Filter,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockMarketIdentity } from '../shared/stock-market'
import {
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  FUNDAMENTAL_QUALITY_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_SEVERITY,
  evaluateFundamentalQuality,
  evaluateFundamentalRisk,
  screenFundamentalCompanies,
  type FundamentalCashFlowMode,
  type FundamentalQualityTag,
  type FundamentalRiskTag,
  type FundamentalRoeMetric,
  type FundamentalScreeningCriteria,
  type FundamentalScreeningEvaluation
} from '../lib/fundamental-screening'
import { isDesktopRuntime, stockApi } from '../lib/api'
import type {
  DataSnapshotRuntimeState,
  FundamentalChangeItem,
  FundamentalChangeReport,
  FundamentalChangeRuleStatus,
  FundamentalChangeScreeningStatus,
  FundamentalChangeType,
  FundamentalCompany,
  FundamentalSnapshot,
  SearchResult,
  StockTrackingProfiles,
  WatchStock
} from '../shared/types'
import { useConfirmDialog } from './ConfirmDialog'

const PAGE_SIZE = 50
const MARKET_LABELS = {
  SH: '沪A',
  SZ: '深A',
  BJ: '北A'
} as const

type FundamentalSortKey = 'minimumRoe' | 'cashConversion' | 'debtPercentile' | 'code'
type FundamentalViewMode = 'screening' | 'changes'

const FUNDAMENTAL_QUALITY_TAGS: FundamentalQualityTag[] = [
  'strictFundamental',
  'cashSustained',
  'profitGrowth',
  'roeStable',
  'deductedSolid',
  'improving'
]

const FUNDAMENTAL_QUALITY_TAG_DESCRIPTIONS: Record<FundamentalQualityTag, string> = {
  strictFundamental: '默认三项通过，且五年扣非加权ROE每年严格大于15%',
  cashSustained: '默认三项通过，且五年每年经营现金流都严格大于净利润',
  profitGrowth: '默认三项通过，且五年净利润复合增速严格大于10%',
  roeStable: '默认三项通过，且五年加权ROE波动范围严格小于8个百分点',
  deductedSolid: '默认三项通过，且五年累计扣非利润占比严格大于90%',
  improving: '最近三年ROE与净利润连续增长，且最新现金转换率严格大于100%'
}

const FUNDAMENTAL_RISK_TAGS: FundamentalRiskTag[] = [
  'cashDivergence',
  'highLeverageRoe',
  'deductedWeak',
  'profitCashDivergence',
  'roeDecline',
  'singleYearCashWeak'
]

const FUNDAMENTAL_RISK_TAG_DESCRIPTIONS: Record<FundamentalRiskTag, string> = {
  cashDivergence: '五年高ROE，但五年累计现金转换率严格低于80%',
  highLeverageRoe: '五年高ROE，但行业负债百分位大于等于80%',
  deductedWeak: '五年加权ROE达标，但扣非ROE至少一年不高于15%',
  profitCashDivergence: '最近三年利润连续增长、现金流连续下降，且最新现金转换率低于100%',
  roeDecline: '五年ROE仍达标，但最新ROE较五年前下降至少5个百分点',
  singleYearCashWeak: '五年累计现金转换率高于100%，但最新一年低于100%'
}

interface FundamentalScreeningDialogProps {
  open: boolean
  cachedSnapshot: FundamentalSnapshot | null
  cachedChangeReport: FundamentalChangeReport | null
  dataState: DataSnapshotRuntimeState
  watchlist: WatchStock[]
  trackingProfiles: StockTrackingProfiles
  onAddStock: (
    stock: SearchResult,
    evaluation: FundamentalScreeningEvaluation,
    snapshotDate: string | undefined
  ) => void
  onViewStock: (quoteId: string) => void
  onSnapshotChange: (snapshot: FundamentalSnapshot) => void
  onChangeReportChange: (report: FundamentalChangeReport | null) => void
  onClose: () => void
}

const CHANGE_TYPE_LABELS: Record<FundamentalChangeType, string> = {
  addedCoverage: '纳入',
  removedCoverage: '退出',
  entered: '入选',
  exited: '移出',
  reviewAdded: '待核',
  reviewResolved: '修复',
  dataCompleted: '补齐',
  dataMissing: '缺失',
  organizationChanged: '口径'
}

const SCREENING_STATUS_LABELS: Record<FundamentalChangeScreeningStatus, string> = {
  passed: '基本',
  review: '待核',
  missing: '缺数',
  financial: '金融',
  unavailable: '无数据'
}

const RULE_STATUS_LABELS: Record<FundamentalChangeRuleStatus, string> = {
  passed: '达标',
  failed: '未过',
  missing: '缺数',
  'not-applicable': '免评'
}

const RULE_LABELS = {
  roe: 'ROE',
  cash: '现金',
  debt: '负债'
} as const

function directionClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatPercent(value: number | null, digits = 2): string {
  return value === null
    ? '--'
    : `${value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      })}%`
}

function formatYi(value: number | null): string {
  return value === null
    ? '--'
    : `${(value / 100_000_000).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })} 亿`
}

function formatGeneratedAt(value: string | null): string {
  if (!value) return '尚未生成'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function hasRecentThreeYearWeightedRoeGrowth(company: FundamentalCompany): boolean {
  const recentRoe = company.annualReports.slice(-3).map((report) => report.weightedAverageRoe)
  return (
    recentRoe.length === 3 &&
    recentRoe.every((value): value is number => value !== null) &&
    recentRoe[0] < recentRoe[1] &&
    recentRoe[1] < recentRoe[2]
  )
}

function evaluationSortValue(
  evaluation: FundamentalScreeningEvaluation,
  sortKey: FundamentalSortKey
): number | string {
  if (sortKey === 'minimumRoe') return evaluation.minimumRoe ?? Number.NEGATIVE_INFINITY
  if (sortKey === 'cashConversion') {
    return evaluation.selectedCashConversion ?? Number.NEGATIVE_INFINITY
  }
  if (sortKey === 'debtPercentile') {
    return evaluation.company.latestBalanceSheet.industryPercentile ?? Number.POSITIVE_INFINITY
  }
  return evaluation.company.code
}

function StockAction({
  company,
  watchedStock,
  tracking,
  sourceRecorded,
  onAdd,
  onView
}: {
  company: FundamentalCompany
  watchedStock?: WatchStock
  tracking: boolean
  sourceRecorded: boolean
  onAdd: (company: FundamentalCompany) => void
  onView: (quoteId: string) => void
}) {
  return watchedStock && tracking && sourceRecorded ? (
    <button
      className="secondary-button fundamental-row-action"
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onView(watchedStock.quoteId)
      }}
    >
      <Eye size={14} />
      查看自选
    </button>
  ) : (
    <button
      className="secondary-button fundamental-row-action"
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onAdd(company)
      }}
    >
      <Plus size={14} />
      {watchedStock && tracking ? '记录来源' : watchedStock ? '开始追踪' : '加入并追踪'}
    </button>
  )
}

function CheckBadge({ passed, children }: { passed: boolean; children: string }) {
  return (
    <span className={`fundamental-check-badge ${passed ? 'is-passed' : 'is-failed'}`}>
      {passed ? <CircleCheck size={13} /> : <CircleX size={13} />}
      {children}
    </span>
  )
}

function CompanyDetails({
  evaluation,
  criteria
}: {
  evaluation: FundamentalScreeningEvaluation
  criteria: FundamentalScreeningCriteria
}) {
  const { company } = evaluation
  return (
    <div className="fundamental-company-details">
      <div className="fundamental-detail-conclusion">
        <div>
          <strong>筛选结论</strong>
          <span>
            {evaluation.passed
              ? '三项基本面条件全部通过，可进入下一步研究。'
              : evaluation.eligibleOrganization
                ? `通过 ${evaluation.passedRuleCount}/3 项条件，未通过项目不代表公司没有投资价值。`
                : '金融企业的资产负债结构不可与普通企业直接比较，首版不参与入选。'}
          </span>
        </div>
        <div className="fundamental-detail-checks">
          <CheckBadge passed={evaluation.checks.roe}>持续高 ROE</CheckBadge>
          <CheckBadge passed={evaluation.checks.cash}>现金利润质量</CheckBadge>
          <CheckBadge passed={evaluation.checks.debt}>行业杠杆水平</CheckBadge>
        </div>
      </div>

      <div className="fundamental-detail-metrics">
        <span>
          <small>五年最低{criteria.roeMetric === 'weighted' ? '加权' : '扣非'} ROE</small>
          <strong className={directionClass(evaluation.minimumRoe)}>
            {formatPercent(evaluation.minimumRoe)}
          </strong>
        </span>
        <span>
          <small>五年累计现金转换率</small>
          <strong className={directionClass(evaluation.cumulativeCashConversion)}>
            {formatPercent(evaluation.cumulativeCashConversion)}
          </strong>
        </span>
        <span>
          <small>最新一年现金转换率</small>
          <strong className={directionClass(evaluation.latestCashConversion)}>
            {formatPercent(evaluation.latestCashConversion)}
          </strong>
        </span>
        <span>
          <small>资产负债率 / 行业 P60</small>
          <strong>
            {formatPercent(company.latestBalanceSheet.debtAssetRatio)} /{' '}
            {formatPercent(evaluation.industryBenchmark?.debtAssetRatioP60 ?? null)}
          </strong>
        </span>
        <span>
          <small>行业负债百分位</small>
          <strong>{formatPercent(company.latestBalanceSheet.industryPercentile, 1)}</strong>
        </span>
      </div>

      <div className="fundamental-annual-table-wrap">
        <table className="fundamental-annual-table">
          <thead>
            <tr>
              <th>财年</th>
              <th>加权 ROE</th>
              <th>扣非 ROE</th>
              <th>净利润</th>
              <th>经营现金流</th>
              <th>现金转换率</th>
            </tr>
          </thead>
          <tbody>
            {company.annualReports.map((report) => {
              const conversion =
                report.netProfit !== null &&
                report.netProfit > 0 &&
                report.operatingCashFlow !== null
                  ? (report.operatingCashFlow / report.netProfit) * 100
                  : null
              return (
                <tr key={report.year}>
                  <td>{report.year}</td>
                  <td className={directionClass(report.weightedAverageRoe)}>
                    {formatPercent(report.weightedAverageRoe)}
                  </td>
                  <td className={directionClass(report.deductedWeightedAverageRoe)}>
                    {formatPercent(report.deductedWeightedAverageRoe)}
                  </td>
                  <td className={directionClass(report.netProfit)}>{formatYi(report.netProfit)}</td>
                  <td className={directionClass(report.operatingCashFlow)}>
                    {formatYi(report.operatingCashFlow)}
                  </td>
                  <td className={directionClass(conversion)}>{formatPercent(conversion)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChangeMetricTransition({
  previous,
  current,
  signed = false
}: {
  previous: number | null
  current: number | null
  signed?: boolean
}) {
  return (
    <span className="fundamental-change-metric">
      <span className={signed ? directionClass(previous) : undefined}>
        {formatPercent(previous)}
      </span>
      <span aria-hidden="true">→</span>
      <span className={signed ? directionClass(current) : undefined}>{formatPercent(current)}</span>
    </span>
  )
}

function FundamentalChangeReportPanel({
  report,
  rows,
  onlyWatchlist,
  watchlistByCode,
  onOnlyWatchlistChange,
  onViewStock
}: {
  report: FundamentalChangeReport | null
  rows: FundamentalChangeItem[]
  onlyWatchlist: boolean
  watchlistByCode: ReadonlyMap<string, WatchStock>
  onOnlyWatchlistChange: (value: boolean) => void
  onViewStock: (quoteId: string) => void
}) {
  if (!report) {
    return (
      <div className="fundamental-change-empty">
        <Database size={30} />
        <strong>还没有可比较的基本面更新</strong>
        <span>首次快照不会生成“全部新增”报告；下一次更新后才会比较筛选结论。</span>
      </div>
    )
  }

  const previousYears = `${report.previousFiscalYears[0]}—${report.previousFiscalYears.at(-1)}`
  const currentYears = `${report.currentFiscalYears[0]}—${report.currentFiscalYears.at(-1)}`
  const organizationLabels: Record<
    NonNullable<FundamentalChangeItem['previousOrganizationType']>,
    string
  > = {
    general: '普通',
    bank: '银行',
    securities: '证券',
    insurance: '保险',
    other: '其他'
  }

  return (
    <div className="fundamental-change-panel">
      <div className="fundamental-change-heading">
        <div>
          <strong>{report.previousSnapshotDate}</strong>
          <span aria-hidden="true"> → </span>
          <strong>{report.currentSnapshotDate}</strong>
          <small>
            财年窗口 {previousYears} → {currentYears}
          </small>
        </div>
        <span>固定按推荐规则比较，只列出改变筛选结论的股票</span>
      </div>

      <div className="fundamental-change-summary">
        <div className="is-positive">
          <span>新入选</span>
          <strong>{report.summary.enteredCount}</strong>
        </div>
        <div className="is-risk">
          <span>移出</span>
          <strong>{report.summary.exitedCount}</strong>
        </div>
        <div className="is-risk">
          <span>新增待核</span>
          <strong>{report.summary.reviewAddedCount}</strong>
        </div>
        <div className="is-positive">
          <span>已修复</span>
          <strong>{report.summary.reviewResolvedCount}</strong>
        </div>
        <div>
          <span>数据变化</span>
          <strong>{report.summary.dataChangedCount}</strong>
        </div>
      </div>

      <div className="fundamental-change-toolbar">
        <span>
          共 {report.rows.length.toLocaleString('zh-CN')} 家发生结论变化
          {report.summary.addedCoverageCount || report.summary.removedCoverageCount
            ? ` · 覆盖纳入 ${report.summary.addedCoverageCount} / 退出 ${report.summary.removedCoverageCount}`
            : ''}
          {report.summary.organizationChangedCount
            ? ` · 企业口径变化 ${report.summary.organizationChangedCount}`
            : ''}
        </span>
        <label>
          <input
            type="checkbox"
            checked={onlyWatchlist}
            onChange={(event) => onOnlyWatchlistChange(event.target.checked)}
          />
          仅看自选
        </label>
      </div>

      <div className="fundamental-change-table-wrap">
        <table className="fundamental-change-table">
          <thead>
            <tr>
              <th>股票</th>
              <th>变化类型</th>
              <th>原状态 → 新状态</th>
              <th>规则变化</th>
              <th>五年最低 ROE</th>
              <th>五年现金转换率</th>
              <th>行业负债分位</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((item) => {
                const watchedStock = watchlistByCode.get(item.code)
                const organizationChanged =
                  item.changeTypes.includes('organizationChanged') &&
                  item.previousOrganizationType &&
                  item.currentOrganizationType
                return (
                  <tr key={item.code}>
                    <td>
                      <span className="fundamental-stock-cell">
                        <strong>{item.name}</strong>
                        <small>
                          {item.code} · {MARKET_LABELS[item.market]} · {item.industryName || '--'}
                        </small>
                      </span>
                    </td>
                    <td>
                      <span className="fundamental-change-tags">
                        {item.changeTypes.map((type) => (
                          <span className={`is-${type}`} key={type}>
                            {CHANGE_TYPE_LABELS[type]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="fundamental-change-status-flow">
                        <span className={`is-${item.previousStatus}`}>
                          {SCREENING_STATUS_LABELS[item.previousStatus]}
                        </span>
                        <span aria-hidden="true">→</span>
                        <span className={`is-${item.currentStatus}`}>
                          {SCREENING_STATUS_LABELS[item.currentStatus]}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="fundamental-rule-change-list">
                        {item.ruleChanges.map((change) => (
                          <span key={change.rule}>
                            <strong>{RULE_LABELS[change.rule]}</strong>
                            {RULE_STATUS_LABELS[change.previousStatus]} →{' '}
                            {RULE_STATUS_LABELS[change.currentStatus]}
                          </span>
                        ))}
                        {organizationChanged ? (
                          <span>
                            <strong>口径</strong>
                            {organizationLabels[item.previousOrganizationType!]} →{' '}
                            {organizationLabels[item.currentOrganizationType!]}
                          </span>
                        ) : null}
                        {item.ruleChanges.length === 0 && !organizationChanged ? '--' : null}
                      </span>
                    </td>
                    <td>
                      <ChangeMetricTransition
                        previous={item.previousMetrics?.minimumRoe ?? null}
                        current={item.currentMetrics?.minimumRoe ?? null}
                        signed
                      />
                    </td>
                    <td>
                      <ChangeMetricTransition
                        previous={item.previousMetrics?.cumulativeCashConversion ?? null}
                        current={item.currentMetrics?.cumulativeCashConversion ?? null}
                        signed
                      />
                    </td>
                    <td>
                      <ChangeMetricTransition
                        previous={item.previousMetrics?.debtIndustryPercentile ?? null}
                        current={item.currentMetrics?.debtIndustryPercentile ?? null}
                      />
                    </td>
                    <td>
                      {watchedStock ? (
                        <button
                          className="secondary-button fundamental-row-action"
                          type="button"
                          onClick={() => onViewStock(watchedStock.quoteId)}
                        >
                          <Eye size={14} />
                          查看自选
                        </button>
                      ) : (
                        <span className="fundamental-change-no-action">--</span>
                      )}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td className="fundamental-empty-result" colSpan={8}>
                  {onlyWatchlist
                    ? '自选股中没有筛选结论发生变化的公司。'
                    : '本次更新没有公司的默认筛选结论发生变化。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FundamentalScreeningDialog({
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
}: FundamentalScreeningDialogProps) {
  const confirm = useConfirmDialog()
  const [snapshot, setSnapshot] = useState<FundamentalSnapshot | null>(cachedSnapshot)
  const [changeReport, setChangeReport] = useState<FundamentalChangeReport | null>(
    cachedChangeReport
  )
  const [viewMode, setViewMode] = useState<FundamentalViewMode>('screening')
  const [onlyWatchlistChanges, setOnlyWatchlistChanges] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [criteria, setCriteria] = useState<FundamentalScreeningCriteria>(
    DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
  )
  const [query, setQuery] = useState('')
  const [onlyPassed, setOnlyPassed] = useState(true)
  const [onlyRecentRoeGrowth, setOnlyRecentRoeGrowth] = useState(false)
  const [qualityTags, setQualityTags] = useState<FundamentalQualityTag[]>([])
  const [riskTags, setRiskTags] = useState<FundamentalRiskTag[]>([])
  const [sortKey, setSortKey] = useState<FundamentalSortKey>('minimumRoe')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [expandedCode, setExpandedCode] = useState('')
  const [updating, setUpdating] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

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
    Promise.all([stockApi.getFundamentalSnapshot(), stockApi.getFundamentalChangeReport()])
      .then(([data, changes]) => {
        if (!active) return
        setSnapshot(data)
        setChangeReport(changes)
        if (data) onSnapshotChange(data)
        onChangeReportChange(changes)
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadError(reason instanceof Error ? reason.message : '基本面财务数据读取失败')
        }
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
      if (event.key === 'Escape' && !document.querySelector('.confirm-dialog-backdrop')) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  useEffect(() => {
    setPage(1)
    setExpandedCode('')
  }, [
    criteria,
    onlyPassed,
    onlyRecentRoeGrowth,
    qualityTags,
    query,
    riskTags,
    sortDirection,
    sortKey
  ])

  const evaluations = useMemo(
    () => (snapshot ? screenFundamentalCompanies(snapshot, criteria) : []),
    [criteria, snapshot]
  )
  const generalEvaluations = useMemo(
    () => evaluations.filter((evaluation) => evaluation.eligibleOrganization),
    [evaluations]
  )
  const summary = useMemo(
    () => ({
      passed: generalEvaluations.filter((evaluation) => evaluation.passed).length,
      roe: generalEvaluations.filter((evaluation) => evaluation.checks.roe).length,
      cash: generalEvaluations.filter((evaluation) => evaluation.checks.cash).length,
      debt: generalEvaluations.filter((evaluation) => evaluation.checks.debt).length
    }),
    [generalEvaluations]
  )
  const qualityProfilesByCode = useMemo(
    () =>
      new Map(
        snapshot?.rows.map((company) => [company.code, evaluateFundamentalQuality(company)]) ?? []
      ),
    [snapshot]
  )
  const qualityTagCounts = useMemo(() => {
    const counts: Record<FundamentalQualityTag, number> = {
      strictFundamental: 0,
      cashSustained: 0,
      profitGrowth: 0,
      roeStable: 0,
      deductedSolid: 0,
      improving: 0
    }
    qualityProfilesByCode.forEach((profile) => {
      profile.tags.forEach((tag) => {
        counts[tag] += 1
      })
    })
    return counts
  }, [qualityProfilesByCode])
  const riskProfilesByCode = useMemo(
    () =>
      new Map(
        snapshot?.rows.map((company) => [company.code, evaluateFundamentalRisk(company)]) ?? []
      ),
    [snapshot]
  )
  const riskTagCounts = useMemo(() => {
    const counts: Record<FundamentalRiskTag, number> = {
      cashDivergence: 0,
      highLeverageRoe: 0,
      deductedWeak: 0,
      profitCashDivergence: 0,
      roeDecline: 0,
      singleYearCashWeak: 0
    }
    riskProfilesByCode.forEach((profile) => {
      profile.tags.forEach((tag) => {
        counts[tag] += 1
      })
    })
    return counts
  }, [riskProfilesByCode])
  const normalizedQuery = query.trim().replaceAll(' ', '').toLowerCase()
  const filteredEvaluations = useMemo(() => {
    const rows = evaluations.filter((evaluation) => {
      if (onlyPassed && !evaluation.passed) return false
      if (onlyRecentRoeGrowth && !hasRecentThreeYearWeightedRoeGrowth(evaluation.company)) {
        return false
      }
      const qualityProfile = qualityProfilesByCode.get(evaluation.company.code)
      if (qualityTags.some((tag) => !qualityProfile?.tags.includes(tag))) return false
      const riskProfile = riskProfilesByCode.get(evaluation.company.code)
      if (riskTags.some((tag) => !riskProfile?.tags.includes(tag))) return false
      if (!normalizedQuery) return true
      const company = evaluation.company
      return `${company.code}${company.name}${company.industryName}`
        .replaceAll(' ', '')
        .toLowerCase()
        .includes(normalizedQuery)
    })
    return [...rows].sort((left, right) => {
      const leftValue = evaluationSortValue(left, sortKey)
      const rightValue = evaluationSortValue(right, sortKey)
      const compared =
        typeof leftValue === 'string' && typeof rightValue === 'string'
          ? leftValue.localeCompare(rightValue, 'zh-CN')
          : Number(leftValue) - Number(rightValue)
      return sortDirection === 'asc' ? compared : -compared
    })
  }, [
    evaluations,
    normalizedQuery,
    onlyPassed,
    onlyRecentRoeGrowth,
    qualityProfilesByCode,
    qualityTags,
    riskProfilesByCode,
    riskTags,
    sortDirection,
    sortKey
  ])
  const totalPages = Math.max(1, Math.ceil(filteredEvaluations.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredEvaluations.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const watchlistByQuoteId = useMemo(
    () => new Map(watchlist.map((stock) => [stock.quoteId, stock])),
    [watchlist]
  )
  const watchlistByCode = useMemo(
    () => new Map(watchlist.map((stock) => [stock.code, stock])),
    [watchlist]
  )
  const visibleChangeRows = useMemo(
    () =>
      changeReport?.rows.filter(
        (item) => !onlyWatchlistChanges || watchlistByCode.has(item.code)
      ) ?? [],
    [changeReport, onlyWatchlistChanges, watchlistByCode]
  )
  const updateRunning = updating || dataState.status === 'queued' || dataState.status === 'updating'

  const changeCriteria = <Key extends keyof FundamentalScreeningCriteria>(
    key: Key,
    value: FundamentalScreeningCriteria[Key]
  ) => setCriteria((current) => ({ ...current, [key]: value }))

  const toggleQualityTag = (tag: FundamentalQualityTag) => {
    setQualityTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    )
  }

  const toggleRiskTag = (tag: FundamentalRiskTag) => {
    setRiskTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    )
  }

  const changeSort = (nextKey: FundamentalSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(nextKey)
    setSortDirection(nextKey === 'debtPercentile' || nextKey === 'code' ? 'asc' : 'desc')
  }

  const sortIndicator = (key: FundamentalSortKey) => {
    if (key !== sortKey) return null
    return sortDirection === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
  }

  const addCompany = (evaluation: FundamentalScreeningEvaluation) => {
    const { company } = evaluation
    onAddStock(
      {
        code: company.code,
        name: company.name,
        quoteId: company.quoteId,
        marketLabel: MARKET_LABELS[company.market],
        ...stockMarketIdentity(company.quoteId)
      },
      evaluation,
      snapshot?.snapshotDate
    )
    setActionMessage(`${company.name}已开始追踪，并加入追踪分组`)
  }

  const runUpdate = async () => {
    const confirmed = await confirm({
      title: '更新基本面财务数据',
      message:
        '脚本将分三个阶段获取最近五个完整财年的财务数据，通常耗时较长。运行前会检查 Python 3 和 requests 环境。',
      confirmLabel: '开始更新'
    })
    if (!confirmed) return
    setUpdating(true)
    setActionMessage('')
    try {
      const result = await stockApi.runFundamentalUpdate()
      setSnapshot(result.snapshot)
      setChangeReport(result.changeReport)
      onSnapshotChange(result.snapshot)
      onChangeReportChange(result.changeReport)
      setActionMessage(`基本面数据已更新，共 ${result.snapshot.rows.length} 家公司`)
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : '基本面财务数据更新失败')
    } finally {
      setUpdating(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fundamental-screening-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fundamental-screening-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fundamental-screening-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="fundamental-screening-header">
          <div className="fundamental-screening-title-icon" aria-hidden="true">
            <Filter size={21} />
          </div>
          <div className="fundamental-screening-title">
            <h2 id="fundamental-screening-title">基本面初筛</h2>
            <span>
              {snapshot
                ? `${snapshot.fiscalYears[0]}—${snapshot.fiscalYears.at(-1)} 完整财年 · ${snapshot.rows.length.toLocaleString('zh-CN')} 家公司`
                : dataState.progressMessage || '尚无基本面财务快照'}
            </span>
          </div>
          {snapshot && viewMode === 'screening' ? (
            <div className="fundamental-screening-summary">
              <span>
                <small>满足全部条件</small>
                <strong>{summary.passed.toLocaleString('zh-CN')}</strong>
              </span>
              <span>
                <small>五年 ROE 通过</small>
                <strong>{summary.roe.toLocaleString('zh-CN')}</strong>
              </span>
              <span>
                <small>现金质量通过</small>
                <strong>{summary.cash.toLocaleString('zh-CN')}</strong>
              </span>
              <span>
                <small>行业杠杆通过</small>
                <strong>{summary.debt.toLocaleString('zh-CN')}</strong>
              </span>
              <span className="fundamental-screening-generated">
                <small>数据生成时间</small>
                <strong>{formatGeneratedAt(snapshot.generatedAt)}</strong>
              </span>
            </div>
          ) : null}
          <button
            className="icon-button fundamental-screening-close"
            type="button"
            onClick={onClose}
            aria-label="关闭基本面初筛"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        {loading && !snapshot ? (
          <div className="fundamental-screening-loading">
            <span className="search-loader" />
            正在读取基本面财务数据…
          </div>
        ) : !snapshot ? (
          <div className={`fundamental-screening-no-data is-${dataState.status}`}>
            {updateRunning ? <span className="search-loader" /> : <Database size={30} />}
            <strong>
              {updateRunning
                ? '正在首次获取基本面财务数据'
                : dataState.status === 'failed' || loadError
                  ? '基本面财务数据获取失败'
                  : '尚无基本面财务数据'}
            </strong>
            <p>
              {loadError ||
                dataState.error ||
                dataState.progressMessage ||
                '首次没有快照时软件会自动获取，也可以在这里重新运行。'}
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
            {dataState.status === 'stale' || dataState.status === 'failed' ? (
              <div className={`fundamental-screening-notice is-${dataState.status}`}>
                <span>
                  <strong>
                    {dataState.status === 'stale' ? '当前基本面数据已过期' : '最近一次更新失败'}
                  </strong>
                  <small>{dataState.staleReason || dataState.error}</small>
                </span>
                <button type="button" onClick={runUpdate} disabled={updateRunning}>
                  <RefreshCw size={14} className={updateRunning ? 'is-spinning' : ''} />
                  {updateRunning ? '更新中' : '立即更新'}
                </button>
              </div>
            ) : null}

            <div className="fundamental-screening-tabs">
              <div role="tablist" aria-label="基本面分析类型">
                <button
                  className={viewMode === 'screening' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'screening'}
                  onClick={() => setViewMode('screening')}
                >
                  当前筛选
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
              </div>
              <div className="fundamental-screening-tab-actions">
                {viewMode === 'screening' ? (
                  <div className="fundamental-screening-toolbar">
                    <label className="fundamental-screening-search">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索股票代码、名称或行业"
                        aria-label="搜索基本面公司"
                        autoFocus
                      />
                    </label>
                    <label className="fundamental-only-passed">
                      <input
                        type="checkbox"
                        checked={onlyPassed}
                        onChange={(event) => setOnlyPassed(event.target.checked)}
                      />
                      仅显示全部通过
                    </label>
                    <label className="fundamental-only-passed">
                      <input
                        type="checkbox"
                        checked={onlyRecentRoeGrowth}
                        onChange={(event) => setOnlyRecentRoeGrowth(event.target.checked)}
                      />
                      最近三年加权 ROE 持续增长
                    </label>
                    <span className="fundamental-result-count">
                      当前显示 {filteredEvaluations.length.toLocaleString('zh-CN')} 家
                    </span>
                  </div>
                ) : null}
                <button
                  className="secondary-button fundamental-screening-update"
                  type="button"
                  onClick={runUpdate}
                  disabled={!isDesktopRuntime || updateRunning}
                  title={isDesktopRuntime ? '手动更新基本面数据' : '仅桌面版支持运行更新脚本'}
                >
                  <RefreshCw size={14} className={updateRunning ? 'is-spinning' : ''} />
                  {updateRunning ? '数据更新中' : '更新数据'}
                </button>
              </div>
            </div>

            {actionMessage ? (
              <div className="fundamental-action-message">{actionMessage}</div>
            ) : null}

            {viewMode === 'screening' ? (
              <>
                <div className="fundamental-screening-rules">
                  <div className="fundamental-rule-heading">
                    <span>
                      <Building2 size={17} />
                      <strong>普通企业三项硬筛选</strong>
                      <small>（金融企业展示数据但不参与入选；筛选结果仅用于缩小研究范围。）</small>
                    </span>
                  </div>
                  <div className="fundamental-rule-controls">
                    <label>
                      <span>ROE 口径</span>
                      <select
                        value={criteria.roeMetric}
                        onChange={(event) =>
                          changeCriteria('roeMetric', event.target.value as FundamentalRoeMetric)
                        }
                      >
                        <option value="weighted">加权平均 ROE</option>
                        <option value="deducted">扣非加权 ROE</option>
                      </select>
                    </label>
                    <label>
                      <span>连续五年每年高于</span>
                      <span className="fundamental-number-field">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={criteria.roeThreshold}
                          onChange={(event) =>
                            changeCriteria('roeThreshold', Number(event.target.value))
                          }
                        />
                        <em>%</em>
                      </span>
                    </label>
                    <label>
                      <span>现金利润质量</span>
                      <select
                        value={criteria.cashFlowMode}
                        onChange={(event) =>
                          changeCriteria(
                            'cashFlowMode',
                            event.target.value as FundamentalCashFlowMode
                          )
                        }
                      >
                        <option value="cumulative">五年累计现金转换率 &gt; 100%</option>
                        <option value="latest">最新一年现金转换率 &gt; 100%</option>
                      </select>
                    </label>
                    <label>
                      <span>负债率低于行业分位</span>
                      <span className="fundamental-number-field">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          step="5"
                          value={criteria.debtIndustryPercentile}
                          onChange={(event) =>
                            changeCriteria('debtIndustryPercentile', Number(event.target.value))
                          }
                        />
                        <em>%</em>
                      </span>
                    </label>
                    <button
                      className="secondary-button fundamental-reset-rules"
                      type="button"
                      onClick={() => setCriteria(DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA)}
                    >
                      <RotateCcw size={14} />
                      恢复推荐条件
                    </button>
                  </div>
                </div>

                <div className="fundamental-quality-filters">
                  <div className="fundamental-quality-filter-heading">
                    <span>
                      <Sparkles size={16} />
                      <strong>质量标签</strong>
                    </span>
                    <small>数字为全市场固定口径；多选需同时满足，当前结果仍受其他条件约束。</small>
                  </div>
                  <div className="fundamental-quality-filter-options">
                    {FUNDAMENTAL_QUALITY_TAGS.map((tag) => {
                      const selected = qualityTags.includes(tag)
                      return (
                        <button
                          className={`${selected ? 'is-active' : ''} ${tag === 'improving' ? 'is-improving' : ''}`}
                          type="button"
                          aria-pressed={selected}
                          title={FUNDAMENTAL_QUALITY_TAG_DESCRIPTIONS[tag]}
                          onClick={() => toggleQualityTag(tag)}
                          key={tag}
                        >
                          <span>{FUNDAMENTAL_QUALITY_TAG_LABELS[tag]}</span>
                          <strong>{qualityTagCounts[tag].toLocaleString('zh-CN')}</strong>
                        </button>
                      )
                    })}
                    {qualityTags.length > 0 ? (
                      <button
                        className="fundamental-quality-filter-clear"
                        type="button"
                        onClick={() => setQualityTags([])}
                      >
                        清除标签
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="fundamental-risk-filters">
                  <div className="fundamental-risk-filter-heading">
                    <span>
                      <AlertCircle size={16} />
                      <strong>风险提示</strong>
                    </span>
                    <small>数字为全市场固定口径；多选需同时满足，红色风险优先核查。</small>
                  </div>
                  <div className="fundamental-risk-filter-options">
                    {FUNDAMENTAL_RISK_TAGS.map((tag) => {
                      const selected = riskTags.includes(tag)
                      return (
                        <button
                          className={`${selected ? 'is-active' : ''} is-${FUNDAMENTAL_RISK_TAG_SEVERITY[tag]}`}
                          type="button"
                          aria-pressed={selected}
                          title={FUNDAMENTAL_RISK_TAG_DESCRIPTIONS[tag]}
                          onClick={() => toggleRiskTag(tag)}
                          key={tag}
                        >
                          <span>{FUNDAMENTAL_RISK_TAG_LABELS[tag]}</span>
                          <strong>{riskTagCounts[tag].toLocaleString('zh-CN')}</strong>
                        </button>
                      )
                    })}
                    {riskTags.length > 0 ? (
                      <button
                        className="fundamental-risk-filter-clear"
                        type="button"
                        onClick={() => setRiskTags([])}
                      >
                        清除风险
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="fundamental-screening-table-wrap">
                  <table className="fundamental-screening-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" onClick={() => changeSort('code')}>
                            股票 {sortIndicator('code')}
                          </button>
                        </th>
                        <th>行业</th>
                        <th>
                          <button type="button" onClick={() => changeSort('minimumRoe')}>
                            五年最低 ROE {sortIndicator('minimumRoe')}
                          </button>
                        </th>
                        <th>
                          <button type="button" onClick={() => changeSort('cashConversion')}>
                            {criteria.cashFlowMode === 'cumulative'
                              ? '五年现金转换率'
                              : '当年现金转换率'}
                            {sortIndicator('cashConversion')}
                          </button>
                        </th>
                        <th>资产负债率 / 行业 P60</th>
                        <th>
                          <button type="button" onClick={() => changeSort('debtPercentile')}>
                            行业负债分位 {sortIndicator('debtPercentile')}
                          </button>
                        </th>
                        <th>筛选结果</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length > 0 ? (
                        pageRows.map((evaluation) => {
                          const company = evaluation.company
                          const expanded = expandedCode === company.code
                          const watchedStock = watchlistByQuoteId.get(company.quoteId)
                          return (
                            <Fragment key={company.quoteId}>
                              <tr
                                className={`${evaluation.passed ? 'is-passed' : ''} ${expanded ? 'is-expanded' : ''}`}
                                onClick={() =>
                                  setExpandedCode((current) =>
                                    current === company.code ? '' : company.code
                                  )
                                }
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setExpandedCode((current) =>
                                      current === company.code ? '' : company.code
                                    )
                                  }
                                }}
                              >
                                <td>
                                  <span className="fundamental-stock-cell">
                                    <strong>{company.name}</strong>
                                    <small>
                                      {company.code} · {MARKET_LABELS[company.market]}
                                    </small>
                                  </span>
                                </td>
                                <td>
                                  <span className="fundamental-industry-cell">
                                    <strong>{company.industryName || '--'}</strong>
                                    <small>
                                      {evaluation.eligibleOrganization
                                        ? `${evaluation.industryBenchmark?.sampleSize ?? 0} 家样本`
                                        : '金融企业不参与入选'}
                                    </small>
                                  </span>
                                </td>
                                <td className={directionClass(evaluation.minimumRoe)}>
                                  {formatPercent(evaluation.minimumRoe)}
                                </td>
                                <td className={directionClass(evaluation.selectedCashConversion)}>
                                  {formatPercent(evaluation.selectedCashConversion)}
                                </td>
                                <td>
                                  {formatPercent(company.latestBalanceSheet.debtAssetRatio)} /{' '}
                                  {formatPercent(
                                    evaluation.industryBenchmark?.debtAssetRatioP60 ?? null
                                  )}
                                </td>
                                <td>
                                  {formatPercent(company.latestBalanceSheet.industryPercentile, 1)}
                                </td>
                                <td>
                                  {evaluation.passed ? (
                                    <span className="fundamental-result is-passed">
                                      <CircleCheck size={14} />
                                      全部通过
                                    </span>
                                  ) : (
                                    <span className="fundamental-result">
                                      {evaluation.eligibleOrganization
                                        ? `${evaluation.passedRuleCount}/3 项通过`
                                        : '不参与入选'}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <span className="fundamental-row-actions">
                                    <StockAction
                                      company={company}
                                      watchedStock={watchedStock}
                                      tracking={
                                        trackingProfiles[company.quoteId]?.status === 'tracking'
                                      }
                                      sourceRecorded={
                                        trackingProfiles[company.quoteId]?.sources.some(
                                          (source) =>
                                            source.type === 'fundamentalScreening' &&
                                            source.detail?.snapshotDate === snapshot?.snapshotDate
                                        ) ?? false
                                      }
                                      onAdd={() => addCompany(evaluation)}
                                      onView={onViewStock}
                                    />
                                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                  </span>
                                </td>
                              </tr>
                              {expanded ? (
                                <tr className="fundamental-details-row">
                                  <td colSpan={8}>
                                    <CompanyDetails evaluation={evaluation} criteria={criteria} />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          )
                        })
                      ) : (
                        <tr>
                          <td className="fundamental-empty-result" colSpan={8}>
                            {qualityTags.length > 0 || riskTags.length > 0
                              ? '当前质量与风险标签组合下没有匹配公司，可减少标签或调整其他筛选条件。'
                              : '当前条件下没有匹配公司，可调整筛选规则或关闭“仅显示全部通过”。'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <footer className="fundamental-screening-footer">
                  <span>
                    第 {currentPage} / {totalPages} 页 · 每页 {PAGE_SIZE} 家
                  </span>
                  <div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={currentPage <= 1}
                    >
                      <ChevronLeft size={15} />
                      上一页
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      disabled={currentPage >= totalPages}
                    >
                      下一页
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <FundamentalChangeReportPanel
                report={changeReport}
                rows={visibleChangeRows}
                onlyWatchlist={onlyWatchlistChanges}
                watchlistByCode={watchlistByCode}
                onOnlyWatchlistChange={setOnlyWatchlistChanges}
                onViewStock={onViewStock}
              />
            )}
          </>
        )}
      </section>
    </div>,
    document.body
  )
}
