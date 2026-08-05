import { ArrowDown, ArrowUp, ChartPie, RotateCcw, ScanSearch } from 'lucide-react'
import type {
  FundamentalDividendFilter,
  FundamentalDividendWatchlistSummary,
  FundamentalWatchlistFilter,
  FundamentalWatchlistSummary
} from '../../lib/fundamental-screening'
import type { PortfolioQualitySummary } from '../../lib/portfolio-quality'

interface FundamentalWatchlistOverviewProps {
  summary: FundamentalWatchlistSummary
  valueSummary: FundamentalDividendWatchlistSummary | null
  portfolioQuality: PortfolioQualitySummary
  activeFilter: FundamentalWatchlistFilter
  activeValueFilter: FundamentalDividendFilter
  riskOnly: boolean
  valueDataReady: boolean
  valueDataStaleReason: string | null
  valueTagSortDirection: 'asc' | 'desc' | null
  filtersActive: boolean
  onOpenPortfolioQuality: () => void
  onFilterChange: (filter: FundamentalWatchlistFilter) => void
  onValueFilterChange: (filter: FundamentalDividendFilter) => void
  onRiskOnlyChange: (enabled: boolean) => void
  onValueTagSortToggle: () => void
  onResetFilters: () => void
}

const VALUE_FILTERS = [
  {
    id: 'dual',
    label: '双优',
    count: 'dual',
    description: '基本面硬筛选通过，并进入分红融资榜'
  },
  {
    id: 'fundamental',
    label: '仅基',
    count: 'fundamental',
    description: '基本面硬筛选通过，未进入分红融资榜'
  },
  {
    id: 'dividend',
    label: '仅分',
    count: 'dividend',
    description: '进入分红融资榜，基本面硬筛选未通过或不适用'
  },
  {
    id: 'unlabeled',
    label: '暂无',
    count: 'unlabeled',
    description: '当前没有基本面通过或分红融资榜标签，不代表公司一定较差'
  }
] as const

const STATUS_FILTERS = [
  { id: 'all', label: '全部', count: 'total', tone: 'all' },
  { id: 'passed', label: '基本', count: 'passed', tone: 'passed' },
  { id: 'review', label: '待核', count: 'review', tone: 'review' },
  { id: 'missing', label: '缺数', count: 'missing', tone: 'missing' },
  { id: 'financial', label: '金融', count: 'financial', tone: 'financial' },
  { id: 'unavailable', label: '无数据', count: 'unavailable', tone: 'unavailable' }
] as const

const RULE_FILTERS = [
  { id: 'roe', label: 'ROE', count: 'roe' },
  { id: 'cash', label: '现金', count: 'cash' },
  { id: 'debt', label: '杠杆', count: 'debt' }
] as const

