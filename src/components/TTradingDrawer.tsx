import {
  calculateAccountTradeFees,
  getAccountTradeFeeContext,
  reestimateTradeExecution,
  type AccountTradeFeeContext
} from '../lib/account-trade-fees'
import { PencilLine, Plus, Repeat2, Trash2, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCost,
  formatCurrency,
  formatMoney,
  formatMoneyProfit,
  formatPrice,
  formatProfit,
  formatShares
} from '../lib/format'
import { handleTriggeredTPlanAlertsForTrade } from '../lib/t-alerts'
import {
  estimateSettlementDate,
  marketFeeTemplateForTradeDate,
  marketTradeQuantityError,
  settlementRuleForTradeDate
} from '../lib/market-trades'
import {
  calculateTBatchMetrics,
  createTPlanLevelsFromDefaults,
  getTBatchDirection,
  rebalanceTBatchPlans,
  roundMoney,
  getTradeBatchAllocationAmounts,
  totalRecordedTradeFees,
  validateTBatchTrades
} from '../lib/t-trading'
import {
  detachTradeRecordsFromBatch,
  getTradeAllocations,
  getBatchTrades,
  hasTAllocationForBatch,
  isIndependentBaseTrade,
  sortTBatchTrades,
  toTradeRecord,
  tradeReferencesBatch,
  upsertTradeRecord
} from '../lib/trade-records'
import {
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from '../lib/portfolio-ledger'
import { deleteIndependentBaseTrade, upsertIndependentBaseTrade } from '../lib/base-trades'
import { createInitialPositionAccount } from '../lib/position-ledger'
import { splitTradeForOverflow } from '../lib/split-trade'
import { TradeSplitSource } from './TradeSplitSource'
import { TradingAccountPicker } from './TradingAccountPicker'
import { useSecuritiesAccountState } from './SecuritiesAccountContext'
import {
  accountFeeSettings,
  defaultAccountId,
  listAccountsForMarket,
  listStockAccountBooks,
  resolveAccountSelection
} from '../shared/stock-accounts'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { StockTTradingRecords } from './StockTTradingRecords'
import {
  batchCalibrationProfit,
  getActiveStockTBatches,
  getStockTBatches
} from '../shared/stock-t-batches'
import { mergeStockTAccount, stockBatchAccounts, toStockTradingBook } from '../lib/stock-t-trading'
import { calculateTBatchForecastMetrics } from '../lib/t-trade-forecast'
import { AppSelect } from './AppSelect'
import { AppButton } from './AppButton'
import { AppInput } from './AppFormControls'
import type {
  CashDividendLedgerEntry,
  ExchangeRateSettings,
  MarketTradeFeeSettings,
  PortfolioLedgerEntry,
  StockPosition,
  StockQuote,
  StockTradingBook,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeSide,
  TradingCalendarSettings,
  WithholdingTaxLedgerEntry,
  WatchStock
} from '../shared/types'
import { appendPortfolioLedgerEntries, withLedgerTradeRecords } from '../shared/types'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { marketDateTimeInput } from '../shared/market-hours'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'

export interface TTradingDrawerProps {
  initialAccountId?: string
  stock: WatchStock
  quote: StockQuote | undefined
  account: StockTradingBook | TTradingAccount | undefined
  holdingCost: number | null | undefined
  holdingCostBasis: number | null | undefined
  feeSettings: TTradingFeeSettings
  marketTradeFees: MarketTradeFeeSettings
  planDefaults: TPlanDefaultSettings
  tradingCalendar: TradingCalendarSettings
  exchangeRates: ExchangeRateSettings
  floatingProfitAlertDefaultThreshold: number
  onApply: (account: TTradingAccount, position: StockPosition | undefined) => void
  onApplyBook: (book: StockTradingBook) => void
  onClose: () => void
}

interface TTradeEntryProps extends Omit<TTradingDrawerProps, 'account'> {
  account: TTradingAccount
  accountDisabled: boolean
  feeContext: AccountTradeFeeContext
  stockBook: StockTradingBook
  entryAccountSelect?: ReactNode
  entryBatchSelect?: ReactNode
  clearEntry?: boolean
  tradeToEdit?: TTrade
  onEditComplete?: () => void
  inline?: boolean
}

type OverflowDisposition = 'base' | 'opposite-t'
type EntryMode = 'trade' | 'cash'
type CashEntryKind = 'cashDividend' | 'withholdingTax'
type CashLedgerEntry = CashDividendLedgerEntry | WithholdingTaxLedgerEntry

function emptyFees(): TTradeFees {
  return { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
}

function tradeFeeSourceLabel(trade: TTrade): string {
  if (trade.feeSource === 'actual' || trade.feeItems?.some((item) => item.code === 'manual')) {
    return '券商实际'
  }
  if (trade.feeTemplate) return `模板估算 v${trade.feeTemplate.version}`
  return trade.feeSource === 'estimated' ? '模板估算' : '来源未标记'
}

function positionSnapshot(position: StockPosition | undefined) {
  return position
    ? { quantity: position.quantity, cost: position.cost, openedOn: position.openedOn }
    : undefined
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatOverviewValue(
  value: number | null | undefined,
  formatter: (value: number) => string
): string {
  return value ? formatter(value) : '-'
}

function formatTradeTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function batchDirectionLabel(batch: TTradingBatch | undefined): string {
  return getTBatchDirection(batch) === 'reverse' ? '反T' : '正T'
}

function spansMultipleBatches(trade: TTrade): boolean {
  return (
    new Set(
      (trade.allocations ?? [])
        .map((allocation) => allocation.batchId)
        .filter((batchId): batchId is string => Boolean(batchId))
    ).size > 1
  )
}

function isCashLedgerEntry(entry: PortfolioLedgerEntry): entry is CashLedgerEntry {
  return entry.kind === 'cashDividend' || entry.kind === 'withholdingTax'
}

function cashLedgerAmount(entry: CashLedgerEntry): number {
  return entry.kind === 'cashDividend' ? entry.amount : -entry.amount
}

function cashLedgerSourceLabel(entry: CashLedgerEntry): string {
  if (entry.source === 'manual') return '手工录入'
  if (entry.source === 'corporateAction') return '公司行动'
  if (entry.source === 'brokerImport') return '券商导入'
  return '交易录入'
}

type BaseLedgerItem = {
  account: TTradingAccount
  occurredAt: string
} & ({ kind: 'trade'; trade: TTrade } | { kind: 'cash'; entry: CashLedgerEntry })

interface TBaseLedgerCardProps extends Pick<TTradingDrawerProps, 'stock' | 'onApply'> {
  accounts: readonly TTradingAccount[]
  renderTradeEditor: (trade: TTrade, onComplete: () => void) => ReactNode
}

function TBaseLedgerCard({ accounts, stock, onApply, renderTradeEditor }: TBaseLedgerCardProps) {
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)
  const [showAllEntries, setShowAllEntries] = useState(false)
  const [error, setError] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const finishEditing = useCallback(() => setEditingKey(null), [])
  const entries = useMemo(
    () =>
      accounts
        .flatMap<BaseLedgerItem>((account) => [
          ...account.tradeRecords.filter(isIndependentBaseTrade).map((trade) => ({
            kind: 'trade' as const,
            occurredAt: trade.tradedAt,
            account,
            trade
          })),
          ...activePortfolioLedgerEntries(account)
            .filter(isCashLedgerEntry)
            .reverse()
            .map((entry) => ({
              kind: 'cash' as const,
              occurredAt: entry.occurredAt,
              account,
              entry
            }))
        ])
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    [accounts]
  )
  const visibleEntries = showAllEntries ? entries : entries.slice(0, 5)
  const cashEntries = entries.filter((item) => item.kind === 'cash')
  const cashNetAmount = cashEntries.reduce((total, item) => total + cashLedgerAmount(item.entry), 0)
  const formatNativeAmount = (value: number) =>
    currency === 'CNY' ? formatCurrency(value) : formatMoney(value, currency)
  const formatNativeProfit = (value: number) =>
    currency === 'CNY' ? formatProfit(value) : formatMoneyProfit(value, currency)

  const editTrade = (account: TTradingAccount, trade: TTrade) => {
    if (spansMultipleBatches(trade)) {
      setError('跨批次成交如需调整，请先删除该成交后重新录入')
      return
    }
    setError('')
    setEditingKey(`${account.accountId}:${trade.id}`)
  }

  const deleteTrade = (account: TTradingAccount, trade: TTrade) => {
    const result = deleteIndependentBaseTrade(account, trade.id, market, currency, account.position)
    if (result.error) {
      setError(`删除后账本不完整：${result.error}`)
      return
    }
    onApply(result.account, result.position)
    setError('')
  }

  const deleteCashEntry = (account: TTradingAccount, entry: CashLedgerEntry) => {
    if (entry.source === 'corporateAction' || entry.corporateActionId) {
      setError('公司行动产生的流水请在公司行动中撤销')
      return
    }
    const nextAccount = {
      ...account,
      ledger: {
        ...account.ledger,
        entries: account.ledger.entries.filter((item) => item.id !== entry.id)
      }
    }
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setError(`完整账本校验失败：${replay.error}`)
      return
    }
    onApply(nextAccount, replay.position)
    setError('')
  }

  if (entries.length === 0) return null

  return (
    <section className="t-card t-base-ledger-card">
      <div className="t-card-heading">
        <span>
          <strong>底仓流水</strong>
          <small>底仓交易及分红缴税均不归属 T 批次，现金流水不改变持仓数量和成本</small>
        </span>
        <div className="t-batch-summary">
          {cashEntries.length > 0 ? (
            <span>
              <small>现金净收入</small>
              <strong className={valueClass(cashNetAmount)}>
                {formatNativeProfit(cashNetAmount)}
              </strong>
            </span>
          ) : null}
          <em>{entries.length} 笔流水</em>
        </div>
      </div>
      <div className="t-trade-list">
        {visibleEntries.map((item) => {
          const { account } = item
          const accountId = account.accountId ?? defaultAccountId(market)
          if (item.kind === 'cash') {
            const { entry } = item
            const signedAmount = cashLedgerAmount(entry)
            const isDeletable = entry.source !== 'corporateAction' && !entry.corporateActionId
            return (
              <div className="t-trade-row" key={`${accountId}:cash:${entry.id}`}>
                <span
                  className={`t-trade-side ${entry.kind === 'cashDividend' ? 'is-buy' : 'is-sell'}`}
                >
                  {entry.kind === 'cashDividend' ? '分红' : '缴税'}
                </span>
                <span>
                  <strong>
                    {entry.kind === 'cashDividend' && entry.eligibleQuantity > 0
                      ? `${formatShares(entry.eligibleQuantity)} · 每股 ${formatNativeAmount(entry.amountPerShare)}`
                      : entry.kind === 'cashDividend'
                        ? '税前分红'
                        : '预扣税款'}
                  </strong>
                  <small>
                    {account.accountName} · {formatTradeTime(entry.occurredAt)} ·{' '}
                    {cashLedgerSourceLabel(entry)}
                  </small>
                </span>
                <span className="t-trade-amount">
                  <strong className={valueClass(signedAmount)}>
                    {formatNativeProfit(signedAmount)}
                  </strong>
                  <small>
                    {entry.note || (entry.kind === 'cashDividend' ? '现金分红' : '缴税')}
                  </small>
                </span>
                <span className="t-trade-actions">
                  <button
                    className="icon-button"
                    type="button"
                    disabled={!isDeletable}
                    onClick={() => deleteCashEntry(account, entry)}
                    title={isDeletable ? '删除现金流水' : '请在公司行动中撤销'}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            )
          }

          const { trade } = item
          const fees = totalRecordedTradeFees(trade)
          const isEditing = editingKey === `${accountId}:${trade.id}`
          return (
            <Fragment key={`${accountId}:trade:${trade.id}`}>
              <div className="t-trade-row">
                <span className={`t-trade-side is-${trade.side}`}>
                  {trade.side === 'buy' ? '底仓买入' : '底仓卖出'}
                </span>
                <span>
                  <strong>
                    {formatShares(trade.quantity)} × {formatPrice(trade.price)}
                  </strong>
                  <small>
                    {account.accountName} · {formatTradeTime(trade.tradedAt)} · 费用{' '}
                    {formatNativeAmount(fees)}
                    {market !== 'CN' ? ` · ${tradeFeeSourceLabel(trade)}` : ''}
                  </small>
                  {market !== 'CN' ? (
                    <small>
                      {trade.actualSettlementDate
                        ? `实际交收 ${trade.actualSettlementDate}`
                        : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}
                    </small>
                  ) : null}
                  {trade.splitSource ? (
                    <small>
                      <TradeSplitSource trade={trade} />
                    </small>
                  ) : null}
                </span>
                <span className="t-trade-amount">
                  <span>{formatNativeAmount(trade.price * trade.quantity)}</span>
                  <small>
                    {trade.splitSource
                      ? `混合底仓流水${trade.note ? ` · ${trade.note}` : ''}`
                      : trade.note || '底仓流水'}
                  </small>
                </span>
                <span className="t-trade-actions">
                  <AppButton
                    variant="icon"
                    onClick={() => (isEditing ? finishEditing() : editTrade(account, trade))}
                    title={isEditing ? '取消编辑底仓交易' : '修改底仓交易'}
                  >
                    {isEditing ? <X size={14} /> : <PencilLine size={14} />}
                  </AppButton>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => deleteTrade(account, trade)}
                    title="删除底仓交易"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              {isEditing ? (
                <div className="t-trade-inline-editor">
                  {renderTradeEditor(trade, finishEditing)}
                </div>
              ) : null}
            </Fragment>
          )
        })}
        {entries.length > 5 ? (
          <button
            className="t-trade-more-button"
            type="button"
            onClick={() => setShowAllEntries((current) => !current)}
          >
            {showAllEntries ? '收起底仓流水' : `显示更多底仓流水（其余 ${entries.length - 5} 条）`}
          </button>
        ) : null}
      </div>
      {error ? <div className="t-form-error">{error}</div> : null}
    </section>
  )
}

