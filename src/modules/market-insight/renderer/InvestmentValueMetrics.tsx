import { Landmark } from 'lucide-react'
import { formatSignedAmount } from '../../../lib/format'
import type { FundamentalCompany, StockQuote } from '../../../shared/types'

interface InvestmentValueMetricsProps {
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

export function InvestmentValueMetrics({
  quote,
  company,
  snapshotDate,
  staleReason
}: InvestmentValueMetricsProps) {
  const latestReport = company?.annualReports.at(-1)
  const balanceSheet = company?.latestBalanceSheet

  return (
    <section className="investment-value-metrics" aria-labelledby="investment-value-metrics-title">
      <header>
        <span>
          <Landmark size={17} />
          <strong id="investment-value-metrics-title">估值与资本回报</strong>
        </span>
        <small>
          市盈率、市净率随行情更新 · 财务数据 {latestReport?.reportDate ?? snapshotDate ?? '--'}
        </small>
      </header>

      <div className="investment-value-grid">
        <article title="当前总市值相对于最近十二个月归母净利润的倍数">
          <span>市盈率 TTM</span>
          <strong>{ratio(quote?.priceEarningsRatioTtm)}</strong>
          <small>{quote?.priceEarningsRatioTtm != null ? '当前行情估值' : '行情源暂未提供'}</small>
        </article>
        <article title="当前总市值相对于归属于母公司股东权益的倍数">
          <span>市净率</span>
          <strong>{ratio(quote?.priceBookRatio)}</strong>
          <small>{quote?.priceBookRatio != null ? '当前行情估值' : '行情源暂未提供'}</small>
        </article>
        <article title="自由现金流 = 经营现金流净额 - 购建固定资产、无形资产和其他长期资产支付的现金">
          <span>自由现金流</span>
          <strong className={signedClass(latestReport?.freeCashFlow)}>
            {formatSignedAmount(latestReport?.freeCashFlow)}
          </strong>
          <small>{latestReport?.freeCashFlow === undefined ? '更新基本面快照后提供' : `${latestReport.year} 年`}</small>
        </article>
        <article title="投入资本回报率，直接采用东方财富主要财务指标口径">
          <span>ROIC</span>
          <strong className={signedClass(latestReport?.roic)}>{percent(latestReport?.roic)}</strong>
          <small>{latestReport?.roic === undefined ? '更新基本面快照后提供' : `${latestReport.year} 年`}</small>
        </article>
        <article title="净负债估算 = 短期借款、债券、长期借款、一年内到期非流动负债和租赁负债 - 货币资金">
          <span>净负债</span>
          <strong>{formatSignedAmount(balanceSheet?.netDebt)}</strong>
          <small>{balanceSheet?.netDebt === undefined ? '更新基本面快照后提供' : balanceSheet.reportDate} · 负数为净现金</small>
        </article>
      </div>

      <footer>
        <span>PE、PB 只反映当前价格相对利润和净资产的倍数，不单独代表便宜或昂贵。</span>
        {staleReason ? <em>基本面快照已过期：{staleReason}</em> : null}
      </footer>
    </section>
  )
}
