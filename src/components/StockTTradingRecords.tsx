import { PencilLine, RefreshCcw, Trash2, X } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatShares
} from '../lib/format'
import { getBatchTrades } from '../lib/trade-records'
import {
  calculateTBatchMetrics,
  getTradeBatchAllocationAmounts,
  resetTBatchPlans
} from '../lib/t-trading'
import { calculateTBatchCnyMetrics } from '../lib/t-batch-currency'
import {
  applyTAlertTriggers,
  getTPlanRows,
  handleTPlanAlert,
  restoreTPlanAlert,
  setTAlertEnabled,
  setTFloatingProfitAlertEnabled,
  setTFloatingProfitAlertThreshold,
  updateTPlanLevel,
  type TAlertSide
} from '../lib/t-alerts'
import {
  calibrateStockTCosts,
  deleteStockTBatch,
  deleteStockTTrade,
  previewStockTCostCalibration,
  settleStockTBatch,
  stockBatchAccounts,
  updateStockTBatch
} from '../lib/stock-t-trading'
import {
  batchCalibrationProfit,
  batchCalibrationProfitCny,
  getStockTBatches
} from '../shared/stock-t-batches'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import type {
  ExchangeRateSettings,
  MarketTradeFeeSettings,
  StockQuote,
  StockTradingBook,
  TPlanDefaultSettings,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeRecord,
  WatchStock
} from '../shared/types'
import { useConfirmDialog } from './ConfirmDialog'
import { TPlanTable } from './TPlanTable'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'
import { TradeSplitSource } from './TradeSplitSource'
import { AppInput, AppSwitch } from './AppFormControls'
import { AppButton } from './AppButton'
import './StockTTradingRecords.css'
import './TradingAccountPicker.css'

interface Props {
  book: StockTradingBook
  stock: WatchStock
  quote: StockQuote | undefined
  feeSettings: TTradingFeeSettings
  marketTradeFees: MarketTradeFeeSettings
  planDefaults: TPlanDefaultSettings
  exchangeRates: ExchangeRateSettings
  onApply: (book: StockTradingBook) => void
  onEditTrade: (trade: TTradeRecord) => void
  renderTradeEditor: (trade: TTrade, onComplete: () => void) => ReactNode
  baseLedger: ReactNode
}

function valueClass(value: number | null | undefined) {
  return value == null || value === 0 ? 'is-flat' : value > 0 ? 'is-up' : 'is-down'
}

function tradeTime(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}

function directionLabel(batch: TTradingBatch) {
  return batch.direction === 'reverse' ? '反T' : '正T'
}

function BatchTrades({
  book,
  batch,
  trades,
  onEdit,
  onDelete,
  renderTradeEditor
}: {
  book: StockTradingBook
  batch: TTradingBatch
  trades: readonly TTradeRecord[]
  onEdit: (trade: TTradeRecord) => void
  onDelete: (trade: TTradeRecord) => void
  renderTradeEditor?: Props['renderTradeEditor']
}) {
  const [showAll, setShowAll] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const finishEditing = useCallback(() => setEditingKey(null), [])
  const currency = currencyForMarket(marketFromQuoteId(book.quoteId))
  const descending = [...trades].reverse()
  return (
    <div className="t-trade-list">
      {(showAll ? descending : descending.slice(0, 5)).map((trade) => {
        const allocation = getTradeBatchAllocationAmounts(trade, batch)
        const owner = book.accounts[trade.accountId!]
        const opening = trade.side === (batch.direction === 'reverse' ? 'sell' : 'buy')
        const key = `${trade.accountId}:${trade.id}`
        const isEditing = editingKey === key
        return (
          <Fragment key={key}>
            <div className="t-trade-row">
              <span className={`t-trade-side is-${trade.side}`}>
                {batch.direction === 'reverse'
                  ? opening
                    ? '反T卖出'
                    : '回补买入'
                  : opening
                    ? 'T仓买入'
                    : 'T仓卖出'}
              </span>
              <span>
                <strong>
                  {formatShares(allocation.quantity)} × {formatPrice(trade.price)}
                </strong>
                <small>
                  {owner?.accountName ?? trade.accountId} · {tradeTime(trade.tradedAt)} · 费用{' '}
                  {formatMoney(allocation.fees, currency)}
                </small>
                {currency !== 'CNY' ? (
                  <small>
                    {trade.actualSettlementDate
                      ? `实际交收 ${trade.actualSettlementDate}`
                      : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}
                    {' · '}
                    {trade.feeSource === 'actual'
                      ? '券商实际'
                      : trade.feeTemplate
                        ? `模板估算 v${trade.feeTemplate.version}`
                        : '手动费用'}
                  </small>
                ) : null}
                {trade.splitSource ? (
                  <small>
                    <TradeSplitSource trade={trade} />
                  </small>
                ) : null}
              </span>
              <span className="t-trade-amount">
                <span>{formatMoney(trade.price * allocation.quantity, currency)}</span>
                <small>{trade.note || 'T仓交易'}</small>
              </span>
              <span className="t-trade-actions">
                <AppButton
                  variant="icon"
                  title={isEditing ? '取消编辑T仓交易' : '修改T仓交易'}
                  onClick={() => {
                    if (renderTradeEditor) setEditingKey(isEditing ? null : key)
                    else onEdit(trade)
                  }}
                >
                  {isEditing ? <X size={14} /> : <PencilLine size={14} />}
                </AppButton>
                <button
                  className="icon-button"
                  type="button"
                  title="删除T仓交易"
                  onClick={() => onDelete(trade)}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
            {isEditing && renderTradeEditor ? (
              <div className="t-trade-inline-editor">{renderTradeEditor(trade, finishEditing)}</div>
            ) : null}
          </Fragment>
        )
      })}
      {trades.length > 5 ? (
        <button
          className="t-trade-more-button"
          type="button"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? '收起交易流水' : `显示更多交易流水（其余 ${trades.length - 5} 条）`}
        </button>
      ) : null}
    </div>
  )
}

