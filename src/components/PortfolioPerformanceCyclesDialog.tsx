import { History, X } from 'lucide-react'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { formatMoneyProfit } from '../lib/format'
import {
  calculatePortfolioPerformanceCycles,
  PORTFOLIO_PERFORMANCE_ISSUE_LABELS,
  type CnyProfitComponents,
  type PortfolioPerformanceCycleResult,
  type PortfolioPerformanceIssueCode,
  type PortfolioPerformanceStockResult
} from '../lib/portfolio-performance'
import type { ExchangeRateSettings, StockQuote, TTradingAccount, WatchStock } from '../shared/types'
import './PortfolioPerformanceCyclesDialog.css'

interface PortfolioPerformanceCyclesDialogProps {
  stock: WatchStock
  performance: PortfolioPerformanceStockResult
  quote?: StockQuote
  account?: TTradingAccount
  exchangeRates: ExchangeRateSettings
  manualAdjustment: number
  onClose: () => void
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

function formatCycleDate(value: string | undefined): string {
  return value ? value.slice(0, 10) : '--'
}

function formatShares(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function cycleLabel(cycle: PortfolioPerformanceCycleResult): string {
  if (cycle.sequence === 0) return '未归属事件'
  return `第 ${cycle.sequence} 期`
}

function cycleStatus(cycle: PortfolioPerformanceCycleResult): string {
  if (cycle.status === 'excluded') return '基准重置前'
  if (cycle.status === 'unassigned') return '未归属'
  if (cycle.status === 'open') return '持仓中'
  return '已清仓'
}

function CycleNativeProfit({ cycle }: { cycle: PortfolioPerformanceCycleResult }) {
  if (cycle.native.length === 0) return <span className="is-flat">--</span>
  return (
    <span className="performance-cycle-native-values">
      {cycle.native.map((slice) => (
        <strong className={valueClass(slice.totalProfit)} key={slice.currency}>
          {formatMoneyProfit(slice.totalProfit, slice.currency)}
        </strong>
      ))}
    </span>
  )
}

function CycleCompleteness({ cycle }: { cycle: PortfolioPerformanceCycleResult }) {
  const blockingIssues = cycle.issues.filter((issue) => issue !== 'estimatedHistoricalRate')
  return (
    <span className="performance-cycle-completeness">
      <strong className={cycle.complete ? 'is-complete' : 'is-warning'}>
        {cycle.complete ? '完整' : '不完整'}
      </strong>
      {blockingIssues.map((issue: PortfolioPerformanceIssueCode) => (
        <small key={issue}>{PORTFOLIO_PERFORMANCE_ISSUE_LABELS[issue]}</small>
      ))}
      {cycle.issues.includes('estimatedHistoricalRate') ? <small>含官方估算汇率</small> : null}
    </span>
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

export default function PortfolioPerformanceCyclesDialog({
  stock,
  performance,
  quote,
  account,
  exchangeRates,
  manualAdjustment,
  onClose
}: PortfolioPerformanceCyclesDialogProps) {
  const cycles = useMemo(
    () =>
      calculatePortfolioPerformanceCycles(stock, quote, account, exchangeRates, manualAdjustment),
    [account, exchangeRates, manualAdjustment, quote, stock]
  )
  const rows = useMemo(() => [...cycles].reverse(), [cycles])
  const includedCount = cycles.filter((cycle) => cycle.includedInCumulative).length
  const cumulative = performance.cumulative.cny
  const currentCycle = performance.currentCycle.cny
  const cumulativeExpense = expenseValue(cumulative)

  return createPortal(
    <div
      className="portfolio-performance-cycles-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="portfolio-performance-cycles-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-performance-cycles-title"
      >
        <header className="portfolio-performance-cycles-header">
          <span className="portfolio-performance-cycles-icon" aria-hidden="true">
            <History size={21} />
          </span>
          <span className="portfolio-performance-cycles-title-copy">
            <h2 id="portfolio-performance-cycles-title">{performance.name}持仓周期收益</h2>
            <small>
              {performance.code} · 共 {cycles.length} 个收益周期 · 当前累计纳入 {includedCount} 个
            </small>
          </span>
          <button
            className="icon-button portfolio-performance-cycles-close"
            type="button"
            aria-label="关闭持仓周期收益"
            title="关闭"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="portfolio-performance-cycles-body">
          <div className="portfolio-performance-cycles-summary">
            <SummaryValue
              label="累计收益"
              value={cumulative.totalProfit}
              note={
                cumulative.manualAdjustment !== 0
                  ? `含当前周期调整 ${formatMoneyProfit(cumulative.manualAdjustment, 'CNY')}`
                  : undefined
              }
            />
            <SummaryValue
              label={performance.quantity > 0 ? '当前周期收益' : '最近周期收益'}
              value={currentCycle.totalProfit}
            />
            <SummaryValue label="累计已实现" value={cumulative.realizedProfit} />
            <SummaryValue label="累计未实现" value={cumulative.unrealizedProfit} />
            <SummaryValue label="累计税前分红" value={cumulative.dividendIncome} />
            <SummaryValue label="累计费用" value={cumulativeExpense} />
            <SummaryValue label="累计公司行动" value={cumulative.corporateActionIncome} />
            <SummaryValue label="累计价格贡献" value={cumulative.priceContribution} />
            <SummaryValue label="累计汇率贡献" value={cumulative.exchangeRateContribution} />
          </div>

          <div className="portfolio-performance-cycles-note">
            累计收益从最近一次收益基准重置后开始计算；重置前周期仍保留展示，但不计入当前累计。
          </div>

          <div className="portfolio-performance-cycles-table-wrap">
            <table className="portfolio-performance-cycles-table">
              <thead>
                <tr>
                  <th>周期</th>
                  <th>状态</th>
                  <th>开始</th>
                  <th>结束</th>
                  <th>期末数量</th>
                  <th>原币收益</th>
                  <th>人民币收益</th>
                  <th>已实现</th>
                  <th>未实现</th>
                  <th>分红</th>
                  <th>费用</th>
                  <th>公司行动</th>
                  <th>价格贡献</th>
                  <th>汇率贡献</th>
                  <th>完整性</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cycle) => {
                  const expense = expenseValue(cycle.cny)
                  return (
                    <tr
                      key={cycle.id}
                      className={cycle.includedInCumulative ? undefined : 'is-excluded'}
                    >
                      <td>
                        <span className="performance-cycle-label">
                          <strong>{cycleLabel(cycle)}</strong>
                          {cycle.startedByPerformanceReset ? <small>收益基准重置</small> : null}
                        </span>
                      </td>
                      <td>
                        <span className={`performance-cycle-status is-${cycle.status}`}>
                          {cycleStatus(cycle)}
                        </span>
                      </td>
                      <td>{formatCycleDate(cycle.startedAt)}</td>
                      <td>{cycle.status === 'open' ? '持仓中' : formatCycleDate(cycle.endedAt)}</td>
                      <td>{formatShares(cycle.endingQuantity)}</td>
                      <td>
                        <CycleNativeProfit cycle={cycle} />
                      </td>
                      <td className={valueClass(cycle.cny.totalProfit)}>
                        {formatMoneyProfit(cycle.cny.totalProfit, 'CNY')}
                        {cycle.cny.manualAdjustment !== 0 ? (
                          <small className="performance-cycle-adjustment">
                            含调整 {formatMoneyProfit(cycle.cny.manualAdjustment, 'CNY')}
                          </small>
                        ) : null}
                      </td>
                      <td className={valueClass(cycle.cny.realizedProfit)}>
                        {formatMoneyProfit(cycle.cny.realizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(cycle.cny.unrealizedProfit)}>
                        {formatMoneyProfit(cycle.cny.unrealizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(cycle.cny.dividendIncome)}>
                        {formatMoneyProfit(cycle.cny.dividendIncome, 'CNY')}
                      </td>
                      <td className={valueClass(expense)}>{formatMoneyProfit(expense, 'CNY')}</td>
                      <td className={valueClass(cycle.cny.corporateActionIncome)}>
                        {formatMoneyProfit(cycle.cny.corporateActionIncome, 'CNY')}
                      </td>
                      <td className={valueClass(cycle.cny.priceContribution)}>
                        {formatMoneyProfit(cycle.cny.priceContribution, 'CNY')}
                      </td>
                      <td className={valueClass(cycle.cny.exchangeRateContribution)}>
                        {formatMoneyProfit(cycle.cny.exchangeRateContribution, 'CNY')}
                      </td>
                      <td>
                        <CycleCompleteness cycle={cycle} />
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="portfolio-performance-cycles-empty" colSpan={15}>
                      当前没有可查看的持仓周期。
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
