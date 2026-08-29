import { ChartPie, FilterX, LocateFixed, ShieldAlert, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCurrency } from '../lib/format'
import {
  FUNDAMENTAL_RISK_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_SEVERITY,
  type FundamentalRiskTag
} from '../lib/fundamental-screening'
import type {
  PortfolioQualitySummary,
  PortfolioRiskCategory,
  PortfolioValueCategory
} from '../lib/portfolio-quality'
import { PORTFOLIO_RISK_TAGS } from '../lib/portfolio-quality'

interface PortfolioQualityDialogProps {
  summary: PortfolioQualitySummary
  fundamentalSnapshotDate?: string
  dividendSnapshotDate?: string
  fundamentalStaleReason?: string | null
  dividendStaleReason?: string | null
  onLocateStock: (quoteId: string) => void
  onClose: () => void
}

const VALUE_CATEGORY_META: Record<
  PortfolioValueCategory,
  { label: string; shortLabel: string; description: string }
> = {
  dual: {
    label: '双重通过',
    shortLabel: '双优',
    description: '基本面硬筛选通过，并进入分红融资榜'
  },
  fundamental: {
    label: '仅基本面',
    shortLabel: '基本',
    description: '基本面硬筛选通过，未进入分红融资榜'
  },
  dividend: {
    label: '仅分红回报',
    shortLabel: '分红',
    description: '进入分红融资榜，基本面硬筛选未通过或暂不适用'
  },
  unlabeled: {
    label: '暂无标签',
    shortLabel: '暂无',
    description: '当前没有两个总标签，不代表公司一定较差'
  }
}

const RISK_CATEGORY_META: Record<PortfolioRiskCategory, { label: string; description: string }> = {
  critical: {
    label: '严重风险',
    description: '至少触发现金背离或利润现金背离'
  },
  warning: {
    label: '关注项',
    description: '只触发橙色风险提示'
  },
  clear: {
    label: '暂未发现风险',
    description: '六类风险所需数据完整，当前均未触发'
  },
  unassessed: {
    label: '未评估',
    description: '基本面缺失、数据不完整或属于金融企业'
  }
}

const VALUE_CATEGORY_ORDER: PortfolioValueCategory[] = [
  'dual',
  'fundamental',
  'dividend',
  'unlabeled'
]

const RISK_CATEGORY_ORDER: PortfolioRiskCategory[] = ['critical', 'warning', 'clear', 'unassessed']

