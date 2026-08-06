import {
  AlertCircle,
  BarChart3,
  Bot,
  Building2,
  Calculator,
  CircleCheck,
  CircleMinus,
  CircleX,
  Database,
  Layers,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy,
  UsersRound
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import { estimateChipHistoryLimit, findChipAutoRange } from '../lib/chip-distribution'
import {
  DCF_DISCOUNT_RATE,
  DCF_FORECAST_YEARS,
  DCF_LOW_VALUE_THRESHOLD_PERCENT,
  DCF_MAX_FORECAST_GROWTH_RATE,
  DCF_MIN_FORECAST_GROWTH_RATE,
  DCF_TERMINAL_GROWTH_RATE,
  createDcfAnalysis,
  type DcfUnavailableReason
} from '../lib/dcf-analysis'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '../lib/format'
import {
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  FUNDAMENTAL_QUALITY_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_LABELS,
  FUNDAMENTAL_RISK_TAG_SEVERITY,
  MIN_FUNDAMENTAL_PEER_SAMPLE_SIZE,
  evaluateFundamentalQuality,
  evaluateFundamentalRisk,
  summarizeFundamentalScreening,
  type FundamentalPeerComparison,
  type FundamentalPeerMetricComparison,
  type FundamentalQualityProfile,
  type FundamentalQualityTag,
  type FundamentalRiskProfile,
  type FundamentalRiskTag,
  type FundamentalRuleAssessmentStatus,
  type FundamentalScreeningEvaluation
} from '../lib/fundamental-screening'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  isBeijingAutoRefreshTime,
  millisecondsUntilNextAutoRefreshWindow
} from '../shared/market-hours'
import { LruCache } from '../shared/lru-cache'
import type {
  DividendFinancingRankingItem,
  KlineBar,
  KlinePeriod,
  KlineResult,
  StockQuote,
  WatchStock
} from '../shared/types'
import { FundsFlowPanel } from './FundsFlowPanel'
import { ChipDistributionPanel } from './ChipDistributionPanel'
import { OrderBookPanel } from './OrderBookPanel'
import type { KlineVisibleRange, KlineVisibleRangeSource } from './PeriodKlineChart'
import type { MarketInsightSnapshot } from '../modules/market-insight/shared/types'

const CandlestickChart = lazy(() => import('./CandlestickChart'))
const PeriodKlineChart = lazy(() => import('./PeriodKlineChart'))
const SectorIndexPanel = lazy(() => import('./SectorIndexPanel'))
const MarketInsightPanel = __JIANZHANG_MARKET_INSIGHT_ENABLED__
  ? lazy(() => import('../modules/market-insight/renderer/register').then((module) => ({ default: module.MarketInsightPanel })))
  : null
const AiAnalysisPanel = __JIANZHANG_AI_MODULE_ENABLED__
  ? lazy(() => import('../modules/ai/renderer/register').then((module) => ({ default: module.AiAnalysisPanel })))
  : null
const AiTAdvicePanel = __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__
  ? lazy(() => import('../modules/ai-t-advice/renderer/register').then((module) => ({ default: module.TAdvicePanel })))
  : null

type PriceTab = Exclude<KlinePeriod, 'intraday'> | 'trend'
type DetailTab = PriceTab | 'dividendFinancing' | 'fundamental' | 'funds' | 'sector' | 'insight' | 'ai' | 't-advice'
type HistoricalPeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface KlineCacheEntry {
  data: KlineResult
  cachedAt: number
  requestedLimit?: number
}

const klineCache = new LruCache<string, KlineCacheEntry>(100)
const PRICE_TABS: Array<{ id: PriceTab; label: string; description: string }> = [
  { id: 'trend', label: '分时', description: '集合竞价与盘中分时线' },
  { id: 'fiveDay', label: '五日', description: '五日分时线' },
  { id: 'daily', label: '日K', description: '日 K 线' },
  { id: 'weekly', label: '周K', description: '周 K 线' },
  { id: 'monthly', label: '月K', description: '月 K 线' }
]
const LEADING_PRICE_TABS = PRICE_TABS.filter((tab) => tab.id === 'trend')
const TRAILING_PRICE_TABS = PRICE_TABS.filter((tab) => tab.id !== 'trend')
const PRICE_TAB_IDS = new Set<PriceTab>(PRICE_TABS.map((tab) => tab.id))
const INITIAL_HISTORY_LIMITS: Record<HistoricalPeriod, number> = {
  daily: 120,
  weekly: 104,
  monthly: 60
}
const MAX_HISTORY_LIMITS: Record<HistoricalPeriod, number> = {
  daily: 1920,
  weekly: 1664,
  monthly: 960
}

function isHistoricalTab(tab: PriceTab): tab is HistoricalPeriod {
  return tab === 'daily' || tab === 'weekly' || tab === 'monthly'
}

function isPriceTab(tab: DetailTab): tab is PriceTab {
  return PRICE_TAB_IDS.has(tab as PriceTab)
}

function apiPeriod(tab: PriceTab): KlinePeriod {
  return tab === 'trend' ? 'intraday' : tab
}

function cacheKey(quoteId: string, tab: PriceTab): string {
  return `${quoteId}:${tab}`
}

function signedValueClass(value: number): string {
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-zero'
}

function dividendAmount(value: number): string {
  return `${value.toLocaleString('zh-CN', {
    minimumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2
  })} 亿元`
}

function fundamentalPercent(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined
    ? '--'
    : `${value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      })}%`
}

function fundamentalAmount(value: number | null): string {
  return value === null
    ? '--'
    : `${(value / 100_000_000).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })} 亿`
}