export function TTradingDrawer(props: TTradingDrawerProps) {
  const state = useSecuritiesAccountState()
  const market = props.stock.market ?? marketFromQuoteId(props.stock.quoteId)
  const currency = props.stock.currency ?? currencyForMarket(market)
  const owners = useMemo(
    () => listAccountsForMarket(state.securitiesAccounts, market, true),
    [market, state.securitiesAccounts]
  )
  const [entryAccountId, setEntryAccountId] = useState(
    () => props.initialAccountId ?? (resolveAccountSelection(state, market) || owners[0].id)
  )
  const [tradeToEdit, setTradeToEdit] = useState<TTrade | undefined>(undefined)
  const [clearEntry, setClearEntry] = useState(false)
  const stockBook = useMemo(
    () => toStockTradingBook(props.account, props.stock.quoteId),
    [props.account, props.stock.quoteId]
  )
  const batches = useMemo(() => getStockTBatches(stockBook), [stockBook])
  const activeBatches = useMemo(() => getActiveStockTBatches(stockBook), [stockBook])
  const [selectedBatchId, setSelectedBatchId] = useState(() => activeBatches[0]?.id ?? '')
  const editingBatch = tradeToEdit
    ? batches.find((batch) =>
        getBatchTrades(stockBook, batch).some(
          (trade) => trade.id === tradeToEdit.id && trade.accountId === tradeToEdit.accountId
        )
      )
    : undefined
  const entryBatch =
    editingBatch ?? activeBatches.find((batch) => batch.id === selectedBatchId) ?? activeBatches[0]
  const entryAccountButtonRef = useRef<HTMLButtonElement>(null)
  const makeAccountView = useCallback(
    (book: TTradingAccount) => {
      const owner = state.securitiesAccounts?.[book.accountId ?? defaultAccountId(market)]
      const account = { ...book, accountName: owner?.name ?? book.accountName }
      const stock = {
        ...props.stock,
        position: account.position,
        positionSnapshots: account.positionSnapshots
      }
      const profit = calculateCurrentPositionProfitOverride(
        stock,
        props.quote,
        account,
        props.exchangeRates,
        account.performanceAdjustmentCny
      )
      const metrics = calculatePositionMetrics(
        account.position,
        props.quote,
        account,
        props.exchangeRates,
        profit
      )
      const fees = accountFeeSettings(owner, state.settings, state.feeSchemes, props.stock.quoteId)
      return {
        stock,
        account,
        accountDisabled: owner?.enabled === false,
        holdingCost: metrics.holdingCost,
        holdingCostBasis: metrics.holdingCostBasis,
        feeSettings: fees.tTradingFees,
        marketTradeFees: fees.marketTradeFees,
        feeContext: getAccountTradeFeeContext(
          { securitiesAccounts: state.securitiesAccounts, feeSchemes: state.feeSchemes },
          account.accountId!,
          props.stock.quoteId
        )
      }
    },
    [
      market,
      props.exchangeRates,
      props.quote,
      props.stock,
      state.securitiesAccounts,
      state.feeSchemes,
      state.settings
    ]
  )
  const accountViews = useMemo(
    () => listStockAccountBooks(props.account).map(makeAccountView),
    [makeAccountView, props.account]
  )
  const ledgerAccounts = useMemo(() => accountViews.map(({ account }) => account), [accountViews])
  const entryView = useMemo(
    () =>
      accountViews.find(({ account }) => account.accountId === entryAccountId) ??
      makeAccountView({
        accountId: entryAccountId,
        quoteId: props.stock.quoteId,
        code: props.stock.code,
        name: props.stock.name,
        market,
        currency,
        history: [],
        ledger: { schemaVersion: 1, entries: [] },
        tradeRecords: []
      }),
    [accountViews, currency, entryAccountId, makeAccountView, market, props.stock]
  )
  const overview = useMemo(() => {
    let forwardQuantity = 0
    let reverseQuantity = 0
    let historyProfit = 0
    let historyFees = 0
    for (const batch of batches) {
      const metrics = calculateTBatchForecastMetrics(
        batch,
        getBatchTrades(stockBook, batch),
        props.quote?.latest,
        entryView.feeContext,
        props.stock.instrumentType === 'etf'
      )
      if (!batch.settlement) {
        if (metrics.direction === 'reverse') reverseQuantity += metrics.remainingQuantity
        else forwardQuantity += metrics.remainingQuantity
      } else {
        historyProfit += batch.settlement?.finalProfit ?? 0
        historyFees += getBatchTrades(stockBook, batch).reduce(
          (total, trade) => total + getTradeBatchAllocationAmounts(trade, batch).fees,
          0
        )
      }
    }
    return { forwardQuantity, reverseQuantity, historyProfit, historyFees }
  }, [batches, stockBook, props.quote?.latest, entryView.feeContext, props.stock.instrumentType])
  const finishEditing = useCallback(() => setTradeToEdit(undefined), [])
  const applyBook = (book: StockTradingBook) => {
    if (
      tradeToEdit &&
      !book.accounts[tradeToEdit.accountId!]?.tradeRecords.some(
        (trade) => trade.id === tradeToEdit.id
      )
    )
      finishEditing()
    props.onApplyBook(book)
  }
  const renderTradeEditor = (trade: TTrade, onComplete: () => void) => {
    const view = makeAccountView(stockBook.accounts[trade.accountId!])
    const batch =
      batches.find((item) => tradeReferencesBatch(trade, item.id)) ??
      activeBatches.find((item) => item.id === selectedBatchId) ??
      activeBatches[0]
    return (
      <TTradeEntry
        {...props}
        {...view}
        account={{
          ...view.account,
          activeBatch: batch,
          history: batches.filter((item) => item.settlement && item.id !== batch?.id)
        }}
        stockBook={stockBook}
        tradeToEdit={trade}
        onEditComplete={onComplete}
        onApplyBook={applyBook}
        inline
      />
    )
  }
  const formatNativeAmount = (value: number) =>
    currency === 'CNY' ? formatCurrency(value) : formatMoney(value, currency)
  const formatNativeProfit = (value: number) =>
    currency === 'CNY' ? formatProfit(value) : formatMoneyProfit(value, currency)

  return createPortal(
    <div className="t-trading-backdrop" role="presentation" onMouseDown={props.onClose}>
      <aside
        className="t-trading-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-trading-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="t-trading-header">
          <div>
            <span className="t-trading-icon">
              <Repeat2 size={20} />
            </span>
            <div className="t-trading-heading">
              <strong id="t-trading-title">交易管理 · {props.stock.name}</strong>
              <small>{props.stock.code} · 记录交易、目标价格与批次收益</small>
            </div>
          </div>
          <button
            className="icon-button dialog-close"
            type="button"
            onClick={props.onClose}
            aria-label="关闭"
          >
            <X size={19} />
          </button>
        </header>
        <div className="t-trading-content">
          <section className="t-overview-grid">
            <span>
              <small>总持仓</small>
              <strong>{formatOverviewValue(props.stock.position?.quantity, formatShares)}</strong>
            </span>
            <span>
              <small>持仓成本</small>
              <strong>{formatOverviewValue(props.holdingCost, formatCost)}</strong>
            </span>
            <span>
              <small>当前T仓</small>
              <strong>{formatOverviewValue(overview.forwardQuantity, formatShares)}</strong>
            </span>
            <span>
              <small>待回补数量</small>
              <strong>{formatOverviewValue(overview.reverseQuantity, formatShares)}</strong>
            </span>
            <span>
              <small>当前价格</small>
              <strong>{formatOverviewValue(props.quote?.latest, formatPrice)}</strong>
            </span>
            <span>
              <small>做T总收益</small>
              <strong className={valueClass(overview.historyProfit)}>
                {formatOverviewValue(overview.historyProfit, formatNativeProfit)}
              </strong>
            </span>
            <span className="t-overview-fee">
              <small>做T总费用</small>
              <strong>{formatOverviewValue(overview.historyFees, formatNativeAmount)}</strong>
            </span>
          </section>
          <TTradeEntry
            {...props}
            {...entryView}
            account={{
              ...entryView.account,
              activeBatch: entryBatch,
              history: batches.filter((batch) => batch.settlement && batch.id !== entryBatch?.id)
            }}
            stockBook={stockBook}
            onApplyBook={applyBook}
            key={entryAccountId}
            entryAccountSelect={
              <TradingAccountPicker
                value={entryAccountId}
                accounts={owners}
                disabled={Boolean(tradeToEdit)}
                buttonRef={entryAccountButtonRef}
                onChange={(id) => {
                  if (id === entryAccountId) return
                  setClearEntry(true)
                  setEntryAccountId(id)
                }}
              />
            }
            entryBatchSelect={
              activeBatches.length > 1 ? (
                <AppSelect
                  label="录入交易所属 T 批次"
                  value={entryBatch?.id ?? ''}
                  disabled={Boolean(tradeToEdit)}
                  options={activeBatches.map((batch) => ({
                    value: batch.id,
                    label: `${batchDirectionLabel(batch)}批次 #${batch.sequence} · ${stockBatchAccounts(
                      stockBook,
                      batch
                    )
                      .map((account) => account.accountName)
                      .join('、')}`,
                    description: `开始于 ${formatTradeTime(batch.openedAt)}`
                  }))}
                  onChange={setSelectedBatchId}
                />
              ) : null
            }
            clearEntry={clearEntry}
            tradeToEdit={tradeToEdit}
            onEditComplete={finishEditing}
          />
          <StockTTradingRecords
            baseLedger={
              <TBaseLedgerCard
                accounts={ledgerAccounts}
                stock={props.stock}
                onApply={(nextAccount, position) => {
                  if (
                    entryAccountId === nextAccount.accountId &&
                    tradeToEdit &&
                    !nextAccount.tradeRecords.some((trade) => trade.id === tradeToEdit.id)
                  ) {
                    finishEditing()
                  }
                  props.onApply(nextAccount, position)
                }}
                renderTradeEditor={renderTradeEditor}
              />
            }
            book={stockBook}
            stock={props.stock}
            quote={props.quote}
            feeSettings={entryView.feeSettings}
            marketTradeFees={entryView.marketTradeFees}
            feeContext={entryView.feeContext}
            planDefaults={props.planDefaults}
            exchangeRates={props.exchangeRates}
            onApply={applyBook}
            renderTradeEditor={renderTradeEditor}
            onEditTrade={(trade) => {
              setEntryAccountId(trade.accountId!)
              setTradeToEdit(trade)
            }}
          />
        </div>
      </aside>
    </div>,
    document.body
  )
}

