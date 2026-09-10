import { ChartPie, CircleAlert, History, PencilLine, RefreshCw, Save, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatMoneyProfit } from '../lib/format'
import {
  calculatePortfolioPerformanceReport,
  PORTFOLIO_PERFORMANCE_ISSUE_LABELS,
  type CnyProfitComponents,
  type NativePerformanceSlice,
  type PortfolioPerformanceAggregateSummary,
  type PortfolioPerformanceIssueCode
} from '../lib/portfolio-performance'
import type {
  ExchangeRateSettings,
  PortfolioPerformanceAdjustments,
  StockQuote,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import './PortfolioPerformanceDialog.css'
import PortfolioPerformanceCyclesDialog from './PortfolioPerformanceCyclesDialog'

interface PortfolioPerformanceDialogProps {
  watchlist: WatchStock[]
  quotes: StockQuote[]
  accounts: TTradingAccounts
  exchangeRates: ExchangeRateSettings
  adjustments: PortfolioPerformanceAdjustments
  onSaveAdjustments: (adjustments: PortfolioPerformanceAdjustments) => Promise<boolean>
  onRecalculateStock: (quoteId: string) => Promise<void>
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
            {formatMoneyProfit(slice.dividendIncome, slice.currency)} · 费用{' '}
            {formatMoneyProfit(nativeExpense(slice), slice.currency)} · 行动{' '}
            {formatMoneyProfit(slice.corporateActionIncome, slice.currency)}
            {slice.manualAdjustment !== 0 ? (
              <>
                {' · 调整 '}
                <span className={valueClass(slice.manualAdjustment)}>
                  {formatMoneyProfit(slice.manualAdjustment, slice.currency)}
                </span>
              </>
            ) : null}
          </small>
        </span>
      ))}
    </div>
  )
}