export function FundamentalWatchlistOverview({
  summary,
  valueSummary,
  portfolioQuality,
  activeFilter,
  activeValueFilter,
  riskOnly,
  valueDataReady,
  valueDataStaleReason,
  valueTagSortDirection,
  filtersActive,
  onOpenPortfolioQuality,
  onFilterChange,
  onValueFilterChange,
  onRiskOnlyChange,
  onValueTagSortToggle,
  onResetFilters
}: FundamentalWatchlistOverviewProps) {
  const selectFilter = (filter: FundamentalWatchlistFilter) => {
    onFilterChange(activeFilter === filter ? 'all' : filter)
  }
  const selectValueFilter = (filter: FundamentalDividendFilter) => {
    onValueFilterChange(activeValueFilter === filter ? 'all' : filter)
  }
  const dualPercent = portfolioQuality.valueBuckets.dual.percent
  const riskPercent = portfolioQuality.totalMarketValue === null
    ? null
    : (portfolioQuality.riskBuckets.critical.percent ?? 0)
      + (portfolioQuality.riskBuckets.warning.percent ?? 0)
  const shareText = (value: number | null) => value === null ? '--' : `${value.toFixed(1)}%`

  return (
    <section className="fundamental-watchlist-overview" aria-label="当前列表价值与基本面概览">
      <div className="fundamental-overview-primary-row">
        <button
          className="portfolio-quality-trigger"
          type="button"
          disabled={portfolioQuality.positionCount === 0}
          onClick={onOpenPortfolioQuality}
          title={portfolioQuality.positionCount > 0 ? '查看全部持仓的质量与风险市值分布' : '当前没有持仓'}
        >
          <ChartPie size={18} />
          <span>
            <strong>持仓质量</strong>
            <small>
              {portfolioQuality.positionCount === 0
                ? '暂无持仓'
                : portfolioQuality.totalMarketValue === null
                  ? `${portfolioQuality.positionCount} 只 · 暂无计价`
                  : `双优 ${shareText(dualPercent)} · 风险 ${shareText(riskPercent)}`}
            </small>
          </span>
        </button>

        <div
          className={`fundamental-overview-values ${valueDataReady ? '' : 'is-pending'}`}
          title={valueDataReady
            ? valueDataStaleReason || '数量基于当前分组与板块，不受价值组合、基本面和风险筛选影响'
            : '基本面和分红融资两份快照均就绪后才计算价值组合'}
        >
          <span className="fundamental-overview-group-label">
            <strong>{valueDataReady ? '价值组合' : '价值待数'}</strong>
            <small>{valueDataStaleReason ? '快照过期' : '当前范围'}</small>
          </span>
          {VALUE_FILTERS.map((option) => {
            const count = valueSummary?.[option.count]
            const active = activeValueFilter === option.id
            return (
              <button
                className={`is-${option.id} ${active ? 'is-active' : ''}`}
                type="button"
                aria-pressed={active}
                disabled={!valueDataReady || (count === 0 && !active)}
                title={valueDataReady ? option.description : '价值组合数据尚未就绪'}
                onClick={() => selectValueFilter(option.id)}
                key={option.id}
              >
                <span>{option.label}</span>
                <strong>{count ?? '--'}</strong>
              </button>
            )
          })}
        </div>

        <div className="fundamental-overview-risk">
          <span>风险提示</span>
          <button
            className={riskOnly ? 'is-active' : ''}
            type="button"
            aria-pressed={riskOnly}
            disabled={summary.risk === 0 && !riskOnly}
            title="与价值组合和基本面状态组合，只看存在基本面风险提示的股票"
            onClick={() => onRiskOnlyChange(!riskOnly)}
          >
            <span>风险</span>
            <strong>{summary.risk}</strong>
          </button>
        </div>

        <button
          className={`fundamental-value-sort ${valueTagSortDirection ? 'is-active' : ''}`}
          type="button"
          disabled={!valueDataReady}
          onClick={onValueTagSortToggle}
          title={valueDataReady
            ? '依次切换：正面标签数量降序、升序、恢复手动排序'
            : '价值组合数据尚未就绪'}
        >
          {valueTagSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          标签数{valueTagSortDirection === 'desc' ? '↓' : valueTagSortDirection === 'asc' ? '↑' : ''}
        </button>

        <button
          className="fundamental-overview-reset"
          type="button"
          disabled={!filtersActive}
          onClick={onResetFilters}
        >
          <RotateCcw size={14} />
          重置筛选
        </button>
      </div>

      <div className="fundamental-overview-secondary-row">
        <div className="fundamental-overview-heading">
          <ScanSearch size={17} />
          <span>
            <strong>基本面概览</strong>
            <small>快照覆盖 {summary.covered} / {summary.total}</small>
          </span>
        </div>
        <div className="fundamental-overview-statuses" aria-label="按基本面状态筛选">
          {STATUS_FILTERS.map((option) => {
            const count = summary[option.count]
            const active = activeFilter === option.id
            return (
              <button
                className={`is-${option.tone} ${active ? 'is-active' : ''}`}
                type="button"
                aria-pressed={active}
                disabled={count === 0 && !active}
                title={`筛选${option.label}状态股票，可与价值组合和风险条件叠加`}
                onClick={() => selectFilter(option.id)}
                key={option.id}
              >
                <span>{option.label}</span>
                <strong>{count}</strong>
              </button>
            )
          })}
        </div>
        <div className="fundamental-overview-rules">
          <span>待核构成</span>
          {RULE_FILTERS.map((option) => {
            const count = summary[option.count]
            const active = activeFilter === option.id
            return (
              <button
                className={active ? 'is-active' : ''}
                type="button"
                aria-pressed={active}
                disabled={count === 0 && !active}
                title={`只看${option.label}待核股票，可与价值组合和风险条件叠加`}
                onClick={() => selectFilter(option.id)}
                key={option.id}
              >
                <span>{option.label}</span>
                <strong>{count}</strong>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
