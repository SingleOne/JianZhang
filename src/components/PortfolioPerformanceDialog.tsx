import { ChartPie, CircleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatMoneyProfit } from '../lib/format'
import {
  calculatePortfolioPerformanceReport,
  PORTFOLIO_PERFORMANCE_ISSUE_LABELS,
  type CnyProfitComponents,
  type NativePerformanceSlice,
  type PortfolioPerformanceAggregate,
  type PortfolioPerformanceIssueCode
} from '../lib/portfolio-performance'
import type {
  ExchangeRateSettings,
  StockQuote,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import './PortfolioPerformanceDialog.css'

interface PortfolioPerformanceDialogProps {
  watchlist: WatchStock[]
  quotes: StockQuote[]
  accounts: TTradingAccounts
  exchangeRates: ExchangeRateSettings
  onClose: () => void
}

type PerformanceDimension = 'stock' | 'market' | 'account' | 'currency' | 'portfolio'

const DIMENSION_LABELS: Record<PerformanceDimension, string> = {
  stock: '按股票',
  market: '按市场',
  account: '按账户',
  currency: '按币种',
  portfolio: '组合汇总'
}

function valueClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function expenseValue(cny: CnyProfitComponents): number | null {
  if (cny.withholdingTax === null || cny.tradeFees === null || cny.corporateActionFees === null) {
    return null
  }
  return -(cny.withholdingTax + cny.tradeFees + cny.corporateActionFees)
}

function nativeExpense(slice: NativePerformanceSlice): number {
  return -(slice.withholdingTax + slice.tradeFees + slice.corporateActionFees)
}

function NativeProfitCell({ slices }: { slices: NativePerformanceSlice[] }) {
  if (slices.length === 0) return <span className="performance-empty-value">--</span>
  return (
    <div className="performance-native-values">
      {slices.map((slice) => (
        <span key={slice.currency}>
          <strong className={valueClass(slice.totalProfit)}>
            {formatMoneyProfit(slice.totalProfit, slice.currency)}
          </strong>
          <small>
            已 {formatMoneyProfit(slice.realizedProfit, slice.currency)} · 未{' '}
            {formatMoneyProfit(slice.unrealizedProfit, slice.currency)} · 分红{' '}
            {formatMoneyProfit(slice.dividendIncome, slice.currency)} · 税费{' '}
            {formatMoneyProfit(nativeExpense(slice), slice.currency)} · 行动{' '}
            {formatMoneyProfit(slice.corporateActionIncome, slice.currency)}
          </small>
        </span>
      ))}
    </div>
  )
}

function IssueSummary({ row }: { row: PortfolioPerformanceAggregate }) {
  const issues = Object.entries(row.issueCounts) as Array<[PortfolioPerformanceIssueCode, number]>
  const blockingIssues = issues.filter(([issue]) => issue !== 'estimatedHistoricalRate')
  const estimatedCount = row.issueCounts.estimatedHistoricalRate ?? 0
  return (
    <div className="performance-completeness">
      <strong className={row.excludedStockCount > 0 ? 'is-warning' : 'is-complete'}>
        {row.excludedStockCount > 0
          ? `仅纳入 ${row.includedStockCount}/${row.stockCount} 只`
          : `${row.includedStockCount} 只完整`}
      </strong>
      {blockingIssues.map(([issue, count]) => (
        <small key={issue}>
          {PORTFOLIO_PERFORMANCE_ISSUE_LABELS[issue]} {count}
        </small>
      ))}
      {estimatedCount > 0 ? <small>含官方估算汇率 {estimatedCount}</small> : null}
    </div>
  )
}

function SummaryValue({
  label,
  value,
  note
}: {
  label: string
  value: number | null
  note?: string
}) {
  return (
    <span>
      <small>{label}</small>
      <strong className={valueClass(value)}>{formatMoneyProfit(value, 'CNY')}</strong>
      {note ? <em>{note}</em> : null}
    </span>
  )
}

export default function PortfolioPerformanceDialog({
  watchlist,
  quotes,
  accounts,
  exchangeRates,
  onClose
}: PortfolioPerformanceDialogProps) {
  const [dimension, setDimension] = useState<PerformanceDimension>('stock')
  const report = useMemo(
    () => calculatePortfolioPerformanceReport(watchlist, quotes, accounts, exchangeRates),
    [accounts, exchangeRates, quotes, watchlist]
  )
  const rows = useMemo(() => {
    if (dimension === 'stock') return report.stockRows
    if (dimension === 'market') return report.marketRows
    if (dimension === 'account') return report.accountRows
    if (dimension === 'currency') return report.currencyRows
    return [report.portfolioRow]
  }, [dimension, report])
  const portfolio = report.portfolioRow
  const taxFees = expenseValue(portfolio.cny)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return createPortal(
    <div
      className="portfolio-performance-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="portfolio-performance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-performance-title"
      >
        <header className="portfolio-performance-header">
          <span className="portfolio-performance-title-icon" aria-hidden="true">
            <ChartPie size={21} />
          </span>
          <span>
            <h2 id="portfolio-performance-title">跨市场收益分析</h2>
            <small>
              原币与人民币并列 · 汇率日期 {report.exchangeRateDate ?? '缺失'} · 默认账户
            </small>
          </span>
          <button
            className="icon-button portfolio-performance-close"
            type="button"
            onClick={onClose}
            aria-label="关闭跨市场收益分析"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        <div className="portfolio-performance-body">
          <div className="portfolio-performance-account-notice">
            <CircleAlert size={17} />
            <span>
              <strong>当前展示持仓收益，不是账户收益</strong>
              <small>{report.accountReturnReason}</small>
            </span>
          </div>

          <div className="portfolio-performance-summary">
            <SummaryValue
              label="人民币收益小计"
              value={portfolio.cny.totalProfit}
              note={
                portfolio.excludedStockCount > 0
                  ? `仅含 ${portfolio.includedStockCount} 只，排除 ${portfolio.excludedStockCount} 只`
                  : `${portfolio.includedStockCount} 只数据完整`
              }
            />
            <SummaryValue label="已实现收益" value={portfolio.cny.realizedProfit} />
            <SummaryValue label="未实现收益" value={portfolio.cny.unrealizedProfit} />
            <SummaryValue label="税前分红" value={portfolio.cny.dividendIncome} />
            <SummaryValue label="税费合计" value={taxFees} />
            <SummaryValue label="公司行动收益" value={portfolio.cny.corporateActionIncome} />
            <SummaryValue label="证券价格贡献" value={portfolio.cny.priceContribution} />
            <SummaryValue label="汇率贡献" value={portfolio.cny.exchangeRateContribution} />
          </div>

          <div className="portfolio-performance-attribution-note">
            证券价格贡献按历史加权购入汇率折算；汇率贡献按当前或卖出证券价值的汇率变化计算。分红、税费和公司行动现金单独列示。
          </div>

          <nav className="portfolio-performance-dimensions" aria-label="收益汇总维度">
            {(Object.keys(DIMENSION_LABELS) as PerformanceDimension[]).map((key) => (
              <button
                className={dimension === key ? 'is-active' : ''}
                type="button"
                key={key}
                onClick={() => setDimension(key)}
              >
                {DIMENSION_LABELS[key]}
              </button>
            ))}
          </nav>

          <div className="portfolio-performance-table-wrap">
            <table className="portfolio-performance-table">
              <thead>
                <tr>
                  <th>汇总对象</th>
                  <th>原币收益</th>
                  <th>人民币收益</th>
                  <th>已实现</th>
                  <th>未实现</th>
                  <th>税前分红</th>
                  <th>税费</th>
                  <th>公司行动</th>
                  <th>价格贡献</th>
                  <th>汇率贡献</th>
                  <th>完整性</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowTaxFees = expenseValue(row.cny)
                  return (
                    <tr key={`${row.scope}:${row.id}`}>
                      <td>
                        <span className="performance-row-label">
                          <strong>{row.label}</strong>
                          <small>{row.detail ?? `${row.stockCount} 只股票`}</small>
                        </span>
                      </td>
                      <td>
                        <NativeProfitCell slices={row.native} />
                      </td>
                      <td className={valueClass(row.cny.totalProfit)}>
                        {formatMoneyProfit(row.cny.totalProfit, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.realizedProfit)}>
                        {formatMoneyProfit(row.cny.realizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.unrealizedProfit)}>
                        {formatMoneyProfit(row.cny.unrealizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.dividendIncome)}>
                        {formatMoneyProfit(row.cny.dividendIncome, 'CNY')}
                      </td>
                      <td className={valueClass(rowTaxFees)}>
                        {formatMoneyProfit(rowTaxFees, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.corporateActionIncome)}>
                        {formatMoneyProfit(row.cny.corporateActionIncome, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.priceContribution)}>
                        {formatMoneyProfit(row.cny.priceContribution, 'CNY')}
                      </td>
                      <td className={valueClass(row.cny.exchangeRateContribution)}>
                        {formatMoneyProfit(row.cny.exchangeRateContribution, 'CNY')}
                      </td>
                      <td>
                        <IssueSummary row={row} />
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="portfolio-performance-empty" colSpan={11}>
                      当前没有可分析的持仓账本。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>,
    document.body
  )
}