function IssueSummary({
  label,
  summary
}: {
  label: string
  summary: PortfolioPerformanceAggregateSummary
}) {
  const issues = Object.entries(summary.issueCounts) as Array<
    [PortfolioPerformanceIssueCode, number]
  >
  const blockingIssues = issues.filter(([issue]) => issue !== 'estimatedHistoricalRate')
  const estimatedCount = summary.issueCounts.estimatedHistoricalRate ?? 0
  return (
    <div className="performance-completeness">
      <strong className={summary.excludedStockCount > 0 ? 'is-warning' : 'is-complete'}>
        {label}：
        {summary.excludedStockCount > 0
          ? `仅纳入 ${summary.includedStockCount}/${summary.stockCount} 只`
          : `${summary.includedStockCount} 只完整`}
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
  adjustments,
  onSaveAdjustments,
  onRecalculateStock,
  onClose
}: PortfolioPerformanceDialogProps) {
  const [dimension, setDimension] = useState<PerformanceDimension>('stock')
  const [editingAdjustmentQuoteId, setEditingAdjustmentQuoteId] = useState<string | null>(null)
  const [adjustmentDraft, setAdjustmentDraft] = useState('')
  const [adjustmentError, setAdjustmentError] = useState('')
  const [savingAdjustments, setSavingAdjustments] = useState(false)
  const [recalculatingQuoteId, setRecalculatingQuoteId] = useState<string | null>(null)
  const [recalculationErrorQuoteId, setRecalculationErrorQuoteId] = useState<string | null>(null)
  const [cycleDetailQuoteId, setCycleDetailQuoteId] = useState<string | null>(null)
  const report = useMemo(
    () =>
      calculatePortfolioPerformanceReport(watchlist, quotes, accounts, exchangeRates, adjustments),
    [accounts, adjustments, exchangeRates, quotes, watchlist]
  )
  const rows = useMemo(() => {
    if (dimension === 'stock') return report.stockRows
    if (dimension === 'market') return report.marketRows
    if (dimension === 'account') return report.accountRows
    if (dimension === 'currency') return report.currencyRows
    return [report.portfolioRow]
  }, [dimension, report])
  const stocksByQuoteId = useMemo(
    () => new Map(report.stocks.map((stock) => [stock.quoteId, stock])),
    [report.stocks]
  )
  const watchlistByQuoteId = useMemo(
    () => new Map(watchlist.map((stock) => [stock.quoteId, stock])),
    [watchlist]
  )
  const quotesByQuoteId = useMemo(
    () => new Map(quotes.map((quote) => [quote.quoteId, quote])),
    [quotes]
  )
  const portfolio = report.portfolioRow
  const taxFees = expenseValue(portfolio.currentCycle.cny)
  const rawPortfolioProfit =
    portfolio.currentCycle.cny.totalProfit === null
      ? null
      : portfolio.currentCycle.cny.totalProfit - portfolio.currentCycle.cny.manualAdjustment
  const cycleDetailPerformance = cycleDetailQuoteId
    ? stocksByQuoteId.get(cycleDetailQuoteId)
    : undefined
  const cycleDetailStock = cycleDetailQuoteId
    ? watchlistByQuoteId.get(cycleDetailQuoteId)
    : undefined

  const openAdjustmentEditor = (quoteId: string) => {
    const stock = stocksByQuoteId.get(quoteId)
    if (!stock || stock.currentCycle.cny.totalProfit === null) return
    setAdjustmentDraft(stock.currentCycle.cny.totalProfit.toFixed(2))
    setAdjustmentError('')
    setEditingAdjustmentQuoteId(quoteId)
  }

  const closeAdjustmentEditor = () => {
    setEditingAdjustmentQuoteId(null)
    setAdjustmentDraft('')
    setAdjustmentError('')
  }

  const saveAdjustment = async () => {
    if (!editingAdjustmentQuoteId) return
    const stock = stocksByQuoteId.get(editingAdjustmentQuoteId)
    if (!stock) return
    const rawProfit =
      stock.currentCycle.cny.totalProfit === null
        ? null
        : stock.currentCycle.cny.totalProfit - stock.currentCycle.cny.manualAdjustment
    if (rawProfit === null) {
      setAdjustmentError('当前人民币收益计算不完整')
      return
    }

    const next = { ...adjustments }
    delete next[editingAdjustmentQuoteId]
    const draft = adjustmentDraft.trim()
    if (draft) {
      const targetProfit = Number(draft)
      if (!Number.isFinite(targetProfit)) {
        setAdjustmentError('请输入有效的人民币收益')
        return
      }
      const adjustment = Math.round((targetProfit - rawProfit) * 100) / 100
      if (adjustment !== 0) next[editingAdjustmentQuoteId] = adjustment
    }

    setSavingAdjustments(true)
    setAdjustmentError('')
    const saved = await onSaveAdjustments(next)
    setSavingAdjustments(false)
    if (saved) closeAdjustmentEditor()
    else setAdjustmentError('收益调整保存失败，请重试')
  }

  const recalculateStock = async (quoteId: string) => {
    setRecalculatingQuoteId(quoteId)
    setRecalculationErrorQuoteId(null)
    try {
      await onRecalculateStock(quoteId)
    } catch {
      setRecalculationErrorQuoteId(quoteId)
    } finally {
      setRecalculatingQuoteId(null)
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (cycleDetailQuoteId) {
        setCycleDetailQuoteId(null)
        return
      }
      if (editingAdjustmentQuoteId) {
        setEditingAdjustmentQuoteId(null)
        setAdjustmentDraft('')
        setAdjustmentError('')
        return
      }
      onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [cycleDetailQuoteId, editingAdjustmentQuoteId, onClose])

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
          <span className="portfolio-performance-title-copy">
            <span className="portfolio-performance-title-row">
              <h2 id="portfolio-performance-title">跨市场收益分析</h2>
              <span className="portfolio-performance-title-notice">
                <CircleAlert size={15} />
                <strong>当前展示持仓收益，不是账户收益</strong>
              </span>
            </span>
            <small>
              {report.accountReturnReason} · 汇率日期 {report.exchangeRateDate ?? '缺失'}
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
          <div className="portfolio-performance-summary">
            <SummaryValue
              label="当前周期收益小计"
              value={portfolio.currentCycle.cny.totalProfit}
              note={
                portfolio.currentCycle.cny.manualAdjustment !== 0 && rawPortfolioProfit !== null
                  ? `计算 ${formatMoneyProfit(rawPortfolioProfit, 'CNY')} · 调整 ${formatMoneyProfit(portfolio.currentCycle.cny.manualAdjustment, 'CNY')}`
                  : portfolio.currentCycle.excludedStockCount > 0
                    ? `仅含 ${portfolio.currentCycle.includedStockCount} 只，排除 ${portfolio.currentCycle.excludedStockCount} 只`
                    : `${portfolio.currentCycle.includedStockCount} 只数据完整`
              }
            />
            <SummaryValue
              label="累计收益小计"
              value={portfolio.cumulative.cny.totalProfit}
              note={
                portfolio.cumulative.cny.manualAdjustment !== 0
                  ? `含当前周期调整 ${formatMoneyProfit(portfolio.cumulative.cny.manualAdjustment, 'CNY')}`
                  : portfolio.cumulative.excludedStockCount > 0
                    ? `仅含 ${portfolio.cumulative.includedStockCount} 只，排除 ${portfolio.cumulative.excludedStockCount} 只`
                    : `${portfolio.cumulative.includedStockCount} 只数据完整`
              }
            />
            <SummaryValue label="已实现收益" value={portfolio.currentCycle.cny.realizedProfit} />
            <SummaryValue label="未实现收益" value={portfolio.currentCycle.cny.unrealizedProfit} />
            <SummaryValue label="税前分红" value={portfolio.currentCycle.cny.dividendIncome} />
            <SummaryValue label="费用合计" value={taxFees} />
            <SummaryValue
              label="公司行动收益"
              value={portfolio.currentCycle.cny.corporateActionIncome}
            />
            <SummaryValue
              label="证券价格贡献"
              value={portfolio.currentCycle.cny.priceContribution}
            />
            <SummaryValue
              label="汇率贡献"
              value={portfolio.currentCycle.cny.exchangeRateContribution}
            />
          </div>

          <div className="portfolio-performance-attribution-note">
            除累计收益小计和累计收益列外，其余收益分项均为当前或最近持仓周期。证券价格贡献按历史加权购入汇率折算；汇率贡献按当前或卖出证券价值的汇率变化计算。手动调整计入当前周期，并随周期汇总计入累计收益。
          </div>

          <nav className="portfolio-performance-dimensions" aria-label="收益汇总维度">
            {(Object.keys(DIMENSION_LABELS) as PerformanceDimension[]).map((key) => (
              <button
                className={dimension === key ? 'is-active' : ''}
                type="button"
                key={key}
                onClick={() => {
                  setDimension(key)
                  closeAdjustmentEditor()
                }}
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
                  <th>当前周期原币</th>
                  <th>当前周期收益</th>
                  <th>累计收益</th>
                  <th>已实现</th>
                  <th>未实现</th>
                  <th>税前分红</th>
                  <th>费用</th>
                  <th>公司行动</th>
                  <th>价格贡献</th>
                  <th>汇率贡献</th>
                  <th>完整性</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const currentCycle = row.currentCycle
                  const cumulative = row.cumulative
                  const rowTaxFees = expenseValue(currentCycle.cny)
                  const editableStock =
                    row.scope === 'stock' ? stocksByQuoteId.get(row.id) : undefined
                  const editingAdjustment = editingAdjustmentQuoteId === editableStock?.quoteId
                  const rawStockProfit = editableStock
                    ? editableStock.currentCycle.cny.totalProfit === null
                      ? null
                      : editableStock.currentCycle.cny.totalProfit -
                        editableStock.currentCycle.cny.manualAdjustment
                    : null
                  return (
                    <tr key={`${row.scope}:${row.id}`}>
                      <td>
                        <span className="performance-row-label">
                          <span className="performance-row-identity">
                            <strong>{row.label}</strong>
                            <small>{row.detail ?? `${currentCycle.stockCount} 只股票`}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <NativeProfitCell slices={currentCycle.native} />
                      </td>
                      <td className={valueClass(currentCycle.cny.totalProfit)}>
                        {editingAdjustment ? (
                          <form
                            className="performance-adjustment-editor"
                            onSubmit={(event) => {
                              event.preventDefault()
                              void saveAdjustment()
                            }}
                          >
                            <input
                              autoFocus
                              type="number"
                              step="0.01"
                              value={adjustmentDraft}
                              placeholder={rawStockProfit?.toFixed(2)}
                              aria-label={`${row.label}券商人民币持仓收益`}
                              title="留空后保存可恢复账本计算值"
                              onChange={(event) => setAdjustmentDraft(event.target.value)}
                            />
                            <button
                              type="submit"
                              disabled={savingAdjustments}
                              aria-label={`保存${row.label}人民币收益调整`}
                              title="保存"
                            >
                              <Save size={14} />
                            </button>
                            <button
                              type="button"
                              disabled={savingAdjustments}
                              aria-label={`取消${row.label}人民币收益调整`}
                              title="取消"
                              onClick={closeAdjustmentEditor}
                            >
                              <X size={14} />
                            </button>
                            {adjustmentError ? <small>{adjustmentError}</small> : null}
                          </form>
                        ) : (
                          <span className="performance-adjusted-total">
                            <span className="performance-adjusted-value">
                              {formatMoneyProfit(currentCycle.cny.totalProfit, 'CNY')}
                              {editableStock &&
                              editableStock.currentCycle.cny.totalProfit !== null ? (
                                <button
                                  className="performance-adjustment-edit"
                                  type="button"
                                  aria-label={`调整${row.label}人民币收益`}
                                  title="调整人民币收益"
                                  onClick={() => openAdjustmentEditor(editableStock.quoteId)}
                                >
                                  <PencilLine size={13} />
                                </button>
                              ) : null}
                            </span>
                            {currentCycle.cny.manualAdjustment !== 0 ? (
                              <small>
                                含调整{' '}
                                <span className={valueClass(currentCycle.cny.manualAdjustment)}>
                                  {formatMoneyProfit(currentCycle.cny.manualAdjustment, 'CNY')}
                                </span>
                              </small>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className={valueClass(cumulative.cny.totalProfit)}>
                        {formatMoneyProfit(cumulative.cny.totalProfit, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.realizedProfit)}>
                        {formatMoneyProfit(currentCycle.cny.realizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.unrealizedProfit)}>
                        {formatMoneyProfit(currentCycle.cny.unrealizedProfit, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.dividendIncome)}>
                        {formatMoneyProfit(currentCycle.cny.dividendIncome, 'CNY')}
                      </td>
                      <td className={valueClass(rowTaxFees)}>
                        {formatMoneyProfit(rowTaxFees, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.corporateActionIncome)}>
                        {formatMoneyProfit(currentCycle.cny.corporateActionIncome, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.priceContribution)}>
                        {formatMoneyProfit(currentCycle.cny.priceContribution, 'CNY')}
                      </td>
                      <td className={valueClass(currentCycle.cny.exchangeRateContribution)}>
                        {formatMoneyProfit(currentCycle.cny.exchangeRateContribution, 'CNY')}
                      </td>
                      <td>
                        <div className="performance-completeness-scopes">
                          <IssueSummary label="当前" summary={currentCycle} />
                          <IssueSummary label="累计" summary={cumulative} />
                        </div>
                      </td>
                      <td>
                        {editableStock ? (
                          <span className="performance-row-operation">
                            <button
                              className="performance-row-recalculate"
                              type="button"
                              disabled={recalculatingQuoteId !== null}
                              aria-label={`重新计算${row.label}收益`}
                              title="刷新该股票行情，并按当前交易账本重新计算"
                              onClick={() => void recalculateStock(editableStock.quoteId)}
                            >
                              <RefreshCw
                                size={13}
                                className={
                                  recalculatingQuoteId === editableStock.quoteId
                                    ? 'is-spinning'
                                    : undefined
                                }
                              />
                              <span>
                                {recalculatingQuoteId === editableStock.quoteId
                                  ? '计算中'
                                  : '重新计算'}
                              </span>
                            </button>
                            <button
                              className="performance-row-cycles"
                              type="button"
                              aria-label={`查看${row.label}所有持仓周期收益`}
                              title="查看所有持仓周期收益"
                              onClick={() => {
                                closeAdjustmentEditor()
                                setCycleDetailQuoteId(editableStock.quoteId)
                              }}
                            >
                              <History size={13} />
                              <span>周期明细</span>
                            </button>
                            {recalculationErrorQuoteId === editableStock.quoteId ? (
                              <small className="performance-row-recalculation-error">
                                重新计算失败，请重试
                              </small>
                            ) : null}
                          </span>
                        ) : (
                          <span className="performance-empty-value">--</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td className="portfolio-performance-empty" colSpan={13}>
                      当前没有可分析的持仓账本。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {cycleDetailPerformance && cycleDetailStock ? (
        <PortfolioPerformanceCyclesDialog
          stock={cycleDetailStock}
          performance={cycleDetailPerformance}
          quote={quotesByQuoteId.get(cycleDetailStock.quoteId)}
          account={accounts[cycleDetailStock.quoteId]}
          exchangeRates={exchangeRates}
          manualAdjustment={
            Number.isFinite(adjustments[cycleDetailStock.quoteId])
              ? adjustments[cycleDetailStock.quoteId]
              : 0
          }
          onClose={() => setCycleDetailQuoteId(null)}
        />
      ) : null}
    </div>,
    document.body
  )
}