function fundamentalGeneratedTime(value?: string): string {
  if (!value) return '--'
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

function annualCashConversion(netProfit: number | null, operatingCashFlow: number | null): number | null {
  if (netProfit === null || netProfit <= 0 || operatingCashFlow === null) return null
  return operatingCashFlow / netProfit * 100
}

const DCF_UNAVAILABLE_MESSAGES: Record<DcfUnavailableReason, string> = {
  'not-applicable': '银行、证券和保险不适用普通企业自由现金流 DCF 口径。',
  'free-cash-flow': '近三年自由现金流不完整或平均值不为正，暂不生成 DCF 估值。',
  'net-debt': '缺少最新净负债，暂不能从企业价值换算为股东价值。',
  'share-count': '快照缺少收盘价或总市值，请更新基本面数据后查看 DCF。'
}

function DcfPanel({
  evaluation,
  currentPrice
}: {
  evaluation: FundamentalScreeningEvaluation
  currentPrice: number | null | undefined
}) {
  const result = createDcfAnalysis(evaluation.company, currentPrice)
  const analysis = result.analysis

  return (
    <section className="fundamental-dcf-section">
      <header>
        <span>
          <i><Calculator size={17} /></i>
          <span>
            <strong>DCF 现金流折现估值</strong>
            <small>用未来自由现金流估算每股内在价值</small>
          </span>
        </span>
        <small>模型估值，不代表买入建议</small>
      </header>

      {!analysis ? (
        <div className="fundamental-dcf-empty">
          <strong>当前无法计算 DCF</strong>
          <span>{DCF_UNAVAILABLE_MESSAGES[result.unavailableReason]}</span>
        </div>
      ) : (
        <>
          <div className="fundamental-dcf-metrics">
            <article>
              <small>DCF 每股估值</small>
              <strong className={signedValueClass(analysis.fairValuePerShare)}>
                ¥{formatPrice(analysis.fairValuePerShare)}
              </strong>
            </article>
            <article>
              <small>当前股价</small>
              <strong>{analysis.currentPrice === null ? '--' : `¥${formatPrice(analysis.currentPrice)}`}</strong>
            </article>
            <article>
              <small>相对当前股价</small>
              <strong className={signedValueClass(analysis.differencePercent ?? 0)}>
                {analysis.differencePercent === null
                  ? '--'
                  : analysis.differencePercent > 0
                    ? `高于 ${fundamentalPercent(analysis.differencePercent, 1)}`
                    : analysis.differencePercent < 0
                      ? `低于 ${fundamentalPercent(Math.abs(analysis.differencePercent), 1)}`
                      : '持平 0.0%'}
              </strong>
            </article>
            <article>
              <small>DCF / 当前股价</small>
              <strong className={signedValueClass(analysis.differencePercent ?? 0)}>
                {fundamentalPercent(analysis.fairValueToPricePercent, 1)}
              </strong>
            </article>
          </div>

          {analysis.belowLowValueThreshold ? (
            <div className="fundamental-dcf-alert" role="alert">
              <AlertCircle size={16} />
              <span>
                <strong>DCF 低于现价提醒</strong>
                DCF 仅为当前股价的 {fundamentalPercent(analysis.fairValueToPricePercent, 1)}，
                低于 {DCF_LOW_VALUE_THRESHOLD_PERCENT}% 警戒线；当前股价高于 DCF 估值{' '}
                {fundamentalPercent(Math.abs(analysis.differencePercent ?? 0), 1)}。
              </span>
            </div>
          ) : analysis.differencePercent !== null ? (
            <p className="fundamental-dcf-comparison">
              {analysis.differencePercent >= 0
                ? `DCF 估值高于当前股价 ${fundamentalPercent(analysis.differencePercent, 1)}。`
                : `DCF 估值低于当前股价 ${fundamentalPercent(Math.abs(analysis.differencePercent), 1)}，尚未触发 ${DCF_LOW_VALUE_THRESHOLD_PERCENT}% 警戒线。`}
            </p>
          ) : (
            <p className="fundamental-dcf-comparison">暂无实时股价，暂不能判断 DCF 高于或低于当前股价多少。</p>
          )}

          <p className="fundamental-dcf-method">
            口径：以近三年平均自由现金流 {fundamentalAmount(analysis.normalizedFreeCashFlow)} 为基础，
            预测 {DCF_FORECAST_YEARS} 年增长 {fundamentalPercent(analysis.forecastGrowthRate, 1)}
            （历史复合增长 {fundamentalPercent(analysis.historicalGrowthRate, 1)}，限制在{' '}
            {DCF_MIN_FORECAST_GROWTH_RATE}%—{DCF_MAX_FORECAST_GROWTH_RATE}%），折现率{' '}
            {DCF_DISCOUNT_RATE}%，永续增长率 {DCF_TERMINAL_GROWTH_RATE}%；企业价值扣除净负债后按总股本折算。
          </p>
        </>
      )}
    </section>
  )
}

function DividendFinancingDeepDetails({ item }: { item: DividendFinancingRankingItem }) {
  const annualDividends = (item.annualDividends ?? []).slice(-12)
  const maxAnnualDividend = Math.max(...annualDividends.map((point) => point.amountYi), 0.0001)
  const scoreParts = item.qualityScoreBreakdown
    ? [
        ['分红融资比分位', item.qualityScoreBreakdown.ratio, 30],
        ['净回报额分位', item.qualityScoreBreakdown.netReturn, 25],
        ['分红连续性', item.qualityScoreBreakdown.continuity, 25],
        ['近期增长', item.qualityScoreBreakdown.growth, 10],
        ['融资纪律', item.qualityScoreBreakdown.financingDiscipline, 10]
      ] as const
    : []
  const trendLabels = {
    growing: '增长',
    stable: '稳定',
    declining: '下降',
    insufficient: '数据不足'
  }

  return (
    <details className="dividend-financing-history">
      <summary>展开年度分红、融资事件与评分明细</summary>
      <div className="dividend-financing-deep-metrics">
        <div><span>近3年分红</span><strong>{item.recent3YearDividendYi === undefined ? '--' : dividendAmount(item.recent3YearDividendYi)}</strong></div>
        <div><span>近5年分红</span><strong>{item.recent5YearDividendYi === undefined ? '--' : dividendAmount(item.recent5YearDividendYi)}</strong></div>
        <div><span>连续分红</span><strong>{item.consecutiveDividendYears ?? '--'} 年</strong></div>
        <div><span>累计分红年份</span><strong>{item.dividendYears ?? '--'} / {item.listedYears ?? '--'} 年</strong></div>
        <div>
          <span>近期分红趋势</span>
          <strong className={signedValueClass(item.recentDividendTrendPercent ?? 0)}>
            {item.dividendTrend ? trendLabels[item.dividendTrend] : '--'}
            {item.recentDividendTrendPercent === null || item.recentDividendTrendPercent === undefined
              ? ''
              : ` ${item.recentDividendTrendPercent > 0 ? '+' : ''}${item.recentDividendTrendPercent.toFixed(2)}%`}
          </strong>
        </div>
        <div><span>股权融资事件</span><strong>{item.financingCount ?? '--'} 次 · 最近 {item.lastFinancingDate ?? '--'}</strong></div>
      </div>
      <div className="dividend-financing-history-content">
        <section>
          <h4>近12个有分红年度</h4>
          {annualDividends.length > 0 ? (
            <div className="annual-dividend-chart">
              {annualDividends.map((point) => (
                <div key={point.year} title={`${point.year}年 · ${dividendAmount(point.amountYi)} · ${point.eventCount}次`}>
                  <span>{point.amountYi.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                  <i style={{ height: `${Math.max(4, point.amountYi / maxAnnualDividend * 100)}%` }} />
                  <strong>{point.year}</strong>
                </div>
              ))}
            </div>
          ) : <p className="dividend-financing-no-history">当前快照没有年度拆分数据</p>}
        </section>
        <section>
          <h4>股权融资时间线</h4>
          {(item.financingEvents ?? []).length > 0 ? (
            <ol className="financing-event-timeline">
              {[...(item.financingEvents ?? [])].reverse().map((event, index) => (
                <li key={`${event.date}-${event.type}-${index}`}>
                  <span>{event.date || '日期未知'}</span>
                  <strong>{event.type}</strong>
                  <em>{dividendAmount(event.amountYi)}</em>
                </li>
              ))}
            </ol>
          ) : <p className="dividend-financing-no-history">当前快照没有融资事件明细</p>}
        </section>
        <section>
          <h4>回报质量评分 · {item.qualityScore?.toFixed(1) ?? '--'} 分 · 第 {item.scoreRank ?? '--'} 名</h4>
          {scoreParts.length > 0 ? (
            <div className="dividend-score-breakdown">
              {scoreParts.map(([label, value, maximum]) => (
                <div key={label}>
                  <span>{label}</span>
                  <i><b style={{ width: `${value / maximum * 100}%` }} /></i>
                  <strong>{value.toFixed(1)} / {maximum}</strong>
                </div>
              ))}
            </div>
          ) : <p className="dividend-financing-no-history">当前快照没有评分拆解数据</p>}
          <p className="dividend-score-note">评分只比较本期分红融资比超过100%的股票，用于解释历史股东回报质量，不代表未来收益。</p>
        </section>
      </div>
    </details>
  )
}

function DividendFinancingPanel({
  item,
  snapshotDate
}: {
  item?: DividendFinancingRankingItem
  snapshotDate?: string
}) {
  if (!item) {
    return (
      <div className="dividend-financing-tab-empty" role="status">
        <Trophy size={24} />
        <strong>当前股票暂无分红融资榜数据</strong>
        <span>可能未进入分红融资比大于100%榜单，或当前快照没有完整数据。</span>
      </div>
    )
  }

  return (
    <div className="dividend-financing-tab-panel">
      <div className="dividend-financing-detail-summary">
        <div className="dividend-financing-detail-title">
          <Trophy size={18} />
          <span>
            <strong>分红融资榜</strong>
            <small>{snapshotDate ?? '--'} 快照</small>
          </span>
        </div>
        <div>
          <span>分红融资比</span>
          <strong className="dividend-financing-detail-ratio">{item.ratio.toFixed(2)}%</strong>
        </div>
        <div>
          <span>榜单排名</span>
          <strong>第 {item.rank} 名</strong>
        </div>
        <div>
          <span>累计A股分红</span>
          <strong>{item.dividendYi.toLocaleString('zh-CN')} 亿元</strong>
        </div>
        <div>
          <span>累计A股融资</span>
          <strong>{item.financingYi.toLocaleString('zh-CN')} 亿元</strong>
        </div>
        <div>
          <span>净回报额</span>
          <strong className={signedValueClass(item.netReturnYi ?? item.dividendYi - item.financingYi)}>
            {dividendAmount(item.netReturnYi ?? item.dividendYi - item.financingYi)}
          </strong>
        </div>
        <div>
          <span>回报质量评分</span>
          <strong>{item.qualityScore?.toFixed(1) ?? '--'} 分 · 第 {item.scoreRank ?? '--'} 名</strong>
        </div>
        <DividendFinancingDeepDetails item={item} />
      </div>
    </div>
  )
}

const FUNDAMENTAL_ORGANIZATION_LABELS = {
  general: '普通企业',
  bank: '银行',
  securities: '证券公司',
  insurance: '保险公司',
  other: '其他金融企业'
} as const

function FundamentalRuleBadge({
  status
}: {
  status: FundamentalRuleAssessmentStatus
}) {
  return (
    <span className={`fundamental-rule-badge is-${status}`}>
      {status === 'passed'
        ? <CircleCheck size={14} />
        : status === 'failed'
          ? <CircleX size={14} />
          : <CircleMinus size={14} />}
      {status === 'passed'
        ? '通过'
        : status === 'failed'
          ? '待核'
          : status === 'missing'
            ? '缺数'
            : '免筛'}
    </span>
  )
}

function FundamentalPeerMetricCard({
  title,
  description,
  comparison,
  direction
}: {
  title: string
  description: string
  comparison: FundamentalPeerMetricComparison
  direction: 'higher' | 'lower'
}) {
  const ranked = comparison.rank !== null
  return (
    <div className="fundamental-peer-metric">
      <span>
        <small>{title}</small>
        <strong className={direction === 'higher'
          ? signedValueClass(comparison.value ?? 0)
          : undefined}
        >
          {fundamentalPercent(comparison.value)}
        </strong>
      </span>
      <div>
        {comparison.value === null ? (
          <strong>当前指标缺失</strong>
        ) : ranked ? (
          <>
            <strong>行业第 {comparison.rank} / {comparison.sampleSize}</strong>
            <em>
              {direction === 'higher'
                ? `行业前 ${comparison.topPercent}%`
                : `低于 ${comparison.betterThanPercent}% 同行`}
            </em>
          </>
        ) : (
          <>
            <strong>样本不足</strong>
            <em>当前有效样本 {comparison.sampleSize} 家</em>
          </>
        )}
      </div>
      <p>{description}</p>
    </div>
  )
}

function FundamentalPeerPanel({
  evaluation,
  comparison
}: {
  evaluation: FundamentalScreeningEvaluation
  comparison?: FundamentalPeerComparison
}) {
  return (
    <section className="fundamental-peer-section">
      <header>
        <span>
          <i><UsersRound size={17} /></i>
          <span>
            <strong>同行位置</strong>
            <small>{evaluation.company.industryName || '行业未知'}</small>
          </span>
        </span>
        <small>只比较同一行业的普通企业，排名不改变三项筛选结论</small>
      </header>
      {!evaluation.eligibleOrganization ? (
        <div className="fundamental-peer-unavailable">
          <strong>金融企业暂不提供同行排名</strong>
          <span>银行、券商和保险公司的现金流与负债结构不适合套用普通企业口径。</span>
        </div>
      ) : comparison ? (
        <>
          <div className="fundamental-peer-grid">
            <FundamentalPeerMetricCard
              title="持续 ROE"
              description="按五年最低加权 ROE 从高到低排名"
              comparison={comparison.roe}
              direction="higher"
            />
            <FundamentalPeerMetricCard
              title="现金质量"
              description="按五年累计现金转换率从高到低排名"
              comparison={comparison.cash}
              direction="higher"
            />
            <FundamentalPeerMetricCard
              title="负债水平"
              description="按最新资产负债率从低到高排名"
              comparison={comparison.debt}
              direction="lower"
            />
          </div>
          <p className="fundamental-peer-note">
            每项仅统计数据完整的企业；有效样本少于 {MIN_FUNDAMENTAL_PEER_SAMPLE_SIZE} 家时不发布名次。
            现金转换率可能受累计净利润较小影响，需结合五年明细判断。
          </p>
        </>
      ) : (
        <div className="fundamental-peer-unavailable">
          <strong>当前行业暂无可比样本</strong>
          <span>快照中没有足够的同口径普通企业数据。</span>
        </div>
      )}
    </section>
  )
}

function FundamentalQualityEvidence({
  tag,
  profile,
  evaluation
}: {
  tag: FundamentalQualityTag
  profile: FundamentalQualityProfile
  evaluation: FundamentalScreeningEvaluation
}) {
  const { metrics } = profile
  const reports = evaluation.company.annualReports
  const firstYear = reports[0]?.year ?? '--'
  const lastYear = reports.at(-1)?.year ?? '--'
  const recentFirstYear = reports.at(-3)?.year ?? '--'

  if (tag === 'strictFundamental') {
    return (
      <>
        <strong className={signedValueClass(metrics.minimumDeductedRoe ?? 0)}>
          五年最低扣非 ROE {fundamentalPercent(metrics.minimumDeductedRoe)}
        </strong>
        <p>五个完整财年扣非加权 ROE 每年均严格高于 15%</p>
      </>
    )
  }
  if (tag === 'cashSustained') {
    return (
      <>
        <strong>{metrics.sustainedCashYears} / 5 个财年</strong>
        <p>每年经营现金流净额均严格大于当年合并净利润</p>
      </>
    )
  }
  if (tag === 'profitGrowth') {
    return (
      <>
        <strong className={signedValueClass(metrics.netProfitCagr ?? 0)}>
          净利润复合增速 {fundamentalPercent(metrics.netProfitCagr)}
        </strong>
        <p>{firstYear}—{lastYear} 共四个年度间隔，要求严格高于 10%</p>
      </>
    )
  }
  if (tag === 'roeStable') {
    return (
      <>
        <strong>
          五年波动范围 {metrics.roeRange?.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) ?? '--'} 个百分点
        </strong>
        <p>五年加权 ROE 最大值与最小值之差严格小于 8 个百分点</p>
      </>
    )
  }
  if (tag === 'deductedSolid') {
    return (
      <>
        <strong className={signedValueClass(metrics.deductedProfitRatio ?? 0)}>
          累计扣非利润占比 {fundamentalPercent(metrics.deductedProfitRatio)}
        </strong>
        <p>五年累计扣非归母净利润占累计归母净利润严格高于 90%</p>
      </>
    )
  }
  return (
    <>
      <strong className={signedValueClass(metrics.latestCashConversion ?? 0)}>
        最新现金转换率 {fundamentalPercent(metrics.latestCashConversion)}
      </strong>
      <p>{recentFirstYear}—{lastYear} 加权 ROE 与净利润均连续增长</p>
    </>
  )
}

function FundamentalQualityPanel({
  evaluation
}: {
  evaluation: FundamentalScreeningEvaluation
}) {
  const profile = evaluateFundamentalQuality(evaluation.company)
  return (
    <section className="fundamental-quality-section">
      <header>
        <span>
          <i><Sparkles size={17} /></i>
          <span>
            <strong>质量特征</strong>
            <small>固定按软件推荐口径计算</small>
          </span>
        </span>
        <small>标签可以重叠，数量多少不代表综合评分</small>
      </header>
      {!evaluation.eligibleOrganization ? (
        <div className="fundamental-quality-empty">
          <strong>金融企业暂不参与质量标签</strong>
          <span>银行、券商和保险公司的财务结构需要使用独立评价口径。</span>
        </div>
      ) : profile.tags.length > 0 ? (
        <div className="fundamental-quality-grid">
          {profile.tags.map((tag) => (
            <article className={tag === 'improving' ? 'is-improving' : ''} key={tag}>
              <span>{FUNDAMENTAL_QUALITY_TAG_LABELS[tag]}</span>
              <FundamentalQualityEvidence
                tag={tag}
                profile={profile}
                evaluation={evaluation}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="fundamental-quality-empty">
          <strong>暂无质量细分标签</strong>
          <span>没有标签不代表公司较差，也可能是指标未达到固定口径或数据不完整。</span>
        </div>
      )}
    </section>
  )
}

function FundamentalRiskEvidence({
  tag,
  profile,
  evaluation
}: {
  tag: FundamentalRiskTag
  profile: FundamentalRiskProfile
  evaluation: FundamentalScreeningEvaluation
}) {
  const { metrics } = profile
  const reports = evaluation.company.annualReports
  const firstYear = reports[0]?.year ?? '--'
  const lastYear = reports.at(-1)?.year ?? '--'
  const recentFirstYear = reports.at(-3)?.year ?? '--'

  if (tag === 'cashDivergence') {
    return (
      <>
        <strong className={signedValueClass(metrics.cumulativeCashConversion ?? 0)}>
          五年累计现金转换率 {fundamentalPercent(metrics.cumulativeCashConversion)}
        </strong>
        <p>五年加权 ROE 每年高于 15%，但累计现金转换率低于 80%</p>
      </>
    )
  }
  if (tag === 'highLeverageRoe') {
    return (
      <>
        <strong>行业负债分位 {fundamentalPercent(metrics.debtIndustryPercentile, 1)}</strong>
        <p>高 ROE 与同行业高负债同时出现，需要核查杠杆贡献，不能直接判断因果</p>
      </>
    )
  }
  if (tag === 'deductedWeak') {
    return (
      <>
        <strong className={signedValueClass(metrics.minimumDeductedRoe ?? 0)}>
          五年最低扣非 ROE {fundamentalPercent(metrics.minimumDeductedRoe)}
        </strong>
        <p>加权 ROE 五年达标，但扣非加权 ROE 至少一年不高于 15%</p>
      </>
    )
  }
  if (tag === 'profitCashDivergence') {
    return (
      <>
        <strong className={signedValueClass(metrics.latestCashConversion ?? 0)}>
          最新现金转换率 {fundamentalPercent(metrics.latestCashConversion)}
        </strong>
        <p>{recentFirstYear}—{lastYear} 净利润连续增长，但经营现金流连续下降</p>
      </>
    )
  }
  if (tag === 'roeDecline') {
    return (
      <>
        <strong className={signedValueClass(-(metrics.roeDeclinePoints ?? 0))}>
          较 {firstYear} 年下降 {metrics.roeDeclinePoints?.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }) ?? '--'} 个百分点
        </strong>
        <p>五年 ROE 仍每年高于 15%，但最新值较五年前下降至少 5 个百分点</p>
      </>
    )
  }
  return (
    <>
      <strong className={signedValueClass(metrics.latestCashConversion ?? 0)}>
        最新现金转换率 {fundamentalPercent(metrics.latestCashConversion)}
      </strong>
      <p>五年累计现金转换率高于 100%，但 {lastYear} 年单年现金转换率低于 100%</p>
    </>
  )
}

function FundamentalRiskPanel({
  evaluation
}: {
  evaluation: FundamentalScreeningEvaluation
}) {
  const profile = evaluateFundamentalRisk(evaluation.company)
  return (
    <section className="fundamental-risk-section">
      <header>
        <span>
          <i><AlertCircle size={17} /></i>
          <span>
            <strong>风险关注</strong>
            <small>固定按软件推荐口径识别</small>
          </span>
        </span>
        <small>提示只用于定位需核查项目，不直接改变三项硬筛选结论</small>
      </header>
      {!evaluation.eligibleOrganization ? (
        <div className="fundamental-risk-empty">
          <strong>金融企业暂不参与风险提示</strong>
          <span>银行、券商和保险公司需要使用独立的现金流与杠杆评价口径。</span>
        </div>
      ) : profile.tags.length > 0 ? (
        <div className="fundamental-risk-grid">
          {profile.tags.map((tag) => (
            <article className={`is-${FUNDAMENTAL_RISK_TAG_SEVERITY[tag]}`} key={tag}>
              <span>{FUNDAMENTAL_RISK_TAG_LABELS[tag]}</span>
              <FundamentalRiskEvidence
                tag={tag}
                profile={profile}
                evaluation={evaluation}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="fundamental-risk-empty">
          <strong>当前字段范围内未识别到风险提示</strong>
          <span>这不代表公司没有其他财务或经营风险，仍需结合更多信息研究。</span>
        </div>
      )}
    </section>
  )
}

function FundamentalPanel({
  evaluation,
  currentPrice,
  peerComparison,
  snapshotDate,
  generatedAt,
  staleReason
}: {
  evaluation?: FundamentalScreeningEvaluation
  currentPrice?: number | null
  peerComparison?: FundamentalPeerComparison
  snapshotDate?: string
  generatedAt?: string
  staleReason?: string | null
}) {
  if (!evaluation) {
    return (
      <div className="fundamental-tab-empty" role="status">
        <Database size={26} />
        <strong>当前股票暂无基本面财务数据</strong>
        <span>当前快照可能尚未覆盖这只股票，可在“基本面初筛”中查看或更新数据。</span>
      </div>
    )
  }

  const { company, eligibleOrganization } = evaluation
  const screeningSummary = summarizeFundamentalScreening(evaluation)
  const organizationLabel = FUNDAMENTAL_ORGANIZATION_LABELS[company.organizationType]
  const debtAssetRatio = company.latestBalanceSheet.debtAssetRatio
  const debtPercentile = company.latestBalanceSheet.industryPercentile
  const debtP60 = evaluation.industryBenchmark?.debtAssetRatioP60 ?? null
  const roeThreshold = DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA.roeThreshold
  const debtThreshold = DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA.debtIndustryPercentile

  return (
    <div className="fundamental-tab-panel">
      {staleReason ? (
        <div className="fundamental-stale-notice" role="status">
          <AlertCircle size={15} />
          <span><strong>当前基本面数据已过期</strong>{staleReason}</span>
        </div>
      ) : null}

      <div className="fundamental-detail-conclusion-card">
        <span className="fundamental-detail-icon"><Building2 size={20} /></span>
        <span>
          <small>{organizationLabel} · {company.industryName || '行业未知'}</small>
          <strong>
            {eligibleOrganization
              ? screeningSummary.status === 'passed'
                ? '3/3 项通过，可进入下一步研究'
                : screeningSummary.status === 'missing'
                  ? '基本面数据不足，暂不能完成三项筛选'
                  : `有 ${screeningSummary.reviewCount} 项待核，需要进一步研究`
              : `${organizationLabel}不参与普通企业三项筛选`}
          </strong>
          <em>
            {eligibleOrganization
              ? '筛选结果只用于缩小研究范围，不代表买入建议。'
              : '以下财务数据仍然展示，但资产负债结构不与普通企业直接比较。'}
          </em>
        </span>
      </div>

      <div className="fundamental-evidence-grid">
        <section>
          <header>
            <span>01</span>
            <strong>连续五年 ROE</strong>
            <FundamentalRuleBadge status={screeningSummary.ruleStatuses.roe} />
          </header>
          <div>
            <span>五年最低加权 ROE</span>
            <strong className={signedValueClass(evaluation.minimumRoe ?? 0)}>
              {fundamentalPercent(evaluation.minimumRoe)}
            </strong>
          </div>
          <p>要求五个完整财年每年严格高于 {roeThreshold}%</p>
        </section>

        <section>
          <header>
            <span>02</span>
            <strong>现金利润质量</strong>
            <FundamentalRuleBadge status={screeningSummary.ruleStatuses.cash} />
          </header>
          <div>
            <span>五年累计现金转换率</span>
            <strong className={signedValueClass(evaluation.cumulativeCashConversion ?? 0)}>
              {fundamentalPercent(evaluation.cumulativeCashConversion)}
            </strong>
          </div>
          <p>
            经营现金流 {fundamentalAmount(evaluation.cumulativeOperatingCashFlow)} / 净利润{' '}
            {fundamentalAmount(evaluation.cumulativeNetProfit)}，要求严格高于 100%
          </p>
        </section>

        <section>
          <header>
            <span>03</span>
            <strong>行业杠杆水平</strong>
            <FundamentalRuleBadge status={screeningSummary.ruleStatuses.debt} />
          </header>
          <div>
            <span>资产负债率 / 行业 P60</span>
            <strong>{fundamentalPercent(debtAssetRatio)} / {fundamentalPercent(debtP60)}</strong>
          </div>
          <p>
            当前位于行业 {fundamentalPercent(debtPercentile, 1)} 分位，要求严格低于 {debtThreshold}% 分位
          </p>
        </section>
      </div>

      <DcfPanel evaluation={evaluation} currentPrice={currentPrice} />

      <FundamentalQualityPanel evaluation={evaluation} />

      <FundamentalRiskPanel evaluation={evaluation} />

      <FundamentalPeerPanel evaluation={evaluation} comparison={peerComparison} />

      <div className="fundamental-annual-section">
        <div className="fundamental-annual-heading">
          <span>
            <strong>五年财务明细</strong>
            <small>金额单位：亿元</small>
          </span>
          <small>利润与收益率按正红负绿显示</small>
        </div>
        <div className="fundamental-annual-table-wrap">
          <table className="fundamental-detail-annual-table">
            <thead>
              <tr>
                <th>财年</th>
                <th>加权 ROE</th>
                <th>扣非 ROE</th>
                <th>净利润</th>
                <th>扣非归母净利润</th>
                <th>经营现金流</th>
                <th>现金转换率</th>
              </tr>
            </thead>
            <tbody>
              {company.annualReports.map((report) => {
                const conversion = annualCashConversion(report.netProfit, report.operatingCashFlow)
                return (
                  <tr key={report.year}>
                    <td>{report.year}</td>
                    <td className={signedValueClass(report.weightedAverageRoe ?? 0)}>
                      {fundamentalPercent(report.weightedAverageRoe)}
                    </td>
                    <td className={signedValueClass(report.deductedWeightedAverageRoe ?? 0)}>
                      {fundamentalPercent(report.deductedWeightedAverageRoe)}
                    </td>
                    <td className={signedValueClass(report.netProfit ?? 0)}>
                      {fundamentalAmount(report.netProfit)}
                    </td>
                    <td className={signedValueClass(report.deductedParentNetProfit ?? 0)}>
                      {fundamentalAmount(report.deductedParentNetProfit)}
                    </td>
                    <td className={signedValueClass(report.operatingCashFlow ?? 0)}>
                      {fundamentalAmount(report.operatingCashFlow)}
                    </td>
                    <td className={signedValueClass(conversion ?? 0)}>
                      {fundamentalPercent(conversion)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fundamental-detail-source">
        <span>快照年度：{snapshotDate ?? '--'}</span>
        <span>生成时间：{fundamentalGeneratedTime(generatedAt)}</span>
        <span>负债报告期：{company.latestBalanceSheet.reportDate || '--'}</span>
      </div>
    </div>
  )
}

interface ExpandedStockDetailsProps {
  stock: WatchStock
  quote?: StockQuote
  dividendFinancing?: DividendFinancingRankingItem
  dividendFinancingSnapshotDate?: string
  fundamentalScreening?: FundamentalScreeningEvaluation
  fundamentalPeerComparison?: FundamentalPeerComparison
  fundamentalSnapshotDate?: string
  fundamentalGeneratedAt?: string
  fundamentalStaleReason?: string | null
  fundamentalTabRequested?: boolean
  onFundamentalTabRequestHandled?: () => void
  refreshSeconds: number
  autoRefreshOrderBook: boolean
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  onChipDistributionEnabledChange: (enabled: boolean) => void
  onBollingerBandsEnabledChange: (enabled: boolean) => void
}

export function ExpandedStockDetails({
  stock,
  quote,
  dividendFinancing,
  dividendFinancingSnapshotDate,
  fundamentalScreening,
  fundamentalPeerComparison,
  fundamentalSnapshotDate,
  fundamentalGeneratedAt,
  fundamentalStaleReason,
  fundamentalTabRequested,
  onFundamentalTabRequestHandled,
  refreshSeconds,
  autoRefreshOrderBook,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  onChipDistributionEnabledChange,
  onBollingerBandsEnabledChange
}: ExpandedStockDetailsProps) {
  const initialTrend = klineCache.get(cacheKey(stock.quoteId, 'trend'))?.data
  const [activeTab, setActiveTab] = useState<DetailTab>('trend')
  const [dataByTab, setDataByTab] = useState<Partial<Record<PriceTab, KlineResult>>>(() => (
    initialTrend ? { trend: initialTrend } : {}
  ))
  const [loadingTab, setLoadingTab] = useState<PriceTab | null>(initialTrend ? null : 'trend')
  const [errors, setErrors] = useState<Partial<Record<PriceTab, string>>>({})
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [hoveredBar, setHoveredBar] = useState<KlineBar | null>(null)
  const [historyLimits, setHistoryLimits] = useState<Record<HistoricalPeriod, number>>({
    ...INITIAL_HISTORY_LIMITS
  })
  const [dailyVisibleRange, setDailyVisibleRange] = useState<KlineVisibleRange | null>(null)
  const [chipAutoRangeMode, setChipAutoRangeMode] = useState(true)
  const [chipRangeRequestKey, setChipRangeRequestKey] = useState(0)
  const [marketInsightSnapshot, setMarketInsightSnapshot] = useState<MarketInsightSnapshot | null>(null)
  const [showInsightOverlay, setShowInsightOverlay] = useState(true)
  const [aiEnabled, setAiEnabled] = useState(false)
  const activeHistoricalLimit = isPriceTab(activeTab) && isHistoricalTab(activeTab)
    ? historyLimits[activeTab]
    : undefined

  useEffect(() => {
    if (!fundamentalTabRequested) return
    setActiveTab('fundamental')
    onFundamentalTabRequestHandled?.()
  }, [fundamentalTabRequested, onFundamentalTabRequestHandled])

  useEffect(() => {
    setHoveredBar(null)
  }, [activeTab, stock.quoteId])

  useEffect(() => {
    setMarketInsightSnapshot(null)
    setDailyVisibleRange(null)
    setChipAutoRangeMode(true)
    setChipRangeRequestKey((current) => current + 1)
  }, [stock.quoteId])

  useEffect(() => {
    let active = true
    const api = window.aiApi
    if (AiAnalysisPanel && api) {
      void api.getStatus().then((status) => {
        if (active) setAiEnabled(status.enabled)
      }).catch(() => {
        if (active) setAiEnabled(false)
      })
    }
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleEnabledChange = (event: Event) => setAiEnabled(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener('ai:enabled-changed', handleEnabledChange)
    return () => window.removeEventListener('ai:enabled-changed', handleEnabledChange)
  }, [])

  useEffect(() => {
    if (!aiEnabled && (activeTab === 'ai' || activeTab === 't-advice')) setActiveTab('trend')
  }, [activeTab, aiEnabled])

  useEffect(() => {
    if (!isPriceTab(activeTab)) return

    const tab = activeTab
    const key = cacheKey(stock.quoteId, tab)
    const cached = klineCache.get(key)
    const isLiveChart = tab === 'trend' || tab === 'fiveDay'
    const requestedLimit = isHistoricalTab(tab) ? activeHistoricalLimit : undefined
    const cacheHasRequestedRange = requestedLimit === undefined
      || (cached?.requestedLimit ?? 0) >= requestedLimit
    const freshness = isLiveChart ? INTRADAY_REFRESH_MILLISECONDS : 5 * 60 * 1000
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      if (!isLiveChart) return
      refreshTimer = window.setTimeout(() => {
        if (isBeijingAutoRefreshTime()) {
          setRefreshVersion((current) => current + 1)
        } else {
          scheduleRefresh()
        }
      }, isBeijingAutoRefreshTime() ? freshness : millisecondsUntilNextAutoRefreshWindow())
    }

    if (refreshVersion === 0 && cached && cacheHasRequestedRange && Date.now() - cached.cachedAt < freshness) {
      setDataByTab((current) => ({ ...current, [tab]: cached.data }))
      setErrors((current) => ({ ...current, [tab]: '' }))
      setLoadingTab(null)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    setLoadingTab(tab)
    setErrors((current) => ({ ...current, [tab]: '' }))
    stockApi.getKline(stock.quoteId, apiPeriod(tab), requestedLimit)
      .then((result) => {
        if (!active) return
        const isFiveMinuteFallback = tab === 'trend' && result.intervalMinutes === 5
        const hasOneMinuteCache = Boolean(cached && cached.data.intervalMinutes !== 5)
        if (isFiveMinuteFallback && hasOneMinuteCache) {
          setErrors((current) => ({
            ...current,
            [tab]: result.fallbackReason || '1分钟分时数据刷新失败'
          }))
          return
        }
        klineCache.set(key, { data: result, cachedAt: Date.now(), requestedLimit })
        setDataByTab((current) => ({ ...current, [tab]: result }))
      })
      .catch((reason: unknown) => {
        if (!active) return
        setErrors((current) => ({
          ...current,
          [tab]: reason instanceof Error ? reason.message : `${PRICE_TABS.find((item) => item.id === tab)?.label}加载失败`
        }))
      })
      .finally(() => {
        if (!active) return
        setLoadingTab(null)
        scheduleRefresh()
      })

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [activeHistoricalLimit, activeTab, refreshVersion, stock.quoteId])

  const priceTab = isPriceTab(activeTab) ? activeTab : null
  const data = priceTab ? dataByTab[priceTab] ?? null : null
  const error = priceTab ? errors[priceTab] ?? '' : ''
  const tabMeta = priceTab ? PRICE_TABS.find((item) => item.id === priceTab) : undefined
  const isLoading = priceTab !== null && loadingTab === priceTab
  const historicalPeriod = priceTab && isHistoricalTab(priceTab) ? priceTab : null
  const isHistorical = historicalPeriod !== null
  const dailyBars = dataByTab.daily?.bars ?? []
  const chipAutoRange = useMemo(() => findChipAutoRange(dailyBars), [dailyBars])
  const chipDataStatus = dailyBars.length > 0
    ? chipAutoRange
      ? 'ready' as const
      : 'missing-turnover' as const
    : loadingTab === 'daily' || activeTab === 'daily' && !dataByTab.daily && !errors.daily
      ? 'loading' as const
      : errors.daily
        ? 'failed' as const
        : 'empty' as const
  const chipStatusDetail = chipDataStatus === 'failed'
    ? errors.daily
    : chipDataStatus === 'missing-turnover'
      ? dataByTab.daily?.fallbackReason
        ? `${dataByTab.daily.fallbackReason}；备用数据未提供完整换手率。`
        : undefined
      : undefined
  const chipVisibleRange = chipAutoRangeMode ? chipAutoRange : dailyVisibleRange ?? chipAutoRange
  const chipBars = useMemo(() => chipVisibleRange
    ? dailyBars.slice(chipVisibleRange.fromIndex, chipVisibleRange.toIndex + 1)
    : [], [chipVisibleRange, dailyBars])
  const isFiveMinuteFallback = priceTab === 'trend' && data?.intervalMinutes === 5
  const overviewBar = priceTab === 'trend' ? null : hoveredBar
  const changePercentByTime = useMemo(() => {
    const changes = new Map<string, number>()
    if (!isHistorical || !data) return changes

    for (let index = 1; index < data.bars.length; index += 1) {
      const previousClose = data.bars[index - 1].close
      if (previousClose !== 0) {
        changes.set(data.bars[index].time, (data.bars[index].close - previousClose) / previousClose * 100)
      }
    }
    return changes
  }, [data, isHistorical])
  const overview = overviewBar ? [
    ['开盘', formatPrice(overviewBar.open)],
    ['收盘', formatPrice(overviewBar.close)],
    ...(isHistorical ? [['涨幅', formatPercent(changePercentByTime.get(overviewBar.time))]] : []),
    ['最高', formatPrice(overviewBar.high)],
    ['最低', formatPrice(overviewBar.low)],
    ['成交量', formatVolume(overviewBar.volume)],
    ['成交额', formatAmount(overviewBar.amount)]
  ] : [
    ['今开', formatPrice(quote?.open)],
    ['昨收', formatPrice(quote?.previousClose)],
    ['最高', formatPrice(quote?.high)],
    ['最低', formatPrice(quote?.low)],
    ['成交量', formatVolume(quote?.volume)],
    ['成交额', formatAmount(quote?.amount)]
  ]

  const handleHoverBar = useCallback((bar: KlineBar | null) => {
    setHoveredBar(bar)
  }, [])

  const handleDailyVisibleRangeChange = useCallback((
    range: KlineVisibleRange,
    source: KlineVisibleRangeSource
  ) => {
    setDailyVisibleRange(range)
    if (source === 'user') setChipAutoRangeMode(false)
  }, [])

  const requestMoreHistory = useCallback((period: HistoricalPeriod) => {
    setHistoryLimits((current) => {
      const nextLimit = Math.min(MAX_HISTORY_LIMITS[period], current[period] * 2)
      return nextLimit === current[period] ? current : { ...current, [period]: nextLimit }
    })
  }, [])

  useEffect(() => {
    if (!chipDistributionEnabled || activeTab !== 'daily' || !chipAutoRange) return
    if (chipAutoRange.reachedThreshold || dailyBars.length < historyLimits.daily) return
    const estimatedLimit = estimateChipHistoryLimit(dailyBars, MAX_HISTORY_LIMITS.daily)
    if (estimatedLimit === null) return
    setHistoryLimits((current) => current.daily >= estimatedLimit
      ? current
      : { ...current, daily: estimatedLimit })
  }, [activeTab, chipAutoRange, chipDistributionEnabled, dailyBars, historyLimits.daily])

  const toggleChipDistribution = () => {
    const enabled = !chipDistributionEnabled
    if (enabled) {
      setDailyVisibleRange(null)
      setChipAutoRangeMode(true)
      setChipRangeRequestKey((current) => current + 1)
    }
    onChipDistributionEnabledChange(enabled)
  }

  const restoreChipAutoRange = () => {
    setDailyVisibleRange(null)
    setChipAutoRangeMode(true)
    setChipRangeRequestKey((current) => current + 1)
  }

  const retryCurrentTab = () => {
    if (priceTab) klineCache.delete(cacheKey(stock.quoteId, priceTab))
    setRefreshVersion((current) => current + 1)
  }

  return (
    <section className="stock-details" aria-label={`${stock.name} 行情详情`}>
      <div className="detail-tabs" role="tablist" aria-label="行情详情类型">
        {LEADING_PRICE_TABS.map((tab) => (
          <button
            className={activeTab === tab.id ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            <BarChart3 size={15} />
            {tab.label}
          </button>
        ))}
        <button
          className={activeTab === 'dividendFinancing' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'dividendFinancing'}
          onClick={() => setActiveTab('dividendFinancing')}
        >
          <Trophy size={15} />
          分红融资
        </button>
        <button
          className={activeTab === 'fundamental' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'fundamental'}
          onClick={() => setActiveTab('fundamental')}
        >
          <Building2 size={15} />
          基本面
        </button>
        <button
          className={activeTab === 'funds' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'funds'}
          onClick={() => setActiveTab('funds')}
        >
          <TrendingUp size={15} />
          资金流向
        </button>
        {MarketInsightPanel ? (
          <button
            className={activeTab === 'insight' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 'insight'}
            onClick={() => setActiveTab('insight')}
          >
            <Radar size={15} />
            市场观察
          </button>
        ) : null}
        {AiAnalysisPanel && aiEnabled ? (
          <button
            className={activeTab === 'ai' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 'ai'}
            onClick={() => setActiveTab('ai')}
          >
            <Bot size={15} />
            AI 分析
          </button>
        ) : null}
        {AiTAdvicePanel && aiEnabled ? (
          <button
            className={activeTab === 't-advice' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 't-advice'}
            onClick={() => setActiveTab('t-advice')}
          >
            <Sparkles size={15} />
            做 T 参考
          </button>
        ) : null}
        {TRAILING_PRICE_TABS.map((tab) => (
          <button
            className={activeTab === tab.id ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            <BarChart3 size={15} />
            {tab.label}
          </button>
        ))}
        <button
          className={activeTab === 'sector' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'sector'}
          onClick={() => setActiveTab('sector')}
        >
          <Layers size={15} />
          板块
        </button>
      </div>

      {activeTab === 'dividendFinancing' ? (
        <div className="dividend-financing-tab-content" role="tabpanel">
          <DividendFinancingPanel item={dividendFinancing} snapshotDate={dividendFinancingSnapshotDate} />
        </div>
      ) : activeTab === 'fundamental' ? (
        <div className="fundamental-tab-content" role="tabpanel">
          <FundamentalPanel
            evaluation={fundamentalScreening}
            currentPrice={quote?.latest}
            peerComparison={fundamentalPeerComparison}
            snapshotDate={fundamentalSnapshotDate}
            generatedAt={fundamentalGeneratedAt}
            staleReason={fundamentalStaleReason}
          />
        </div>
      ) : priceTab ? (
        <div className="trend-tab-panel" role="tabpanel">
          <div className="overview-header">
            <div>
              <strong>今日概览</strong>
              <span>{overviewBar?.time || data?.tradingDate || '最近交易日'} · {tabMeta?.description}</span>
              {isFiveMinuteFallback ? (
                <em className="intraday-fallback-badge">5分钟备用行情</em>
              ) : null}
            </div>
            <div className="chart-legend" aria-label="图表图例">
              <span className={isHistorical ? 'legend-candlestick' : 'legend-price'}>
                {isHistorical ? 'K线' : '价格'}
              </span>
              {priceTab === 'trend' ? <span className="legend-auction-price">集合竞价</span> : null}
              {priceTab === 'trend' ? <span className="legend-average-price">VWAP</span> : null}
              <span className="legend-volume">成交量</span>
              {priceTab === 'daily' ? (
                <button
                  className={`chip-distribution-toggle ${chipDistributionEnabled ? 'is-active' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={chipDistributionEnabled}
                  onClick={toggleChipDistribution}
                >
                  <span aria-hidden="true"><i /></span>
                  筹码分布
                </button>
              ) : null}
            </div>
          </div>
          <div className="overview-grid">
            {overview.map(([label, value]) => (
              <div className="overview-item" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className={`chart-panel ${priceTab === 'trend' ? 'has-order-book' : ''} ${historicalPeriod ? 'has-bollinger-toolbar' : ''} ${priceTab === 'daily' && chipDistributionEnabled ? 'has-chip-distribution' : ''}`}>
            <div className="chart-content">
              {error && data || isFiveMinuteFallback ? (
                <div className="chart-refresh-warning" title={isFiveMinuteFallback ? data?.fallbackReason : error}>
                  <AlertCircle size={14} />
                  <span>
                    {isFiveMinuteFallback
                      ? '1分钟分时暂不可用，当前显示5分钟备用行情'
                      : priceTab === 'trend'
                        ? '1分钟分时刷新失败，当前显示最近一次1分钟数据'
                        : `${tabMeta?.label}数据刷新失败，当前显示最近一次数据`}
                  </span>
                  <button type="button" onClick={retryCurrentTab}>重试</button>
                </div>
              ) : null}
              {isLoading && data && isHistorical ? (
                <div className="chart-history-loading">
                  {priceTab === 'daily' && chipDistributionEnabled && chipAutoRangeMode && chipAutoRange && !chipAutoRange.reachedThreshold
                    ? `正在补取更早日 K：累计换手 ${chipAutoRange.cumulativeTurnover.toFixed(2)}%，目标 100%`
                    : '正在加载更早数据…'}
                </div>
              ) : null}
              {isLoading && !data ? (
                <div className="chart-loading">
                  <BarChart3 size={28} />
                  <span>正在加载{tabMeta?.label}数据…</span>
                </div>
              ) : error && !data ? (
                <div className="chart-error">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                  <button className="secondary-button chart-retry-button" type="button" onClick={retryCurrentTab}>
                    <RefreshCw size={14} />
                    重新获取
                  </button>
                </div>
              ) : data && data.bars.length > 0 ? (
                <Suspense fallback={<div className="chart-loading">正在初始化图表…</div>}>
                  {historicalPeriod ? (
                    <PeriodKlineChart
                      bars={data.bars}
                      period={historicalPeriod}
                      onHoverBar={handleHoverBar}
                      onRequestMore={requestMoreHistory}
                      requestedVisibleBars={historicalPeriod === 'daily' && chipDistributionEnabled && chipAutoRangeMode
                        ? chipAutoRange?.barCount
                        : undefined}
                      visibleRangeRequestKey={chipRangeRequestKey}
                      onVisibleRangeChange={historicalPeriod === 'daily' ? handleDailyVisibleRangeChange : undefined}
                      bollingerBandsEnabled={bollingerBandsEnabled}
                      onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                      height={historicalPeriod === 'daily' && chipDistributionEnabled ? 360 : 320}
                    />
                  ) : (
                    <CandlestickChart
                      bars={data.bars}
                      variant={priceTab === 'fiveDay' ? 'fiveDay' : 'intraday'}
                      onHoverBar={priceTab === 'trend' ? undefined : handleHoverBar}
                      marketInsightOverlay={priceTab === 'trend' && showInsightOverlay ? marketInsightSnapshot?.chartOverlay : null}
                    />
                  )}
                </Suspense>
              ) : (
                <div className="chart-loading">最近交易日暂无{tabMeta?.label}数据</div>
              )}
            </div>
            {priceTab === 'trend' ? (
              <OrderBookPanel
                stock={stock}
                refreshSeconds={refreshSeconds}
                autoRefresh={autoRefreshOrderBook}
              />
            ) : priceTab === 'daily' && chipDistributionEnabled ? (
              <ChipDistributionPanel
                quoteId={stock.quoteId}
                quoteName={stock.name}
                bars={chipBars}
                dataStatus={chipDataStatus}
                statusDetail={chipStatusDetail}
                isAutoRange={chipAutoRangeMode}
                onRestoreAutoRange={restoreChipAutoRange}
              />
            ) : null}
          </div>
        </div>
      ) : activeTab === 'funds' ? (
        <div className="funds-tab-panel" role="tabpanel">
          <FundsFlowPanel stock={stock} />
        </div>
      ) : activeTab === 'sector' ? (
        <div className="sector-tab-panel" role="tabpanel">
          <Suspense fallback={<div className="chart-loading">正在加载板块详情…</div>}>
            <SectorIndexPanel stock={stock} />
          </Suspense>
        </div>
      ) : activeTab === 'ai' && AiAnalysisPanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化 AI 分析…</div>}>
          <AiAnalysisPanel stock={stock} quote={quote} />
        </Suspense>
      ) : activeTab === 't-advice' && AiTAdvicePanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化做 T 参考…</div>}>
          <AiTAdvicePanel stock={stock} quote={quote} />
        </Suspense>
      ) : MarketInsightPanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化市场观察…</div>}>
          <MarketInsightPanel
            stock={stock}
            quote={quote}
            fundamentalCompany={fundamentalScreening?.company}
            fundamentalSnapshotDate={fundamentalSnapshotDate}
            fundamentalStaleReason={fundamentalStaleReason}
            onSnapshotChanged={setMarketInsightSnapshot}
            onChartOverlayEnabledChange={setShowInsightOverlay}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