function formatShare(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(1)}%`
}

function riskTagText(tags: FundamentalRiskTag[]): string {
  return tags.map((tag) => FUNDAMENTAL_RISK_TAG_LABELS[tag]).join('、')
}

export function PortfolioQualityDialog({
  summary,
  fundamentalSnapshotDate,
  dividendSnapshotDate,
  fundamentalStaleReason,
  dividendStaleReason,
  onLocateStock,
  onClose
}: PortfolioQualityDialogProps) {
  const [valueFilter, setValueFilter] = useState<PortfolioValueCategory | null>(null)
  const [riskFilter, setRiskFilter] = useState<PortfolioRiskCategory | null>(null)
  const [riskTagFilter, setRiskTagFilter] = useState<FundamentalRiskTag | null>(null)
  const [industryFilter, setIndustryFilter] = useState<string | null>(null)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const filteredHoldings = useMemo(
    () =>
      summary.holdings.filter(
        (holding) =>
          (!valueFilter || holding.valueCategory === valueFilter) &&
          (!riskFilter || holding.riskCategory === riskFilter) &&
          (!riskTagFilter || holding.riskTags.includes(riskTagFilter)) &&
          (!industryFilter || holding.industryName === industryFilter)
      ),
    [industryFilter, riskFilter, riskTagFilter, summary.holdings, valueFilter]
  )
  const hasHoldingFilters = Boolean(valueFilter || riskFilter || riskTagFilter || industryFilter)
  const pricedIndustries = summary.industries.filter((industry) => industry.marketValue > 0)
  const topIndustryPercent = pricedIndustries[0]?.percent ?? null
  const topThreeIndustryPercent =
    summary.totalMarketValue === null
      ? null
      : pricedIndustries.slice(0, 3).reduce((total, industry) => total + (industry.percent ?? 0), 0)
  const clearHoldingFilters = () => {
    setValueFilter(null)
    setRiskFilter(null)
    setRiskTagFilter(null)
    setIndustryFilter(null)
  }

  return createPortal(
    <div className="portfolio-quality-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="portfolio-quality-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-quality-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="portfolio-quality-header">
          <span className="portfolio-quality-title-icon" aria-hidden="true">
            <ChartPie size={21} />
          </span>
          <span>
            <h2 id="portfolio-quality-title">持仓质量概览</h2>
            <small>
              基本面快照 {fundamentalSnapshotDate ?? '暂无'} · 分红融资快照{' '}
              {dividendSnapshotDate ?? '暂无'}
            </small>
          </span>
          <button
            className="icon-button portfolio-quality-close"
            type="button"
            onClick={onClose}
            aria-label="关闭持仓质量概览"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        <div className="portfolio-quality-body">
          {fundamentalStaleReason || dividendStaleReason ? (
            <div className="portfolio-quality-stale-notice">
              <strong>当前分析包含已过期快照</strong>
              {fundamentalStaleReason ? <span>基本面：{fundamentalStaleReason}</span> : null}
              {dividendStaleReason ? <span>分红融资：{dividendStaleReason}</span> : null}
            </div>
          ) : null}

          <div className="portfolio-quality-summary">
            <span>
              <small>全部持仓</small>
              <strong>{summary.positionCount} 只</strong>
            </span>
            <span>
              <small>纳入市值计算</small>
              <strong>{summary.pricedPositionCount} 只</strong>
            </span>
            <span>
              <small>可计价总市值</small>
              <strong>{formatCurrency(summary.totalMarketValue)}</strong>
            </span>
            <span className={summary.unpricedPositionCount > 0 ? 'is-warning' : ''}>
              <small>未计价持仓</small>
              <strong>{summary.unpricedPositionCount} 只</strong>
              {summary.unpricedPositionCount > 0 ? (
                <em>成本 {formatCurrency(summary.unpricedCostValue)}</em>
              ) : null}
            </span>
          </div>

          <section className="portfolio-quality-section" aria-labelledby="portfolio-value-heading">
            <div className="portfolio-quality-section-heading">
              <span>
                <ChartPie size={17} />
                <strong id="portfolio-value-heading">持仓价值类型</strong>
              </span>
              <small>按当前可计价持仓市值计算，四类互斥</small>
            </div>
            {summary.totalMarketValue !== null ? (
              <div className="portfolio-quality-bar" aria-label="持仓价值类型市值分布">
                {VALUE_CATEGORY_ORDER.map((category) => {
                  const bucket = summary.valueBuckets[category]
                  return bucket.percent && bucket.percent > 0 ? (
                    <span
                      className={`is-${category}`}
                      style={{ width: `${bucket.percent}%` }}
                      title={`${VALUE_CATEGORY_META[category].label} ${formatShare(bucket.percent)}`}
                      key={category}
                    />
                  ) : null
                })}
              </div>
            ) : (
              <div className="portfolio-quality-no-price">
                当前持仓均未取得最新价格，暂不能计算市值占比。
              </div>
            )}
            <div className="portfolio-quality-buckets">
              {VALUE_CATEGORY_ORDER.map((category) => {
                const bucket = summary.valueBuckets[category]
                const meta = VALUE_CATEGORY_META[category]
                return (
                  <button
                    className={`portfolio-quality-bucket is-${category} ${valueFilter === category ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={valueFilter === category}
                    onClick={() => setValueFilter(valueFilter === category ? null : category)}
                    key={category}
                  >
                    <span>
                      <strong>{meta.label}</strong>
                      <b>{formatShare(bucket.percent)}</b>
                    </span>
                    <small>
                      {bucket.count} 只 · 市值 {formatCurrency(bucket.marketValue)}
                    </small>
                    <p>{meta.description}</p>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="portfolio-quality-section" aria-labelledby="portfolio-risk-heading">
            <div className="portfolio-quality-section-heading">
              <span>
                <ShieldAlert size={17} />
                <strong id="portfolio-risk-heading">基本面风险暴露</strong>
              </span>
              <small>严重、关注、未发现和未评估四类互斥</small>
            </div>
            <div className="portfolio-risk-buckets">
              {RISK_CATEGORY_ORDER.map((category) => {
                const bucket = summary.riskBuckets[category]
                const meta = RISK_CATEGORY_META[category]
                return (
                  <button
                    className={`portfolio-risk-bucket is-${category} ${riskFilter === category ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={riskFilter === category}
                    onClick={() => {
                      setRiskFilter(riskFilter === category ? null : category)
                      setRiskTagFilter(null)
                    }}
                    key={category}
                  >
                    <span>
                      <strong>{meta.label}</strong>
                      <b>{formatShare(bucket.percent)}</b>
                    </span>
                    <small>
                      {bucket.count} 只 · 市值 {formatCurrency(bucket.marketValue)}
                    </small>
                    <p>{meta.description}</p>
                  </button>
                )
              })}
            </div>
            <div className="portfolio-risk-tag-heading">
              <strong>具体风险暴露</strong>
              <small>风险标签可以重叠，单项占比之和可能超过总风险暴露</small>
            </div>
            <div className="portfolio-risk-tags">
              {PORTFOLIO_RISK_TAGS.map((tag) => {
                const bucket = summary.riskTagBuckets[tag]
                const severity = FUNDAMENTAL_RISK_TAG_SEVERITY[tag]
                return (
                  <button
                    className={`is-${severity} ${riskTagFilter === tag ? 'is-active' : ''}`}
                    type="button"
                    disabled={bucket.count === 0 && riskTagFilter !== tag}
                    aria-pressed={riskTagFilter === tag}
                    onClick={() => {
                      setRiskTagFilter(riskTagFilter === tag ? null : tag)
                      setRiskFilter(null)
                    }}
                    key={tag}
                  >
                    <span>{FUNDAMENTAL_RISK_TAG_LABELS[tag]}</span>
                    <strong>{formatShare(bucket.percent)}</strong>
                    <small>{bucket.count} 只</small>
                  </button>
                )
              })}
            </div>
          </section>

          <section
            className="portfolio-quality-section"
            aria-labelledby="portfolio-industry-heading"
          >
            <div className="portfolio-quality-section-heading">
              <span>
                <strong id="portfolio-industry-heading">行业集中度</strong>
              </span>
              <small>
                {summary.industries.length} 个行业 · 第一大行业 {formatShare(topIndustryPercent)} ·
                前三大 {formatShare(topThreeIndustryPercent)}
              </small>
            </div>
            <div className="portfolio-industry-list">
              {summary.industries.map((industry) => {
                const riskPercent =
                  industry.marketValue > 0
                    ? (industry.riskBuckets.critical.percent ?? 0) +
                      (industry.riskBuckets.warning.percent ?? 0)
                    : null
                return (
                  <button
                    className={`portfolio-industry-row ${industryFilter === industry.name ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={industryFilter === industry.name}
                    onClick={() =>
                      setIndustryFilter(industryFilter === industry.name ? null : industry.name)
                    }
                    key={industry.name}
                  >
                    <span className="portfolio-industry-name">
                      <strong>{industry.name}</strong>
                      <small>
                        {industry.count} 只 · 市值 {formatCurrency(industry.marketValue)}
                      </small>
                    </span>
                    <strong className="portfolio-industry-percent">
                      {formatShare(industry.percent)}
                    </strong>
                    <span
                      className="portfolio-industry-value-bar"
                      aria-label={`${industry.name}行业内价值类型分布`}
                    >
                      {VALUE_CATEGORY_ORDER.map((category) => {
                        const percent = industry.valueBuckets[category].percent
                        return percent && percent > 0 ? (
                          <i
                            className={`is-${category}`}
                            style={{ width: `${percent}%` }}
                            title={`${VALUE_CATEGORY_META[category].label} ${formatShare(percent)}`}
                            key={category}
                          />
                        ) : null
                      })}
                    </span>
                    <span
                      className={`portfolio-industry-risk ${riskPercent && riskPercent > 0 ? 'has-risk' : ''}`}
                    >
                      风险 {formatShare(riskPercent)}
                    </span>
                  </button>
                )
              })}
            </div>
            <small className="portfolio-industry-note">
              彩色条表示各行业内部的双重通过、仅基本面、仅分红回报和暂无标签市值结构；风险占比以该行业可计价市值为分母。
            </small>
          </section>

          <section
            className="portfolio-quality-holdings"
            aria-labelledby="portfolio-holdings-heading"
          >
            <div className="portfolio-quality-section-heading">
              <span>
                <strong id="portfolio-holdings-heading">持仓明细</strong>
              </span>
              <span className="portfolio-holding-filter-summary">
                <small>
                  {hasHoldingFilters
                    ? `筛选结果 ${filteredHoldings.length} / ${summary.holdings.length} 只`
                    : '默认按持仓市值从高到低排列'}
                </small>
                {hasHoldingFilters ? (
                  <button type="button" onClick={clearHoldingFilters}>
                    <FilterX size={14} />
                    清除条件
                  </button>
                ) : null}
              </span>
            </div>
            <div className="portfolio-quality-table-scroller">
              <table>
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>行业</th>
                    <th>持仓市值</th>
                    <th>仓位</th>
                    <th>价值类型</th>
                    <th>风险状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((holding) => (
                    <tr key={holding.quoteId}>
                      <td>
                        <strong>{holding.name}</strong>
                        <small>{holding.code}</small>
                      </td>
                      <td>{holding.industryName}</td>
                      <td>
                        {holding.marketValue === null ? (
                          <span className="portfolio-unpriced-value">
                            <strong>未计价</strong>
                            <small>成本 {formatCurrency(holding.costValue)}</small>
                          </span>
                        ) : (
                          formatCurrency(holding.marketValue)
                        )}
                      </td>
                      <td>{formatShare(holding.weight)}</td>
                      <td>
                        <span className={`portfolio-value-tag is-${holding.valueCategory}`}>
                          {VALUE_CATEGORY_META[holding.valueCategory].label}
                        </span>
                      </td>
                      <td>
                        <span className={`portfolio-risk-state is-${holding.riskCategory}`}>
                          <strong>{RISK_CATEGORY_META[holding.riskCategory].label}</strong>
                          {holding.riskTags.length > 0 ? (
                            <small>{riskTagText(holding.riskTags)}</small>
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary-button portfolio-locate-button"
                          type="button"
                          onClick={() => onLocateStock(holding.quoteId)}
                        >
                          <LocateFixed size={14} />
                          定位
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredHoldings.length === 0 ? (
                    <tr>
                      <td className="portfolio-quality-filter-empty" colSpan={7}>
                        当前组合条件下没有持仓。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <p className="portfolio-quality-methodology">
            “分红回报”表示累计现金分红与股权融资关系进入榜单，不等于当前股息率高；“暂无标签”和“未评估”都不代表公司一定较差。结果仅用于组合结构观察，不构成投资建议。
          </p>
        </div>
      </section>
    </div>,
    document.body
  )
}
