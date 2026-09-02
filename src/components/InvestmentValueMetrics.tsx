import { Landmark } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatAmount, formatSignedAmount } from '../lib/format'
import {
  createStockValuationAnalysis,
  usesOrdinaryCorporateInvestmentMetrics
} from '../lib/valuation-analysis'
import type {
  FundamentalCompany,
  StockPriceCashFlowAnalysis,
  StockQuote,
  StockValuationHistory,
  StockValuationMetricAnalysis
} from '../shared/types'

interface InvestmentValueMetricsProps {
  quoteId: string
  quote?: StockQuote
  company?: FundamentalCompany
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

function priceCashFlowDetail(metric: StockPriceCashFlowAnalysis): string {
  if (metric.unavailableReason === 'not-applicable') return '金融企业应使用行业专用指标'
  if (metric.unavailableReason === 'cash-flow') return '最近连续四季度经营现金流不足'
  if (metric.unavailableReason === 'non-positive-cash-flow') {
    return '最近四季度经营现金流不为正'
  }
  if (metric.unavailableReason === 'market-value') return '当前总市值暂不可用'
  return `${metric.reportDate ?? '--'} 截止的最近四季度`
}

function priceCashFlowComparison(
  metric: StockPriceCashFlowAnalysis,
  valuationError: string
): string {
  if (metric.currentValue === null) return priceCashFlowDetail(metric)
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

function priceCashFlowPeSignal(
  metric: StockPriceCashFlowAnalysis,
  peMetric: StockValuationMetricAnalysis
): { className: string; text: string } | null {
  const comparison = metric.priceEarningsComparisonRatio
  if (metric.unavailableReason === 'non-positive-cash-flow') {
    return {
      className: 'is-neutral',
      text: 'PCF 不适用：最近四季度经营现金流不为正，不能用该倍数判断估值或利润质量。'
    }
  }
  if (comparison === null) return null
  if (metric.relation === 'persistent-gap') {
    return {
      className: 'is-critical',
      text: `多年剪刀差：PCF/PE ${comparison.toFixed(2)}，且最近 ${metric.persistentGapYears} 个完整财年均不低于 1.5，利润现金含量需优先排查。`
    }
  }
  if (
    metric.historicalPercentile !== null &&
    peMetric.historicalPercentile !== null &&
    metric.historicalPercentile >= 70 &&
    peMetric.historicalPercentile <= 40
  ) {
    return {
      className: 'is-warning',
      text: `估值剪刀差：PCF 历史分位 ${percentile(metric.historicalPercentile)}，PE 历史分位 ${percentile(peMetric.historicalPercentile)}；现金流估值明显高于利润估值。`
    }
  }
  if (metric.relation === 'cash-lagging') {
    return {
      className: 'is-warning',
      text: `现金滞后：PCF/PE ${comparison.toFixed(2)}，重点核对应收账款、存货、预付款和非经常性损益。`
    }
  }
  if (metric.relation === 'matched') {
    return {
      className: 'is-matched',
      text: `现金匹配：PCF/PE ${comparison.toFixed(2)}，利润与经营现金流基本匹配。`
    }
  }
  return {
    className: 'is-quality',
    text: `现金含金量较高：PCF/PE ${comparison.toFixed(2)}，经营现金流好于账面利润。`
  }
}

export function InvestmentValueMetrics({
  quoteId,
  quote,
  company,
  snapshotDate,
  staleReason
}: InvestmentValueMetricsProps) {
  const headingId = useId()
  const [valuationHistory, setValuationHistory] = useState<StockValuationHistory | null>(null)
  const [valuationError, setValuationError] = useState('')
  const valuationAnalysis = useMemo(
    () => createStockValuationAnalysis(quoteId, quote, company, valuationHistory),
    [company, quote, quoteId, valuationHistory]
  )

  useEffect(() => {
    let active = true
    setValuationHistory(null)
    setValuationError('')
    void stockApi
      .getValuationHistory(quoteId)
      .then((history) => {
        if (active) setValuationHistory(history)
      })
      .catch((reason: unknown) => {
        if (active) {
          setValuationError(reason instanceof Error ? reason.message : '历史估值数据暂不可用')
        }
      })
    return () => {
      active = false
    }
  }, [quoteId])

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
  const pcfPeSignal = priceCashFlowPeSignal(
    valuationAnalysis.priceCashFlowRatioTtm,
    valuationAnalysis.priceEarningsRatioTtm
  )

  return (
    <section className="investment-value-metrics" aria-labelledby={headingId}>
      <header>
        <span>
          <Landmark size={17} />
          <strong id={headingId}>估值与资本回报</strong>
        </span>
        <small>
          行情 {dateTime(quote?.dataAt ?? quote?.updatedAt)} · 财报截止{' '}
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
        <article title="当前总市值相对于最近连续四个季度经营活动产生的现金流量净额的倍数">
          <span>市现率 PCF TTM</span>
          <strong>{ratio(valuationAnalysis.priceCashFlowRatioTtm.currentValue)}</strong>
          <small
            title={`${priceCashFlowDetail(valuationAnalysis.priceCashFlowRatioTtm)}；历史样本 ${valuationAnalysis.priceCashFlowRatioTtm.historicalSampleSize} 个，行业样本 ${valuationAnalysis.priceCashFlowRatioTtm.industrySampleSize} 家`}
          >
            {priceCashFlowComparison(valuationAnalysis.priceCashFlowRatioTtm, valuationError)}
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
        <span>PE/PB/PCF 分位越低，仅表示相对近五年自身或快照日同行倍数更低。</span>
        {pcfPeSignal ? (
          <span className={`pcf-pe-signal ${pcfPeSignal.className}`}>{pcfPeSignal.text}</span>
        ) : null}
        {staleReason ? <em>基本面快照已过期：{staleReason}</em> : null}
      </footer>
    </section>
  )
}