function ActiveBatchCard({
  batch,
  props,
  onChange,
  onSettle,
  onDelete
}: {
  batch: TTradingBatch
  props: Props
  onChange: (batch: TTradingBatch) => void
  onSettle: (note: string) => void
  onDelete: (trade: TTradeRecord) => void
}) {
  const { book, stock, quote, feeSettings, marketTradeFees, planDefaults, exchangeRates } = props
  const [note, setNote] = useState('')
  const [planError, setPlanError] = useState('')
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)
  const trades = useMemo(() => getBatchTrades(book, batch), [book, batch])
  const metrics = useMemo(
    () => calculateTBatchMetrics(batch, trades, quote?.latest),
    [batch, trades, quote?.latest]
  )
  const accounts = stockBatchAccounts(book, batch)
  const cny =
    market === 'CN'
      ? null
      : calculateTBatchCnyMetrics(
          batch,
          trades,
          market,
          quote?.latest,
          exchangeRateForCurrency(exchangeRates, currency)
        )
  const fees = trades.reduce(
    (sum, trade) => sum + getTradeBatchAllocationAmounts(trade, batch).fees,
    0
  )
  const change = (next: TTradingBatch) =>
    onChange(
      applyTAlertTriggers(next, trades, quote?.latest, {
        market,
        instrumentType: stock.instrumentType
      }).batch!
    )
  const planRows = (side: TAlertSide) =>
    getTPlanRows(batch, trades, side, feeSettings, stock.marketLabel, {
      market,
      marketTradeFees,
      stampDutyExempt: stock.instrumentType === 'etf',
      instrumentType: stock.instrumentType
    })
  const closingQuantity = (
    metrics.direction === 'reverse' ? (batch.buyLevels ?? []) : batch.sellLevels
  ).reduce((sum, level) => sum + level.quantity, 0)
  const updateBoardLotSize = (raw: string) => {
    const size = raw === '' ? undefined : Number(raw)
    if (size !== undefined && (!Number.isInteger(size) || size <= 0)) {
      setPlanError('每手股数须为正整数')
      return
    }
    setPlanError('')
    props.onApply({ ...book, boardLotSize: size })
  }
  return (
    <div className="t-account-records">
      <section className="t-card t-active-batch-card is-full-width">
        <div className="t-card-heading">
          <span>
            <strong>
              {directionLabel(batch)}批次 #{batch.sequence}
            </strong>
            <small>
              {accounts.map((account) => account.accountName).join(' · ')} · 开始于{' '}
              {tradeTime(batch.openedAt)}
            </small>
          </span>
          <div
            className="t-floating-profit-alert-inline"
            title="浮动盈亏达到正负阈值时提醒，回到区间后自动恢复"
          >
            <AppSwitch
              className="t-alert-toggle"
              label="浮动盈亏提醒"
              checked={Boolean(batch.floatingProfitAlert?.enabled)}
              onChange={(event) =>
                change(setTFloatingProfitAlertEnabled(batch, event.target.checked))
              }
              aria-label="启用浮动盈亏提醒"
            />
            <label className="t-floating-profit-alert-threshold">
              <span>±</span>
              <AppInput
                type="number"
                min="1"
                step="1"
                value={batch.floatingProfitAlert?.threshold ?? 100}
                onChange={(event) =>
                  change(setTFloatingProfitAlertThreshold(batch, Number(event.target.value)))
                }
                aria-label="浮动盈亏提醒阈值"
              />
              <em>{currency === 'CNY' ? '元' : currency}</em>
            </label>
            <TFloatingProfitAlertBadge
              batch={batch}
              floatingProfit={metrics.floatingProfit}
              currency={currency}
              compact
            />
          </div>
          <div className="t-batch-summary">
            <span>
              <small>{metrics.direction === 'reverse' ? '待回补数量' : '当前T仓'}</small>
              <strong>{formatShares(metrics.remainingQuantity)}</strong>
            </span>
            <span>
              <small>{metrics.direction === 'reverse' ? '平均卖出净价' : 'T仓平均成本'}</small>
              <strong>{formatCost(metrics.averageCost)}</strong>
            </span>
            <span>
              <small>流水收益</small>
              <strong className={valueClass(metrics.realizedProfit)}>
                {formatMoneyProfit(metrics.realizedProfit, currency)}
              </strong>
            </span>
            <span>
              <small>浮动收益</small>
              <strong className={valueClass(metrics.floatingProfit)}>
                {formatMoneyProfit(metrics.floatingProfit, currency)}
                <small
                  className={`t-floating-profit-rate ${valueClass(metrics.floatingProfitRate)}`}
                >
                  {formatPercent(metrics.floatingProfitRate)}
                </small>
              </strong>
            </span>
            <span>
              <small>本批次费用</small>
              <strong>{formatMoney(fees, currency)}</strong>
            </span>
            <em>{trades.length} 笔流水</em>
          </div>
        </div>
        {cny ? (
          <div className="t-batch-cny-summary">
            <span>
              人民币流水收益{' '}
              <strong className={valueClass(cny.realizedProfit)}>
                {formatMoneyProfit(cny.realizedProfit, 'CNY')}
              </strong>
            </span>
            <span>
              人民币浮动收益{' '}
              <strong className={valueClass(cny.floatingProfit)}>
                {formatMoneyProfit(cny.floatingProfit, 'CNY')}
              </strong>
            </span>
            <span>
              价格贡献{' '}
              <strong className={valueClass(cny.priceContribution)}>
                {formatMoneyProfit(cny.priceContribution, 'CNY')}
              </strong>
            </span>
            <span>
              汇率贡献{' '}
              <strong className={valueClass(cny.exchangeRateContribution)}>
                {formatMoneyProfit(cny.exchangeRateContribution, 'CNY')}
              </strong>
            </span>
            {cny.missingHistoricalRate || cny.missingCurrentRate ? (
              <small>部分收益缺少汇率，暂无法完整折算</small>
            ) : null}
          </div>
        ) : null}
        <BatchTrades
          book={book}
          batch={batch}
          trades={trades}
          onEdit={props.onEditTrade}
          onDelete={onDelete}
        />
      </section>
      <section className="t-card t-dual-plan-card">
        <div className="t-card-heading">
          <span>
            <strong>当前T仓双五档计划</strong>
            <small>按录入账户的费用设置估算计划收益</small>
          </span>
          <div className="t-plan-heading-actions">
            <label className="t-alert-toggle">
              <input
                type="checkbox"
                checked={Boolean(batch.alertEnabled)}
                onChange={(event) => change(setTAlertEnabled(batch, event.target.checked))}
              />
              <i />
              价格提醒
            </label>
            <button
              className="text-button"
              type="button"
              onClick={() => change(resetTBatchPlans(batch, trades, planDefaults, market))}
            >
              <RefreshCcw size={13} />
              重置双五档
            </button>
          </div>
        </div>
        {market === 'HK' ? (
          <div className="t-plan-market-options">
            <label>
              每手股数{' '}
              <input
                type="number"
                min="1"
                step="100"
                value={book.boardLotSize ?? ''}
                onChange={(event) => updateBoardLotSize(event.target.value)}
              />
            </label>
            {book.boardLotSize &&
            [...(batch.buyLevels ?? []), ...batch.sellLevels].some(
              (level) => level.quantity > 0 && level.quantity % book.boardLotSize! !== 0
            ) ? (
              <small>部分计划数量不足整手，可能需要通过碎股交易处理。</small>
            ) : null}
          </div>
        ) : null}
        {closingQuantity > metrics.remainingQuantity ? (
          <div className="t-form-error">平仓计划数量超过当前剩余数量，请调整计划数量。</div>
        ) : null}
        {planError ? <div className="t-form-error">{planError}</div> : null}
        <div className="t-plan-scroll">
          <div className="t-plan-grid">
            {(['buy', 'sell'] as const).map((side) => (
              <TPlanTable
                key={side}
                side={side}
                rows={planRows(side)}
                currency={currency}
                minimumQuantity={market === 'CN' ? 100 : 1}
                alertEnabled={Boolean(batch.alertEnabled)}
                emphasized={metrics.direction === 'reverse' ? side === 'buy' : side === 'sell'}
                openingPlan={metrics.direction === 'reverse' ? side === 'sell' : side === 'buy'}
                onUpdateLevel={(index, key, value) =>
                  change(updateTPlanLevel(batch, side, index, key, value))
                }
                onHandleAlert={(index) => change(handleTPlanAlert(batch, side, index))}
                onRestoreAlert={(index) => change(restoreTPlanAlert(batch, side, index))}
              />
            ))}
          </div>
        </div>
      </section>
      {trades.length > 0 && metrics.remainingQuantity === 0 ? (
        <section className="t-card t-settlement-card">
          <div className="t-card-heading">
            <span>
              <strong>本批次已完成</strong>
              <small>各账户持仓已按各自成交流水更新，可以结算本批次。</small>
            </span>
          </div>
          <div className="t-entry-actions">
            <input
              className="t-settlement-note-input"
              aria-label="批次结算备注"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="结算备注（选填）"
            />
            <button
              className="primary-button compact-button"
              type="button"
              onClick={() => onSettle(note)}
            >
              结算批次
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function StockTTradingRecords(props: Props) {
  const { book, stock, quote, onApply, onEditTrade, planDefaults, exchangeRates, baseLedger } =
    props
  const confirm = useConfirmDialog()
  const [error, setError] = useState('')
  const [calibratingId, setCalibratingId] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(0)
  const batches = useMemo(() => getStockTBatches(book), [book])
  const active = batches.filter((batch) => !batch.settlement)
  const history = batches
    .filter((batch) => batch.settlement)
    .sort((left, right) => right.settlement!.settledAt.localeCompare(left.settlement!.settledAt))
  const pageCount = Math.ceil(history.length / 10)
  const page = Math.min(historyPage, Math.max(0, pageCount - 1))
  const calibrationBatch = history.find((batch) => batch.id === calibratingId)
  const closeCalibration = useCallback(() => setCalibratingId(null), [])
  const currency =
    stock.currency ?? currencyForMarket(stock.market ?? marketFromQuoteId(stock.quoteId))
  const apply = (update: () => StockTradingBook) => {
    try {
      onApply(update())
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const deleteTrade = (trade: TTradeRecord) =>
    apply(() => deleteStockTTrade(book, trade, planDefaults))
  const deleteBatch = async (batch: TTradingBatch) => {
    if (
      !(await confirm({
        title: '删除做T历史批次',
        message: `确定删除批次 #${batch.sequence} 的全部账户交易及成本校准记录吗？删除后无法恢复。`,
        confirmLabel: '删除批次',
        tone: 'danger'
      }))
    )
      return
    apply(() => deleteStockTBatch(book, batch, planDefaults))
  }
  return (
    <>
      {error ? <div className="t-form-error t-stock-records-error">{error}</div> : null}
      {active.map((batch) => (
        <ActiveBatchCard
          key={batch.id}
          batch={batch}
          props={props}
          onChange={(next) => apply(() => updateStockTBatch(book, next))}
          onSettle={(note) => apply(() => settleStockTBatch(book, batch, note))}
          onDelete={deleteTrade}
        />
      ))}
      <div className="t-trading-ledger-history">
        {baseLedger}
        {history.length ? (
          <section className="t-card t-history-card">
            <div className="t-card-heading">
              <span>
                <strong>做T历史</strong>
                <small>共完成 {history.length} 个批次</small>
              </span>
              {pageCount > 1 ? (
                <div className="t-history-pagination">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setHistoryPage(page - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {page + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={page === pageCount - 1}
                    onClick={() => setHistoryPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>
            <div className="t-history-list">
              {history.slice(page * 10, (page + 1) * 10).map((batch) => {
                const trades = getBatchTrades(book, batch)
                const metrics = calculateTBatchMetrics(batch, trades, quote?.latest)
                const adjustment = batchCalibrationProfit(batch)
                const finalProfit = batch.settlement!.finalProfit
                const market = stock.market ?? marketFromQuoteId(stock.quoteId)
                const cny =
                  market === 'CN'
                    ? null
                    : calculateTBatchCnyMetrics(
                        batch,
                        trades,
                        market,
                        quote?.latest,
                        exchangeRateForCurrency(exchangeRates, currency)
                      )
                const calibrationCny = batchCalibrationProfitCny(batch)
                const finalCny =
                  cny?.realizedProfit != null && calibrationCny !== null
                    ? cny.realizedProfit + calibrationCny
                    : null
                return (
                  <details key={batch.id}>
                    <summary>
                      <span>
                        <strong>
                          {directionLabel(batch)}批次 #{batch.sequence}
                        </strong>
                        <small>
                          {tradeTime(batch.openedAt)} 至 {tradeTime(batch.settlement!.settledAt)} ·{' '}
                          {trades.length} 笔流水
                        </small>
                      </span>
                      <span>
                        <strong className={valueClass(finalProfit)}>
                          {formatMoneyProfit(finalProfit, currency)}
                        </strong>
                        <small>
                          {batch.settlement!.source === 'position-cost'
                            ? '成本校准收益'
                            : '流水收益'}
                        </small>
                      </span>
                    </summary>
                    <div>
                      <BatchTrades
                        book={book}
                        batch={batch}
                        trades={trades}
                        onEdit={onEditTrade}
                        onDelete={deleteTrade}
                        renderTradeEditor={props.renderTradeEditor}
                      />
                      <div className="t-history-settlement">
                        <p>
                          流水收益{' '}
                          <strong className={valueClass(metrics.realizedProfit)}>
                            {formatMoneyProfit(metrics.realizedProfit, currency)}
                          </strong>
                          {' · '}累计校准{' '}
                          <strong className={valueClass(adjustment)}>
                            {formatMoneyProfit(adjustment, currency)}
                          </strong>
                        </p>
                        {cny ? (
                          <p>
                            人民币流水收益{' '}
                            <strong className={valueClass(cny.realizedProfit)}>
                              {formatMoneyProfit(cny.realizedProfit, 'CNY')}
                            </strong>
                            {' · '}人民币校准后收益{' '}
                            <strong className={valueClass(finalCny)}>
                              {formatMoneyProfit(finalCny, 'CNY')}
                            </strong>
                          </p>
                        ) : null}
                        {batch.settlement!.note ? <p>{batch.settlement!.note}</p> : null}
                        {(batch.costCalibrations ?? []).map((calibration) => (
                          <details className="t-cost-calibration-history" key={calibration.id}>
                            <summary>
                              <span>{tradeTime(calibration.createdAt)} 成本校准</span>
                              <strong className={valueClass(calibration.profitAdjustment)}>
                                {formatMoneyProfit(calibration.profitAdjustment, currency)}
                              </strong>
                            </summary>
                            <div>
                              {calibration.accounts.map((account) => (
                                <small key={account.accountId}>
                                  {account.accountName} · {formatShares(account.quantity)} ·{' '}
                                  {formatCost(account.costBefore)} → {formatCost(account.costAfter)}
                                </small>
                              ))}
                            </div>
                          </details>
                        ))}
                        <div className="t-history-actions">
                          <button
                            className="text-button bordered-text-button"
                            type="button"
                            onClick={() => setCalibratingId(batch.id)}
                          >
                            校准批次收益
                          </button>
                          <button
                            className="text-button t-history-delete-button"
                            type="button"
                            onClick={() => void deleteBatch(batch)}
                          >
                            删除此批次
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
      {calibrationBatch ? (
        <BatchCostCalibrationDialog
          key={calibrationBatch.id}
          book={book}
          batch={calibrationBatch}
          exchangeRates={exchangeRates}
          planDefaults={planDefaults}
          onApply={onApply}
          onClose={closeCalibration}
        />
      ) : null}
    </>
  )
}

function BatchCostCalibrationDialog({
  book,
  batch,
  exchangeRates,
  planDefaults,
  onApply,
  onClose
}: {
  book: StockTradingBook
  batch: TTradingBatch
  exchangeRates: ExchangeRateSettings
  planDefaults: TPlanDefaultSettings
  onApply: (book: StockTradingBook) => void
  onClose: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const accounts = stockBatchAccounts(book, batch)
  const [costs, setCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      accounts.map((account) => [account.accountId!, (account.position?.cost ?? 0).toString()])
    )
  )
  const currency = currencyForMarket(marketFromQuoteId(book.quoteId))
  const ledgerProfit = calculateTBatchMetrics(batch, getBatchTrades(book, batch)).realizedProfit
  let preview: ReturnType<typeof previewStockTCostCalibration> | undefined
  try {
    preview = previewStockTCostCalibration(book, batch, costs)
  } catch {
    /* 输入未完成时不显示校准结果。 */
  }
  const currentProfit = ledgerProfit + batchCalibrationProfit(batch)
  const close = useCallback(() => {
    closeButtonRef.current?.focus()
    setClosing(true)
  }, [])
  useEffect(() => {
    const element = dialogRef.current
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.querySelector<HTMLElement>('input:not(:disabled), button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
      if (event.key !== 'Tab') return
      const controls = element?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled)'
      )
      if (!controls?.length) return
      const first = controls[0],
        last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      document.body.style.overflow = previousOverflow
      requestAnimationFrame(() => {
        if (!element?.isConnected && previousFocus?.isConnected) previousFocus.focus()
      })
    }
  }, [close])
  const save = () => {
    try {
      onApply(calibrateStockTCosts(book, batch, costs, exchangeRates, planDefaults))
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  return createPortal(
    <div
      className={`trading-account-picker-backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation()
        close()
      }}
    >
      <section
        ref={dialogRef}
        className={`trading-account-picker-dialog t-cost-calibration-dialog${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onAnimationEnd={(event) => {
          if (
            closing &&
            event.target === event.currentTarget &&
            event.animationName === 'trading-account-picker-out'
          )
            onClose()
        }}
      >
        <header className="trading-account-picker-header">
          <div>
            <h2 id={titleId}>校准批次 #{batch.sequence} 收益</h2>
            <p>分别填写本批次各账户的最新成本，保存后更新账户成本和批次收益。</p>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="关闭收益校准"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!closing) save()
          }}
        >
          <div className="t-cost-calibration-accounts">
            <div className="t-cost-calibration-row is-heading">
              <span>账户</span>
              <span>当前数量</span>
              <span>校准前成本</span>
              <span>新成本</span>
            </div>
            {accounts.map((account) => (
              <div className="t-cost-calibration-row" key={account.accountId}>
                <strong>{account.accountName}</strong>
                <span>{formatShares(account.position?.quantity ?? 0)}</span>
                <span>{formatCost(account.position?.cost ?? 0)}</span>
                {account.position?.quantity ? (
                  <input
                    aria-label={`${account.accountName} 新的每股成本`}
                    type="number"
                    min="0"
                    step="0.0001"
                    value={costs[account.accountId!] ?? ''}
                    disabled={closing}
                    onChange={(event) =>
                      setCosts((current) => ({
                        ...current,
                        [account.accountId!]: event.target.value
                      }))
                    }
                  />
                ) : (
                  <span>已清仓</span>
                )}
              </div>
            ))}
          </div>
          <div className="t-cost-calibration-preview">
            <span>
              <small>流水收益</small>
              <strong className={valueClass(ledgerProfit)}>
                {formatMoneyProfit(ledgerProfit, currency)}
              </strong>
            </span>
            <span>
              <small>已有校准差额</small>
              <strong className={valueClass(batchCalibrationProfit(batch))}>
                {formatMoneyProfit(batchCalibrationProfit(batch), currency)}
              </strong>
            </span>
            <span>
              <small>本次校准差额</small>
              <strong className={valueClass(preview?.profitAdjustment)}>
                {formatMoneyProfit(preview?.profitAdjustment, currency)}
              </strong>
            </span>
            <span>
              <small>校准后收益</small>
              <strong
                className={valueClass(preview ? currentProfit + preview.profitAdjustment : null)}
              >
                {formatMoneyProfit(
                  preview ? currentProfit + preview.profitAdjustment : null,
                  currency
                )}
              </strong>
            </span>
          </div>
          {error ? <div className="t-form-error">{error}</div> : null}
          <footer className="t-cost-calibration-actions">
            <button className="text-button" type="button" onClick={close}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={closing || !preview}>
              保存校准
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
