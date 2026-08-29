import { Landmark } from 'lucide-react'
import { formatAmount, formatSignedAmount } from '../../../lib/format'
import { usesOrdinaryCorporateInvestmentMetrics } from '../../../lib/valuation-analysis'
import type {
  FundamentalCompany,
  StockQuote,
  StockValuationAnalysis,
  StockValuationMetricAnalysis
} from '../../../shared/types'

interface InvestmentValueMetricsProps {
  quote?: StockQuote
  company?: FundamentalCompany
  valuationAnalysis: StockValuationAnalysis
  valuationError?: string
  snapshotDate?: string
  staleReason?: string | null
}

function ratio(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : `${value.toFixed(2)} 倍`
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function signedClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '--'
}

function percentile(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(0)}%`
}

function valuationComparison(
  metric: StockValuationMetricAnalysis,
  valuationError: string | undefined,
  isPe: boolean
): string {
  if (isPe && metric.currentValue !== null && metric.currentValue <= 0) {
    return '亏损状态，PE 分位不适用'
  }
  if (metric.currentValue === null) return '行情源暂未提供'
  const history =
    metric.historicalSampleSize > 0
      ? `历史 ${percentile(metric.historicalPercentile)}`
      : valuationError
        ? '历史分位暂不可用'
        : '历史分位读取中'
  const industry =
    metric.industrySampleSize > 0
      ? `行业 ${percentile(metric.industryPercentile)}`
      : '行业分位待快照更新'
  return `${history} · ${industry}`
}

export function InvestmentValueMetrics({
  quote,
  company,
  valuationAnalysis,
  valuationError,
  snapshotDate,
  staleReason
}: InvestmentValueMetricsProps) {
  const latestReport = company?.annualReports.at(-1)
  const balanceSheet = company?.latestBalanceSheet
  const ordinaryMetricsApplicable = usesOrdinaryCorporateInvestmentMetrics(
    company?.organizationType
  )
  const historyPeriod =
    valuationAnalysis.historyPeriodStart && valuationAnalysis.historyPeriodEnd
      ? `${valuationAnalysis.historyPeriodStart}—${valuationAnalysis.historyPeriodEnd}`
      : '--'
  const financialYears = company?.annualReports.length
    ? `${company.annualReports[0].year}—${company.annualReports.at(-1)?.year}`
    : '--'

  return (
    <section className="investment-value-metrics" aria-labelledby="investment-value-metrics-title">
      <header>
        <span>
          <Landmark size={17} />
          <strong id="investment-value-metrics-title">估值与资本回报</strong>
        </span>
        <small>
          行情 {dateTime(quote?.updatedAt)} · 财报截止{' '}
          {latestReport?.reportDate ?? snapshotDate ?? '--'} · 五年财务 {financialYears}
          {' · '}历史估值 {historyPeriod} · 行业估值 {valuationAnalysis.industryDataAt ?? '--'}
        </small>
      </header>

      <div className="investment-value-grid">
        <article title="当前总市值相对于最近十二个月归母净利润的倍数">
          <span>市盈率 TTM</span>
          <strong>{ratio(quote?.priceEarningsRatioTtm)}</strong>
          <small
            title={`历史样本 ${valuationAnalysis.priceEarningsRatioTtm.historicalSampleSize} 个，行业样本 ${valuationAnalysis.priceEarningsRatioTtm.industrySampleSize} 家`}
          >
            {valuationComparison(valuationAnalysis.priceEarningsRatioTtm, valuationError, true)}
          </small>
        </article>
        <article title="当前总市值相对于归属于母公司股东权益的倍数">
          <span>市净率</span>
          <strong>{ratio(quote?.priceBookRatio)}</strong>
          <small
            title={`历史样本 ${valuationAnalysis.priceBookRatio.historicalSampleSize} 个，行业样本 ${valuationAnalysis.priceBookRatio.industrySampleSize} 家`}
          >
            {valuationComparison(valuationAnalysis.priceBookRatio, valuationError, false)}
          </small>
        </article>
        <article title="快照估值日收盘价乘以公司总股本">
          <span>总市值</span>
          <strong>{formatAmount(valuationAnalysis.totalMarketValue)}</strong>
          <small>
            {valuationAnalysis.totalMarketValue === null
              ? '更新基本面快照后提供'
              : `${valuationAnalysis.industryDataAt ?? '--'} 收盘`}
          </small>
        </article>
        <article title="快照估值日收盘价乘以公司流通 A 股股本">
          <span>流通市值</span>
          <strong>{formatAmount(valuationAnalysis.circulatingMarketValue)}</strong>
          <small>
            {valuationAnalysis.circulatingMarketValue === null
              ? '更新基本面快照后提供'
              : `${valuationAnalysis.industryDataAt ?? '--'} 收盘`}
          </small>
        </article>
        <article title="自由现金流 = 经营现金流净额 - 购建固定资产、无形资产和其他长期资产支付的现金">
          <span>自由现金流</span>
          <strong
            className={
              ordinaryMetricsApplicable ? signedClass(latestReport?.freeCashFlow) : 'is-flat'
            }
          >
            {ordinaryMetricsApplicable ? formatSignedAmount(latestReport?.freeCashFlow) : '不适用'}
          </strong>
          <small>
            {ordinaryMetricsApplicable
              ? latestReport?.freeCashFlow === undefined
                ? '更新基本面快照后提供'
                : `${latestReport.year} 年`
              : '金融企业应使用行业专用指标'}
          </small>
        </article>
        <article title="投入资本回报率，直接采用东方财富主要财务指标口径">
          <span>ROIC</span>
          <strong
            className={ordinaryMetricsApplicable ? signedClass(latestReport?.roic) : 'is-flat'}
          >
            {ordinaryMetricsApplicable ? percent(latestReport?.roic) : '不适用'}
          </strong>
          <small>
            {ordinaryMetricsApplicable
              ? latestReport?.roic === undefined
                ? '更新基本面快照后提供'
                : `${latestReport.year} 年`
              : '金融企业应使用行业专用指标'}
          </small>
        </article>
        <article title="净负债估算 = 短期借款、债券、长期借款、一年内到期非流动负债和租赁负债 - 货币资金">
          <span>净负债</span>
          <strong>
            {ordinaryMetricsApplicable ? formatSignedAmount(balanceSheet?.netDebt) : '不适用'}
          </strong>
          <small>
            {ordinaryMetricsApplicable
              ? `${balanceSheet?.netDebt === undefined ? '更新基本面快照后提供' : balanceSheet.reportDate} · 负数为净现金`
              : '金融企业应使用行业专用指标'}
          </small>
        </article>
      </div>

      <footer>
        <span>分位越低表示相对近五年自身或快照日同行越低；不同数据时点已分别标注。</span>
        {staleReason ? <em>基本面快照已过期：{staleReason}</em> : null}
      </footer>
    </section>
  )
}