function TTradeEntry({
  entryAccountSelect,
  entryBatchSelect,
  clearEntry = false,
  tradeToEdit,
  onEditComplete,
  inline = false,
  feeContext,
  stock,
  quote,
  account,
  stockBook,
  planDefaults,
  tradingCalendar,
  exchangeRates,
  floatingProfitAlertDefaultThreshold,
  onApplyBook,
  accountDisabled = false
}: TTradeEntryProps) {
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)
  const effectiveExchangeRate = exchangeRateForCurrency(exchangeRates, currency)
  const currentAccount = useMemo<TTradingAccount>(
    () =>
      account
        ? {
            ...account,
            market: account.market ?? market,
            currency: account.currency ?? currency
          }
        : {
            quoteId: stock.quoteId,
            code: stock.code,
            name: stock.name,
            market,
            currency,
            history: [],
            ledger: { schemaVersion: 1, entries: [] },
            tradeRecords: []
          },
    [account, currency, market, stock.code, stock.name, stock.quoteId]
  )
  const [entryMode, setEntryMode] = useState<EntryMode>('trade')
  const [side, setSide] = useState<TTradeSide>('buy')
  const [purpose, setPurpose] = useState<TTradePurpose>('t')
  const [price, setPrice] = useState(clearEntry ? '' : (quote?.latest?.toString() ?? ''))
  const [quantity, setQuantity] = useState('')
  const [tradedAt, setTradedAt] = useState(() => marketDateTimeInput(market))
  const [actualSettlementDate, setActualSettlementDate] = useState('')
  const [note, setNote] = useState('')
  const [manualFees, setManualFees] = useState(false)
  const [feeModeEdited, setFeeModeEdited] = useState(false)
  const [editingFees, setEditingFees] = useState(false)
  const feeEditSnapshotRef = useRef<{
    manualFees: boolean
    feeModeEdited: boolean
    feeOverrides: TTradeFees
    actualFees: string
  } | null>(null)
  const [feeOverrides, setFeeOverrides] = useState<TTradeFees>(emptyFees)
  const [actualFees, setActualFees] = useState('')
  const [tradeExchangeRate, setTradeExchangeRate] = useState(
    currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? '')
  )
  const [tradeExchangeRateEdited, setTradeExchangeRateEdited] = useState(false)
  const [overflowDisposition, setOverflowDisposition] = useState<OverflowDisposition>('base')
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const loadedTradeRef = useRef<TTrade | undefined>(undefined)
  const [error, setError] = useState('')
  const [cashEntryKind, setCashEntryKind] = useState<CashEntryKind>('cashDividend')
  const [cashAmount, setCashAmount] = useState('')
  const [cashEligibleQuantity, setCashEligibleQuantity] = useState(
    clearEntry ? '' : (stock.position?.quantity.toString() ?? '')
  )
  const [cashOccurredAt, setCashOccurredAt] = useState(() => marketDateTimeInput(market))
  const [cashExchangeRateInput, setCashExchangeRateInput] = useState(
    currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? '')
  )
  const [cashExchangeRateEdited, setCashExchangeRateEdited] = useState(false)
  const [cashNote, setCashNote] = useState('')
  const [cashError, setCashError] = useState('')

  const activeTrades = useMemo(
    () => getBatchTrades(stockBook, currentAccount.activeBatch),
    [stockBook, currentAccount.activeBatch]
  )
  const activeMetrics = useMemo(
    () => calculateTBatchMetrics(currentAccount.activeBatch, activeTrades, quote?.latest),
    [activeTrades, currentAccount.activeBatch, quote?.latest]
  )
  const entryMetrics = useMemo(
    () =>
      currentAccount.activeBatch
        ? calculateTBatchMetrics(
            currentAccount.activeBatch,
            activeTrades.filter(
              (trade) =>
                !(trade.id === editingTradeId && trade.accountId === currentAccount.accountId) &&
                trade.tradedAt <= tradedAt
            ),
            quote?.latest
          )
        : activeMetrics,
    [
      activeMetrics,
      activeTrades,
      currentAccount.activeBatch,
      currentAccount.accountId,
      editingTradeId,
      quote?.latest,
      tradedAt
    ]
  )
  const isReverseBatch = activeMetrics.direction === 'reverse'
  const tPurposeLabel = currentAccount.activeBatch
    ? isReverseBatch
      ? side === 'sell'
        ? '增加反T'
        : '回补反T'
      : side === 'buy'
        ? '计入T仓'
        : '卖出T仓'
    : side === 'buy'
      ? '开启正T'
      : '开启反T'
  const basePurposeLabel = side === 'buy' ? '增加底仓' : '减持底仓'
  const entryHint =
    entryMode === 'cash'
      ? '现金流水参与收益统计，不改变持仓数量和持仓成本'
      : purpose === 'base'
        ? '底仓交易独立于 T 批次，保存后按全部历史流水重算当前持仓'
        : currentAccount.activeBatch
          ? isReverseBatch
            ? '反T批次：卖出建立待回补数量，买入用于回补反T'
            : '正T批次：买入建立T仓，卖出用于清空T仓'
          : '计入T仓的首笔买入开启正T，首笔卖出开启反T'
  const numericPrice = Number(price)
  const numericQuantity = Number(quantity)
  const editingTrade = editingTradeId
    ? currentAccount.tradeRecords.find((record) => record.id === editingTradeId)
    : undefined
  const hasFixedAllocations = Boolean(editingTrade && getTradeAllocations(editingTrade).length > 1)
  const isClosingTTrade = Boolean(
    currentAccount.activeBatch &&
    purpose === 't' &&
    ((activeMetrics.direction === 'forward' && side === 'sell') ||
      (activeMetrics.direction === 'reverse' && side === 'buy'))
  )
  const overflowQuantity =
    !hasFixedAllocations && isClosingTTrade
      ? Math.max(0, numericQuantity - entryMetrics.remainingQuantity)
      : 0
  const tradeDate = tradedAt.slice(0, 10)
  const marketFeeTemplate = marketFeeTemplateForTradeDate(market, tradeDate)
  const feeEstimate = useMemo(() => {
    try {
      const price = Number.isFinite(numericPrice) ? Math.max(0, numericPrice) : 0
      const quantity = Number.isFinite(numericQuantity) ? Math.max(0, numericQuantity) : 0
      if (editingTrade?.splitSource) {
        const records = reestimateTradeExecution(
          currentAccount.tradeRecords.map((record) =>
            record.id === editingTrade.id
              ? { ...record, price, quantity, side, tradedAt, marketDate: tradeDate }
              : record
          ),
          editingTrade.id,
          feeContext,
          stock.instrumentType === 'etf'
        )
        const record = records.find((record) => record.id === editingTrade.id)!
        return {
          result: {
            fees: record.fees,
            feeItems: record.feeItems,
            feeTemplate: record.feeTemplate,
            total: totalRecordedTradeFees(record)
          },
          error: ''
        }
      }
      return {
        result: calculateAccountTradeFees(feeContext, {
          price,
          quantity,
          side,
          tradeDate,
          stampDutyExempt: stock.instrumentType === 'etf'
        }),
        error: ''
      }
    } catch (reason) {
      return {
        result: undefined,
        error: reason instanceof Error ? reason.message : '无法估算成交费用'
      }
    }
  }, [
    currentAccount.tradeRecords,
    editingTrade,
    feeContext,
    numericPrice,
    numericQuantity,
    side,
    stock.instrumentType,
    tradeDate,
    tradedAt
  ])
  const preservesRecordedFees = Boolean(editingTrade && !feeModeEdited)
  const selectedFeeTemplate = preservesRecordedFees
    ? editingTrade?.feeTemplate
    : feeEstimate.result?.feeTemplate
  const preservesUnknownFeeSource = Boolean(
    editingTrade &&
    !feeModeEdited &&
    editingTrade.feeSource === undefined &&
    !editingTrade.feeItems?.some((item) => item.code === 'manual')
  )
  const tradeFees =
    preservesRecordedFees && editingTrade
      ? editingTrade.fees
      : market === 'CN'
        ? manualFees
          ? feeOverrides
          : (feeEstimate.result?.fees ?? emptyFees())
        : emptyFees()
  const tradeFeeItems =
    preservesRecordedFees && editingTrade
      ? editingTrade.feeItems
      : market === 'CN'
        ? undefined
        : manualFees
          ? actualFees.trim() === '' ||
            !Number.isFinite(Number(actualFees)) ||
            Number(actualFees) < 0
            ? []
            : [
                {
                  code: 'manual' as const,
                  label: '券商实际费用',
                  amount: roundMoney(Number(actualFees))
                }
              ]
          : feeEstimate.result?.feeItems
  const tradeFeeTotal = totalRecordedTradeFees({ fees: tradeFees, feeItems: tradeFeeItems })
  const formatNativeAmount = (value: number | null | undefined) =>
    currency === 'CNY' ? formatCurrency(value) : formatMoney(value, currency)
  const toggleFeeEditing = () => {
    if (editingFees) {
      const snapshot = feeEditSnapshotRef.current!
      setManualFees(snapshot.manualFees)
      setFeeModeEdited(snapshot.feeModeEdited)
      setFeeOverrides(snapshot.feeOverrides)
      setActualFees(snapshot.actualFees)
      feeEditSnapshotRef.current = null
      setEditingFees(false)
      return
    }
    feeEditSnapshotRef.current = { manualFees, feeModeEdited, feeOverrides, actualFees }
    if (market === 'CN')
      setFeeOverrides(
        tradeFeeItems?.length ? { ...emptyFees(), commission: tradeFeeTotal } : tradeFees
      )
    else setActualFees(tradeFeeTotal.toString())
    setManualFees(true)
    setFeeModeEdited(true)
    setEditingFees(true)
  }
  const resetTradeForm = useCallback(() => {
    setEntryMode('trade')
    setSide('buy')
    setPurpose('t')
    setPrice(quote?.latest?.toString() ?? '')
    setQuantity('')
    setTradedAt(marketDateTimeInput(market))
    setActualSettlementDate('')
    setNote('')
    setManualFees(false)
    setFeeModeEdited(false)
    setEditingFees(false)
    feeEditSnapshotRef.current = null
    setFeeOverrides(emptyFees())
    setActualFees('')
    setTradeExchangeRate(currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? ''))
    setTradeExchangeRateEdited(false)
    setOverflowDisposition('base')
    setEditingTradeId(null)
    setError('')
    setCashError('')
    onEditComplete?.()
  }, [currency, effectiveExchangeRate, market, onEditComplete, quote?.latest])

  const applyAccount = (
    nextAccount: TTradingAccount,
    nextPosition: StockPosition | undefined,
    cash = false
  ) => {
    try {
      if (!cash && editingTrade && feeModeEdited && !manualFees) {
        nextAccount = withLedgerTradeRecords(
          nextAccount,
          reestimateTradeExecution(
            nextAccount.tradeRecords,
            editingTrade.id,
            feeContext,
            stock.instrumentType === 'etf'
          )
        )
        const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
        if (replay.error) throw new Error(replay.error)
        nextPosition = replay.position
      }
      onApplyBook(
        mergeStockTAccount(
          stockBook,
          nextAccount,
          nextPosition,
          currentAccount.activeBatch?.id,
          planDefaults
        )
      )
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (cash) setCashError(message)
      else setError(message)
      return false
    }
  }

  const applyTradeAccount = (nextAccount: TTradingAccount): boolean => {
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setError(`完整账本校验失败：${replay.error}`)
      return false
    }
    return applyAccount(nextAccount, replay.position)
  }

  const applyCashAccount = (nextAccount: TTradingAccount): boolean => {
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setCashError(`完整账本校验失败：${replay.error}`)
      return false
    }
    return applyAccount(nextAccount, replay.position, true)
  }

  const resetCashForm = () => {
    setCashAmount('')
    setCashEligibleQuantity(stock.position?.quantity.toString() ?? '')
    setCashOccurredAt(marketDateTimeInput(market))
    setCashExchangeRateInput(currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? ''))
    setCashExchangeRateEdited(false)
    setCashNote('')
    setCashError('')
  }

  const saveCashEntry = () => {
    if (accountDisabled) {
      setError('请先恢复启用该账户')
      return
    }
    const amount = roundMoney(Number(cashAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashError(
        cashEntryKind === 'cashDividend' ? '请输入有效的税前分红金额' : '请输入有效的缴税金额'
      )
      return
    }
    if (!cashOccurredAt) {
      setCashError('请选择发生时间')
      return
    }

    const eligibleQuantity = cashEligibleQuantity.trim() ? Number(cashEligibleQuantity) : 0
    if (
      cashEntryKind === 'cashDividend' &&
      (!Number.isFinite(eligibleQuantity) ||
        eligibleQuantity < 0 ||
        !Number.isInteger(eligibleQuantity))
    ) {
      setCashError('请输入有效的登记股数，未知时可以留空')
      return
    }
    const cashRate =
      currency === 'CNY'
        ? 1
        : cashExchangeRateInput.trim() === ''
          ? undefined
          : Number(cashExchangeRateInput)
    if (cashRate !== undefined && (!Number.isFinite(cashRate) || cashRate <= 0)) {
      setCashError('请输入有效的成交汇率，未知时可以留空')
      return
    }

    const common = {
      accountId: currentAccount.accountId ?? currentAccount.quoteId,
      quoteId: currentAccount.quoteId,
      occurredAt: cashOccurredAt,
      marketDate: cashOccurredAt.slice(0, 10),
      recordedAt: new Date().toISOString(),
      source: 'manual' as const,
      currency,
      exchangeRate: cashRate,
      exchangeRateDate:
        currency === 'CNY' || cashRate === undefined
          ? undefined
          : cashExchangeRateEdited || exchangeRates.manualOverrides[currency] !== undefined
            ? cashOccurredAt.slice(0, 10)
            : (exchangeRates.rateDate ?? cashOccurredAt.slice(0, 10)),
      note: cashNote.trim() || undefined
    }
    const hasPositionLedgerEntries = activePortfolioLedgerEntries(currentAccount).some(
      (entry) =>
        entry.kind === 'trade' ||
        entry.kind === 'positionAdjustment' ||
        entry.kind === 'shareAdjustment' ||
        entry.kind === 'rightsSubscription' ||
        entry.kind === 'securityConversion'
    )
    const workingAccount =
      stock.position && !hasPositionLedgerEntries
        ? createInitialPositionAccount(
            currentAccount,
            {
              quoteId: stock.quoteId,
              code: stock.code,
              name: stock.name,
              market,
              currency
            },
            stock.position,
            cashOccurredAt
          )
        : currentAccount
    const entry: CashLedgerEntry =
      cashEntryKind === 'cashDividend'
        ? {
            ...common,
            id: `cash-dividend:${crypto.randomUUID()}`,
            kind: 'cashDividend',
            eligibleQuantity,
            amountPerShare: eligibleQuantity > 0 ? amount / eligibleQuantity : 0,
            amount
          }
        : {
            ...common,
            id: `withholding-tax:${crypto.randomUUID()}`,
            kind: 'withholdingTax',
            amount
          }

    if (!applyCashAccount(appendPortfolioLedgerEntries(workingAccount, [entry]))) return
    resetCashForm()
  }

  const createBatch = (
    direction: TTradingBatch['direction'],
    openedAt: string,
    openingPosition: StockPosition | undefined
  ): TTradingBatch => ({
    legacyCalibrationProfit: 0,
    id: crypto.randomUUID(),
    sequence:
      Math.max(
        0,
        currentAccount.activeBatch?.sequence ?? 0,
        ...getStockTBatches(stockBook).map((item) => item.sequence)
      ) + 1,
    openedAt,
    direction,
    openingPosition: positionSnapshot(openingPosition),
    buyLevels: createTPlanLevelsFromDefaults(planDefaults.buyLevels),
    sellLevels: createTPlanLevelsFromDefaults(planDefaults.sellLevels),
    alertEnabled: false,
    floatingProfitAlert: {
      enabled: false,
      threshold: floatingProfitAlertDefaultThreshold,
      status: 'armed'
    }
  })

  const saveTrade = () => {
    if (accountDisabled && !editingTradeId) {
      setError('请先恢复启用该账户')
      return
    }
    if (!tradedAt || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('请输入有效的成交价格和数量')
      return
    }
    const quantityError = marketTradeQuantityError(market, numericQuantity)
    if (quantityError) {
      setError(quantityError)
      return
    }
    if (!preservesRecordedFees && !manualFees && feeEstimate.error) {
      setError(feeEstimate.error)
      return
    }
    if (market !== 'CN' && actualSettlementDate && actualSettlementDate < tradeDate) {
      setError('实际交收日不能早于成交日')
      return
    }
    if (
      market !== 'CN' &&
      manualFees &&
      (actualFees.trim() === '' || !Number.isFinite(Number(actualFees)) || Number(actualFees) < 0)
    ) {
      setError('请填写有效的券商实际费用，零费用请填写 0')
      return
    }
    const exchangeRate =
      currency === 'CNY'
        ? 1
        : tradeExchangeRate.trim() === ''
          ? undefined
          : Number(tradeExchangeRate)
    if (exchangeRate !== undefined && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError('请输入有效的成交汇率，未知时可以留空')
      return
    }

    const baseTrade: TTrade = {
      id: editingTradeId ?? crypto.randomUUID(),
      side,
      purpose,
      tradedAt,
      recordedAt: editingTrade?.recordedAt ?? new Date().toISOString(),
      price: numericPrice,
      quantity: numericQuantity,
      accountId: currentAccount.accountId,
      accountFeeSnapshot: preservesRecordedFees ? editingTrade?.accountFeeSnapshot : undefined,
      fees: tradeFees,
      feeItems: tradeFeeItems,
      feeTemplate: preservesRecordedFees
        ? editingTrade?.feeTemplate
        : manualFees
          ? undefined
          : selectedFeeTemplate,
      feeSource: preservesRecordedFees
        ? editingTrade?.feeSource
        : manualFees
          ? 'actual'
          : 'estimated',
      market,
      currency,
      marketDate: tradeDate,
      exchangeRate,
      exchangeRateDate:
        currency === 'CNY' || exchangeRate === undefined
          ? undefined
          : editingTrade && !tradeExchangeRateEdited && editingTrade.exchangeRate === exchangeRate
            ? editingTrade.exchangeRateDate
            : tradeExchangeRateEdited || exchangeRates.manualOverrides[currency] !== undefined
              ? tradeDate
              : (exchangeRates.rateDate ?? tradeDate),
      estimatedSettlementDate: estimateSettlementDate(market, tradeDate, tradingCalendar),
      actualSettlementDate:
        market === 'CN' ? editingTrade?.actualSettlementDate : actualSettlementDate || undefined,
      settlementRule: settlementRuleForTradeDate(market, tradeDate),
      origin: editingTrade?.origin ?? 'execution',
      splitSource: editingTrade?.splitSource,
      brokerImport: editingTrade?.brokerImport,
      note: note.trim()
    }
    const hasPositionLedgerEntries = activePortfolioLedgerEntries(currentAccount).some(
      (entry) =>
        entry.kind === 'trade' ||
        entry.kind === 'positionAdjustment' ||
        entry.kind === 'shareAdjustment' ||
        entry.kind === 'rightsSubscription' ||
        entry.kind === 'securityConversion'
    )
    const workingAccount =
      stock.position && !hasPositionLedgerEntries
        ? createInitialPositionAccount(
            currentAccount,
            {
              quoteId: stock.quoteId,
              code: stock.code,
              name: stock.name,
              market,
              currency
            },
            stock.position,
            tradedAt
          )
        : currentAccount

    if (purpose === 'base') {
      const result = upsertIndependentBaseTrade(
        workingAccount,
        baseTrade,
        market,
        currency,
        stock.position
      )
      if (result.error) {
        setError(`完整账本校验失败：${result.error}`)
        return
      }
      let nextAccount = result.account
      const editedBatch = currentAccount.activeBatch
      if (editingTrade && editedBatch && tradeReferencesBatch(editingTrade, editedBatch.id)) {
        const remainingBatchTrades = getBatchTrades(
          {
            ...stockBook,
            accounts: { ...stockBook.accounts, [nextAccount.accountId!]: nextAccount }
          },
          editedBatch
        )
        const validationError = validateTBatchTrades(editedBatch, remainingBatchTrades, false)
        if (validationError) {
          setError(validationError)
          return
        }
        nextAccount = {
          ...nextAccount,
          activeBatch: remainingBatchTrades.some((trade) =>
            hasTAllocationForBatch(trade, editedBatch.id)
          )
            ? rebalanceTBatchPlans(editedBatch, remainingBatchTrades, planDefaults, market)
            : undefined
        }
      }
      if (!applyAccount(nextAccount, result.position)) return
      resetTradeForm()
      return
    }

    let batch: TTradingBatch
    let batchTrades: TTrade[]
    if (currentAccount.activeBatch) {
      batch = currentAccount.activeBatch
      batchTrades = activeTrades.filter(
        (item) => !(item.id === editingTradeId && item.accountId === currentAccount.accountId)
      )
    } else {
      batch = createBatch(side === 'buy' ? 'forward' : 'reverse', tradedAt, stock.position)
      batchTrades = []
    }

    if (
      !editingTradeId &&
      activeMetrics.remainingQuantity === 0 &&
      batchTrades.some((item) => hasTAllocationForBatch(item, batch.id))
    ) {
      setError('当前批次已清空，请先完成结算')
      return
    }

    if (editingTrade && spansMultipleBatches(editingTrade)) {
      setError('跨批次成交不能直接修改，请删除后重新录入')
      return
    }

    const isOverflow = Boolean(
      currentAccount.activeBatch &&
      purpose === 't' &&
      isClosingTTrade &&
      entryMetrics.remainingQuantity > 0 &&
      numericQuantity > entryMetrics.remainingQuantity &&
      !hasFixedAllocations
    )

    if (isOverflow && overflowDisposition === 'opposite-t') {
      if (batchTrades.some((item) => item.tradedAt > tradedAt)) {
        setError('开启反向T批次的成交时间不能早于当前批次已有流水')
        return
      }
      const nextDirection = getTBatchDirection(batch) === 'forward' ? 'reverse' : 'forward'
      const nextBatchDraft = createBatch(nextDirection, tradedAt, undefined)
      const [trade, nextBatchTrade] = splitTradeForOverflow(
        baseTrade,
        batch,
        entryMetrics.remainingQuantity,
        nextBatchDraft
      )
      const closingTrades = sortTBatchTrades([...batchTrades, trade], batch.direction)
      const closingValidationError = validateTBatchTrades(batch, closingTrades, false)
      if (closingValidationError) {
        setError(closingValidationError)
        return
      }

      const closingBatch = handleTriggeredTPlanAlertsForTrade(
        rebalanceTBatchPlans(batch, closingTrades, planDefaults, market),
        side
      )
      const closingMetrics = calculateTBatchMetrics(closingBatch, closingTrades, quote?.latest)
      if (closingMetrics.remainingQuantity !== 0) {
        setError('当前交易无法完整结束原T批次')
        return
      }
      const closingAccount = withLedgerTradeRecords(
        workingAccount,
        upsertTradeRecord(workingAccount.tradeRecords, trade)
      )
      const transitionReplay = calculatePortfolioLedgerPosition(
        {
          ...closingAccount,
          ledger: {
            ...closingAccount.ledger,
            entries: closingAccount.ledger.entries.filter((entry) => entry.occurredAt <= tradedAt)
          }
        },
        market,
        currency
      )
      if (transitionReplay.error) {
        setError(`完整账本校验失败：${transitionReplay.error}`)
        return
      }
      const transitionPosition = transitionReplay.position
      const transitionAccounts = stockBatchAccounts(
        {
          ...stockBook,
          accounts: {
            ...stockBook.accounts,
            [closingAccount.accountId!]: { ...closingAccount, position: transitionPosition }
          }
        },
        closingBatch
      )
      const transitionQuantity = transitionAccounts.reduce(
        (sum, account) => sum + (account.position?.quantity ?? 0),
        0
      )
      const transitionCostBasis = transitionAccounts.reduce(
        (sum, account) => sum + (account.position?.quantity ?? 0) * (account.position?.cost ?? 0),
        0
      )
      const calibrationProfit = batchCalibrationProfit(closingBatch)
      const calibrated = Boolean(closingBatch.costCalibrations?.length || calibrationProfit)
      const finalProfit = roundMoney(closingMetrics.realizedProfit + calibrationProfit)
      const settlement = {
        settledAt: new Date().toISOString(),
        latestPositionQuantity: transitionQuantity,
        latestPositionCost:
          transitionQuantity > 0 ? transitionCostBasis / transitionQuantity : undefined,
        ledgerProfit: closingMetrics.realizedProfit,
        finalProfit,
        costAdjustedProfit: calibrated ? finalProfit : undefined,
        source: calibrated ? ('position-cost' as const) : ('ledger' as const),
        note: `超出部分自动开启${nextDirection === 'reverse' ? '反T' : '正T'}批次 #${nextBatchDraft.sequence}`
      }
      const settledBatch = { ...closingBatch, settlement }
      const nextBatchBase = {
        ...nextBatchDraft,
        openingPosition: positionSnapshot(transitionPosition)
      }
      const nextBatchTrades = [nextBatchTrade]
      const nextValidationError = validateTBatchTrades(nextBatchBase, nextBatchTrades, false)
      if (nextValidationError) {
        setError(nextValidationError)
        return
      }
      const nextBatch = rebalanceTBatchPlans(nextBatchBase, nextBatchTrades, planDefaults, market)
      const nextAccount = withLedgerTradeRecords(
        {
          ...workingAccount,
          activeBatch: nextBatch,
          history: [settledBatch, ...workingAccount.history]
        },
        upsertTradeRecord(closingAccount.tradeRecords, nextBatchTrade)
      )
      if (!applyTradeAccount(nextAccount)) return
      resetTradeForm()
      return
    }

    const [trade, baseOverflowTrade]: [TTrade, TTrade?] = isOverflow
      ? splitTradeForOverflow(baseTrade, batch, entryMetrics.remainingQuantity)
      : [
          hasFixedAllocations && editingTrade?.allocations
            ? { ...baseTrade, allocations: editingTrade.allocations }
            : toTradeRecord(baseTrade, batch),
          undefined
        ]

    const nextTrades = sortTBatchTrades([...batchTrades, trade], batch.direction)
    const validationError = validateTBatchTrades(batch, nextTrades, false)
    if (validationError) {
      setError(validationError)
      return
    }
    let plannedBatch = rebalanceTBatchPlans(batch, nextTrades, planDefaults, market)
    if (hasTAllocationForBatch(trade, batch.id)) {
      plannedBatch = handleTriggeredTPlanAlertsForTrade(plannedBatch, side)
    }
    const hasTTrades = nextTrades.some((item) => hasTAllocationForBatch(item, plannedBatch.id))
    const nextRecords = upsertTradeRecord(workingAccount.tradeRecords, trade)
    if (baseOverflowTrade) {
      const nextAccount = withLedgerTradeRecords(
        { ...workingAccount, activeBatch: plannedBatch },
        upsertTradeRecord(nextRecords, baseOverflowTrade)
      )
      if (!applyTradeAccount(nextAccount)) return
      resetTradeForm()
      return
    }
    if (
      !applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...workingAccount,
            activeBatch: hasTTrades ? plannedBatch : undefined
          },
          hasTTrades ? nextRecords : detachTradeRecordsFromBatch(nextRecords, plannedBatch.id)
        )
      )
    )
      return
    resetTradeForm()
  }

  const loadTrade = useCallback(
    (trade: TTrade) => {
      setEntryMode('trade')
      setEditingTradeId(trade.id)
      setSide(trade.side)
      setPurpose(
        getTradeAllocations(trade).some((allocation) => allocation.purpose === 't') ? 't' : 'base'
      )
      setPrice(trade.price.toString())
      setQuantity(trade.quantity.toString())
      setTradedAt(trade.tradedAt)
      setActualSettlementDate(trade.actualSettlementDate ?? '')
      setNote(trade.note)
      setManualFees(market === 'CN' || !trade.feeTemplate)
      setFeeModeEdited(false)
      setEditingFees(false)
      feeEditSnapshotRef.current = null
      setFeeOverrides(trade.fees)
      setActualFees(market === 'CN' ? '' : totalRecordedTradeFees(trade).toString())
      setTradeExchangeRate(currency === 'CNY' ? '1' : (trade.exchangeRate?.toString() ?? ''))
      setTradeExchangeRateEdited(false)
      setError('')
      setCashError('')
    },
    [currency, market]
  )

  useEffect(() => {
    if (loadedTradeRef.current === tradeToEdit) return
    loadedTradeRef.current = tradeToEdit
    if (tradeToEdit) loadTrade(tradeToEdit)
    else resetTradeForm()
  }, [loadTrade, resetTradeForm, tradeToEdit])

  const feeInput = (key: keyof TTradeFees, label: string) => (
    <label>
      <span>{label}</span>
      <AppInput
        type="number"
        min="0"
        step="0.01"
        value={feeOverrides[key]}
        onChange={(event) =>
          setFeeOverrides((current) => ({
            ...current,
            [key]: Math.max(0, Number(event.target.value) || 0)
          }))
        }
      />
    </label>
  )

  return (
    <div className="t-trading-entry-content">
      <section className={`t-card t-trade-entry${inline ? ' is-inline' : ''}`}>
        {inline ? null : (
          <div className="t-card-heading">
            <div className="t-entry-heading">
              <div className="t-entry-title-row">
                <strong>{editingTradeId ? '修改交易' : '录入交易'}</strong>
                {entryAccountSelect}
                {entryBatchSelect}
              </div>
              <small>{entryHint}</small>
            </div>
          </div>
        )}

        <div className="t-entry-top-row">
          <div className="t-segmented">
            <button
              className={entryMode === 'trade' && side === 'buy' ? 'is-active' : ''}
              type="button"
              disabled={hasFixedAllocations}
              onClick={() => {
                setEntryMode('trade')
                setSide('buy')
                setPurpose('t')
                setCashError('')
              }}
            >
              买入
            </button>
            <button
              className={entryMode === 'trade' && side === 'sell' ? 'is-active' : ''}
              type="button"
              disabled={hasFixedAllocations}
              onClick={() => {
                setEntryMode('trade')
                setSide('sell')
                setPurpose('t')
                setCashError('')
              }}
            >
              卖出
            </button>
            <button
              className={entryMode === 'trade' && purpose === 't' ? 'is-purpose-active' : ''}
              type="button"
              disabled={hasFixedAllocations}
              onClick={() => {
                setEntryMode('trade')
                setPurpose('t')
                setCashError('')
              }}
            >
              {tPurposeLabel}
            </button>
            <button
              className={entryMode === 'trade' && purpose === 'base' ? 'is-purpose-active' : ''}
              type="button"
              disabled={hasFixedAllocations}
              onClick={() => {
                setEntryMode('trade')
                setPurpose('base')
                setCashError('')
              }}
            >
              {basePurposeLabel}
            </button>
            <button
              className={entryMode === 'cash' ? 'is-purpose-active' : ''}
              type="button"
              disabled={Boolean(editingTradeId)}
              onClick={() => {
                setEntryMode('cash')
                setCashError('')
                setError('')
              }}
            >
              分红与缴税
            </button>
          </div>

          {entryMode === 'trade' ? (
            <>
              <div className="t-fee-summary">
                {market === 'CN' ? (
                  <>
                    <span>佣金 {formatCurrency(tradeFees.commission)}</span>
                    <span>经手 {formatCurrency(tradeFees.handling)}</span>
                    <span>证管 {formatCurrency(tradeFees.regulatory)}</span>
                    <span>过户 {formatCurrency(tradeFees.transfer)}</span>
                    <span>印花税 {formatCurrency(tradeFees.stampDuty)}</span>
                  </>
                ) : (
                  <>
                    {tradeFeeItems?.map((item) => (
                      <span key={item.code}>
                        {item.label} {formatNativeAmount(item.amount)}
                      </span>
                    ))}
                    {!manualFees && !marketFeeTemplate ? (
                      <span>当前成交日期无内置费用模板</span>
                    ) : null}
                    <span>
                      {manualFees
                        ? preservesUnknownFeeSource
                          ? '费用来源未标记'
                          : '券商实际费用'
                        : `模板估算${selectedFeeTemplate ? ` · v${selectedFeeTemplate.version}` : ''}`}
                    </span>
                  </>
                )}
                <strong>合计 {formatNativeAmount(tradeFeeTotal)}</strong>
                {preservesRecordedFees ? <span>保留已保存费用</span> : null}
                {!preservesRecordedFees && !manualFees && feeEstimate.error ? (
                  <span>{feeEstimate.error}</span>
                ) : null}
              </div>
              {editingTrade ? (
                <AppButton
                  variant="text"
                  className="bordered-text-button text-button"
                  title={
                    editingTrade.splitSource
                      ? '按整笔成交重新估算后分摊，将更新关联流水的费用及成本 / 收益'
                      : '按该流水所属账户当前方案重新估算，保存后更新成本 / 收益'
                  }
                  onClick={() => {
                    const keep = feeModeEdited && !manualFees
                    setFeeModeEdited(!keep)
                    setManualFees(keep ? market === 'CN' || !editingTrade.feeTemplate : false)
                    setEditingFees(false)
                    feeEditSnapshotRef.current = null
                    setError('')
                  }}
                >
                  {feeModeEdited && !manualFees ? '保留原费用' : '重新估算费用'}
                </AppButton>
              ) : null}
              <AppButton
                variant="text"
                className="bordered-text-button text-button"
                disabled={Boolean(editingTrade?.splitSource)}
                title={editingTrade?.splitSource ? '拆分成交保留整笔成交分摊的费用' : undefined}
                onClick={toggleFeeEditing}
              >
                {editingFees ? '取消修改' : '手动修改费用'}
              </AppButton>
            </>
          ) : null}
        </div>

        {entryMode === 'cash' ? (
          <>
            <div className="t-segmented t-cash-entry-kind">
              <button
                className={cashEntryKind === 'cashDividend' ? 'is-active' : ''}
                type="button"
                onClick={() => {
                  setCashEntryKind('cashDividend')
                  setCashError('')
                }}
              >
                分红
              </button>
              <button
                className={cashEntryKind === 'withholdingTax' ? 'is-active' : ''}
                type="button"
                onClick={() => {
                  setCashEntryKind('withholdingTax')
                  setCashError('')
                }}
              >
                缴税
              </button>
            </div>

            <div className="t-entry-input-row">
              <div className="t-form-grid t-cash-entry-grid">
                <label>
                  <span>{cashEntryKind === 'cashDividend' ? '税前分红金额' : '缴税金额'}</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                  />
                </label>
                {cashEntryKind === 'cashDividend' ? (
                  <label>
                    <span>登记股数（可选）</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={cashEligibleQuantity}
                      onChange={(event) => setCashEligibleQuantity(event.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  <span>发生时间</span>
                  <input
                    type="datetime-local"
                    value={cashOccurredAt}
                    onChange={(event) => setCashOccurredAt(event.target.value)}
                  />
                </label>
                {currency !== 'CNY' ? (
                  <label>
                    <span>兑人民币汇率（可选）</span>
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={cashExchangeRateInput}
                      onChange={(event) => {
                        setCashExchangeRateInput(event.target.value)
                        setCashExchangeRateEdited(true)
                      }}
                      placeholder="未知时留空"
                    />
                  </label>
                ) : null}
                <label className={cashEntryKind === 'withholdingTax' ? 'is-wide' : ''}>
                  <span>备注</span>
                  <input
                    value={cashNote}
                    onChange={(event) => setCashNote(event.target.value)}
                    placeholder="可选"
                  />
                </label>
              </div>

              <div className="t-entry-actions">
                <span>
                  {cashEntryKind === 'cashDividend'
                    ? Number(cashEligibleQuantity) > 0 && Number(cashAmount) > 0
                      ? `每股分红 ${formatNativeAmount(
                          Number(cashAmount) / Number(cashEligibleQuantity)
                        )}`
                      : '按税前总额计入分红收入'
                    : '缴税按现金流出计入收益统计'}
                </span>
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={saveCashEntry}
                >
                  <Plus size={15} />
                  {cashEntryKind === 'cashDividend' ? '记录分红' : '记录缴税'}
                </button>
              </div>
            </div>

            {cashError ? <div className="t-form-error">{cashError}</div> : null}
          </>
        ) : (
          <>
            <div className="t-entry-input-row t-trade-input-row">
              <div className="t-form-grid t-trade-input-grid">
                <label>
                  <span>成交价格</span>
                  <AppInput
                    type="number"
                    autoFocus={inline}
                    min={market === 'CN' ? 0.01 : 0.0001}
                    step={market === 'CN' ? 0.01 : 0.0001}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </label>
                <label>
                  <span>成交数量</span>
                  <AppInput
                    type="number"
                    min={market === 'CN' ? 100 : 1}
                    step="100"
                    value={quantity}
                    disabled={hasFixedAllocations}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                <label>
                  <span>成交时间</span>
                  <AppInput
                    type="datetime-local"
                    value={tradedAt}
                    onChange={(event) => setTradedAt(event.target.value)}
                  />
                </label>
                <label>
                  <span>备注</span>
                  <AppInput
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="t-trade-total-field">
                  <span>成交额</span>
                  <AppInput
                    readOnly
                    value={formatNativeAmount(numericPrice * numericQuantity)}
                    aria-label="成交额"
                  />
                </label>
              </div>

              <div className="t-entry-actions">
                {editingTradeId ? (
                  <AppButton variant="text" onClick={resetTradeForm}>
                    取消
                  </AppButton>
                ) : null}
                <AppButton variant="primary" className="compact-button" onClick={saveTrade}>
                  <Plus size={15} />
                  {editingTradeId ? '保存修改' : '记录交易'}
                </AppButton>
              </div>
            </div>
            {market !== 'CN' && tradedAt ? (
              <div className="t-trade-settlement-hint">
                预计交收 {estimateSettlementDate(market, tradeDate, tradingCalendar) || '--'}
              </div>
            ) : null}

            {overflowQuantity > 0 ? (
              <div className="t-overflow-allocation">
                <span>
                  <strong>本次成交跨越当前T仓</strong>
                  <small>
                    成交时可用T仓 {formatShares(entryMetrics.remainingQuantity)}，超出{' '}
                    {formatShares(overflowQuantity)}
                  </small>
                </span>
                <div className="t-overflow-options">
                  <button
                    type="button"
                    className={overflowDisposition === 'base' ? 'is-selected' : ''}
                    onClick={() => setOverflowDisposition('base')}
                  >
                    {side === 'sell' ? '减持底仓' : '增加底仓'}
                  </button>
                  <button
                    type="button"
                    className={overflowDisposition === 'opposite-t' ? 'is-selected' : ''}
                    onClick={() => setOverflowDisposition('opposite-t')}
                  >
                    {activeMetrics.direction === 'forward' ? '开启反T批次' : '开启正T批次'}
                  </button>
                </div>
                <small>
                  保存后生成两条独立记录：本批次 {formatShares(entryMetrics.remainingQuantity)}，
                  {overflowDisposition === 'base'
                    ? `混合底仓流水（${basePurposeLabel}）`
                    : activeMetrics.direction === 'forward'
                      ? '新反T批次'
                      : '新正T批次'}{' '}
                  {formatShares(overflowQuantity)}。手续费按整笔计算一次，再按数量分摊。
                </small>
              </div>
            ) : null}

            {editingFees ? (
              <div className="t-entry-input-row t-trade-input-row">
                <div className="t-form-grid t-manual-fee-inputs">
                  {market === 'CN' ? (
                    <>
                      {feeInput('commission', '佣金')}
                      {feeInput('handling', '经手费')}
                      {feeInput('regulatory', '证管费')}
                      {feeInput('transfer', '过户费')}
                      {feeInput('stampDuty', '印花税')}
                    </>
                  ) : (
                    <label>
                      <span>券商实际费用</span>
                      <AppInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={actualFees}
                        onChange={(event) => {
                          setActualFees(event.target.value)
                          setFeeModeEdited(true)
                        }}
                        placeholder="零费用请填写 0"
                      />
                    </label>
                  )}
                </div>
              </div>
            ) : null}

            {market !== 'CN' ? (
              <div className="t-form-grid t-trade-extra-fields">
                {currency !== 'CNY' ? (
                  <label>
                    <span>成交汇率（可选）</span>
                    <AppInput
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={tradeExchangeRate}
                      onChange={(event) => {
                        setTradeExchangeRate(event.target.value)
                        setTradeExchangeRateEdited(true)
                      }}
                      placeholder="未知时留空"
                    />
                  </label>
                ) : null}
                <label>
                  <span>实际交收日（可选）</span>
                  <AppInput
                    type="date"
                    value={actualSettlementDate}
                    onChange={(event) => setActualSettlementDate(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {error ? <div className="t-form-error">{error}</div> : null}
          </>
        )}
      </section>
    </div>
  )
}
