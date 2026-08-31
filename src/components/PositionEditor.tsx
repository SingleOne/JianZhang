import { BriefcaseBusiness, Camera, Check, PencilLine, ReceiptText, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatShares
} from '../lib/format'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { deleteIndependentBaseTrade, upsertIndependentBaseTrade } from '../lib/base-trades'
import { calculatePortfolioLedgerPosition } from '../lib/portfolio-ledger'
import {
  appendPositionAdjustment,
  createInitialPositionAccount,
  positionRecordLedgerEntries,
  previewPositionRecordDeletion,
  removePositionRecordEntries,
  shouldCreateInitialPositionRecord,
  type PositionRecordLedgerEntry,
  positionsMatch
} from '../lib/position-ledger'
import {
  detachTradeRecordsFromBatch,
  getTradeAllocations,
  hasTAllocationForBatch,
  isIndependentBaseTrade,
  sortTradeRecords,
  tradeReferencesBatch,
  upsertTradeRecord
} from '../lib/trade-records'
import {
  calculateMarketLedgerMetrics,
  calculateMarketTradeFeeItems,
  estimateSettlementDate,
  MARKET_FEE_TEMPLATES,
  marketTradeQuantityError,
  settlementRuleForTradeDate,
  totalTradeFeeItems
} from '../lib/market-trades'
import {
  calculateTBatchMetrics,
  recalculatePositionFromBatch,
  rebalanceTBatchPlans,
  roundMoney,
  totalRecordedTradeFees,
  totalTradeFees,
  validateTBatchTrades
} from '../lib/t-trading'
import type {
  MarketTradeFeeSettings,
  StockCurrency,
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  StockMarket,
  ExchangeRateSettings,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingBatch,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeRecord,
  TTradeSide,
  TradeFeeItem,
  TradingCalendarSettings,
  WatchStock
} from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import {
  currencyForMarket,
  marketCapabilitiesForQuoteId,
  marketFromQuoteId,
  STOCK_MARKET_LABELS,
  STOCK_MARKET_TIME_ZONES,
  STOCK_CURRENCY_SYMBOLS
} from '../shared/stock-market'
import { useConfirmDialog } from './ConfirmDialog'

interface PositionEditorProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  planDefaults: TPlanDefaultSettings
  exchangeRates: ExchangeRateSettings
  marketTradeFees: MarketTradeFeeSettings
  tradingCalendar: TradingCalendarSettings
  onSave: (
    position: StockPosition | undefined,
    showRadarSignals: boolean,
    positionSnapshots: StockPositionSnapshot[],
    updatedAccount?: TTradingAccount
  ) => void
  onClose: () => void
}

interface PositionVersionMetrics {
  marketValue: number | null
  totalProfit: number | null
  profitPercent: number | null
}

interface TradeRecordDraft {
  side: TTradeSide
  purpose: TTradePurpose
  tradedAt: string
  price: string
  quantity: string
  fees: string
  exchangeRate: string
  actualSettlementDate: string
  note: string
}

interface NewTradeRecordDraft {
  side: TTradeSide
  tradedAt: string
  price: string
  quantity: string
  actualFees: string
  exchangeRate: string
  stampDutyExempt: boolean
  note: string
}

interface TradeAccountUpdate {
  account: TTradingAccount
  position?: StockPosition
  updatesPosition: boolean
  error?: string
}

function calculateVersionMetrics(
  quantity: number,
  cost: number,
  latest: number | null | undefined
): PositionVersionMetrics {
  if (latest === null || latest === undefined) {
    return { marketValue: null, totalProfit: null, profitPercent: null }
  }
  if (quantity <= 0) {
    return { marketValue: 0, totalProfit: 0, profitPercent: null }
  }
  return {
    marketValue: latest * quantity,
    totalProfit: (latest - cost) * quantity,
    profitPercent: cost > 0 ? (latest / cost - 1) * 100 : null
  }
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(new Date(value))
    .replaceAll('/', '-')
}

function defaultSnapshotName(createdAt: string): string {
  return formatSnapshotTime(createdAt)
}

function marketDateTimeInput(market: StockMarket, date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STOCK_MARKET_TIME_ZONES[market],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

function marketLedgerDateTime(market: StockMarket, date = new Date()): string {
  return `${marketDateTimeInput(market, date)}:${date.getSeconds().toString().padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`
}

function emptyTradeFees(): TTradeFees {
  return { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
}

const TRADE_RECORD_PAGE_SIZE = 15

function formatTradeTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function tradeRecordLabel(record: TTradeRecord): string {
  if (record.origin === 'opening-balance') return '初始持仓'
  const allocations = getTradeAllocations(record)
  const purposes = new Set(allocations.map((allocation) => allocation.purpose))
  const batchIds = new Set(allocations.map((allocation) => allocation.batchId).filter(Boolean))
  if (purposes.size > 1) return record.side === 'buy' ? 'T仓 / 底仓买入' : 'T仓 / 底仓卖出'
  if (batchIds.size > 1) return record.side === 'buy' ? '跨批次买入' : '跨批次卖出'
  if (purposes.has('base')) return record.side === 'buy' ? '底仓买入' : '底仓卖出'
  const direction =
    allocations.find((allocation) => allocation.batchDirection)?.batchDirection ??
    record.batchDirection ??
    'forward'
  if (direction === 'reverse') {
    return record.side === 'sell' ? '反T卖出' : '回补买入'
  }
  return record.side === 'buy' ? 'T仓买入' : 'T仓卖出'
}

function tradeRecordContext(record: TTradeRecord): string {
  if (record.origin === 'opening-balance') return '初始余额'
  const contexts = getTradeAllocations(record)
    .filter((allocation) => allocation.batchSequence !== undefined)
    .map(
      (allocation) =>
        `${(allocation.batchDirection ?? 'forward') === 'reverse' ? '反T' : '正T'}批次 #${allocation.batchSequence}`
    )
  const uniqueContexts = [...new Set(contexts)]
  return uniqueContexts.length > 0 ? uniqueContexts.join(' / ') : '独立交易'
}

function spansMultipleBatches(record: TTradeRecord): boolean {
  return (
    new Set(
      getTradeAllocations(record)
        .map((allocation) => allocation.batchId)
        .filter(Boolean)
    ).size > 1
  )
}

function createTradeRecordDraft(record: TTradeRecord): TradeRecordDraft {
  return {
    side: record.side,
    purpose: record.purpose,
    tradedAt: record.tradedAt.slice(0, 16),
    price: record.price.toString(),
    quantity: record.quantity.toString(),
    fees: totalRecordedTradeFees(record).toString(),
    exchangeRate: record.exchangeRate?.toString() ?? '',
    actualSettlementDate: record.actualSettlementDate ?? '',
    note: record.note
  }
}

function feesWithTotal(fees: TTradeFees, nextTotal: number): TTradeFees {
  const currentTotal = totalTradeFees(fees)
  if (currentTotal === nextTotal) return fees
  return {
    commission: nextTotal,
    handling: 0,
    regulatory: 0,
    transfer: 0,
    stampDuty: 0
  }
}

function refreshBatchSettlement(batch: TTradingBatch, trades: readonly TTrade[]): TTradingBatch {
  if (!batch.settlement) return batch
  const ledgerProfit = calculateTBatchMetrics(batch, trades).realizedProfit
  const settlement = {
    ...batch.settlement,
    ledgerProfit,
    finalProfit: batch.settlement.source === 'ledger' ? ledgerProfit : batch.settlement.finalProfit
  }
  return { ...batch, settlement }
}

function updateTradeAccount(
  account: TTradingAccount,
  record: TTradeRecord,
  nextTrade: TTrade | undefined,
  planDefaults: TPlanDefaultSettings
): TradeAccountUpdate {
  const nextRecords = nextTrade
    ? sortTradeRecords([
        ...account.tradeRecords.filter((item) => item.id !== record.id),
        { ...record, ...nextTrade }
      ])
    : account.tradeRecords.filter((item) => item.id !== record.id)

  const activeBatch = account.activeBatch
  if (activeBatch && tradeReferencesBatch(record, activeBatch.id)) {
    const nextBatch = activeBatch
    const nextBatchTrades = sortTradeRecords(
      nextRecords.filter((item) => tradeReferencesBatch(item, nextBatch.id)),
      'ascending'
    )
    const validationError = validateTBatchTrades(nextBatch, nextBatchTrades)
    if (validationError) {
      return { account, updatesPosition: false, error: validationError }
    }
    const plannedBatch = rebalanceTBatchPlans(nextBatch, nextBatchTrades, planDefaults)
    const hasTTrades = nextBatchTrades.some((trade) => hasTAllocationForBatch(trade, nextBatch.id))
    const finalRecords = hasTTrades
      ? nextRecords
      : detachTradeRecordsFromBatch(nextRecords, nextBatch.id)
    return {
      account: withLedgerTradeRecords(
        { ...account, activeBatch: hasTTrades ? plannedBatch : undefined },
        finalRecords
      ),
      position: recalculatePositionFromBatch(plannedBatch, nextBatchTrades),
      updatesPosition: true
    }
  }

  const historyIndex = account.history.findIndex((batch) => tradeReferencesBatch(record, batch.id))
  if (historyIndex >= 0) {
    const batch = account.history[historyIndex]
    const nextBatchTrades = sortTradeRecords(
      nextRecords.filter((item) => tradeReferencesBatch(item, batch.id)),
      'ascending'
    )
    const validationError = validateTBatchTrades(batch, nextBatchTrades)
    if (validationError) {
      return { account, updatesPosition: false, error: validationError }
    }
    const history = account.history.map((item, index) =>
      index === historyIndex ? refreshBatchSettlement(batch, nextBatchTrades) : item
    )
    return {
      account: withLedgerTradeRecords({ ...account, history }, nextRecords),
      updatesPosition: false
    }
  }

  return {
    account: withLedgerTradeRecords(account, nextRecords),
    updatesPosition: false
  }
}

interface TradeRecordListProps {
  records: readonly PositionRecordLedgerEntry[]
  market: StockMarket
  currency: StockCurrency
  editingTradeId: string | null
  draft: TradeRecordDraft | null
  error: string
  onStartEdit: (record: TTradeRecord) => void
  onDraftChange: (changes: Partial<TradeRecordDraft>) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (entry: PositionRecordLedgerEntry) => void
}

function TradeRecordList({
  records,
  market,
  currency,
  editingTradeId,
  draft,
  error,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onDelete
}: TradeRecordListProps) {
  return (
    <div className="trade-record-scroll">
      <div className="trade-record-list">
        <div className="trade-record-row trade-record-table-header">
          <span>交易类型</span>
          <span>批次 / 时间</span>
          <span>数量 / 价格 / 费用</span>
          <span>金额变动</span>
          <span>备注</span>
          <span>操作</span>
        </div>
        {records.map((entry) => {
          if (entry.kind === 'positionAdjustment') {
            const quantityChange = entry.quantityAfter - entry.quantityBefore
            return (
              <div className="trade-record-row" key={entry.id}>
                <span className="trade-record-side is-adjustment">持仓校准</span>
                <span>
                  <strong>持仓校准</strong>
                  <small>{formatTradeTime(entry.occurredAt)}</small>
                </span>
                <span>
                  <strong>
                    {formatShares(entry.quantityBefore)} → {formatShares(entry.quantityAfter)}
                  </strong>
                  <small>
                    成本 {formatCost(entry.costBefore)} → {formatCost(entry.costAfter)} {currency}
                  </small>
                </span>
                <strong>
                  数量变化 {quantityChange > 0 ? '+' : ''}
                  {formatShares(quantityChange)}
                </strong>
                <small title={entry.note || undefined}>{entry.note || '--'}</small>
                <span className="trade-record-actions">
                  <button
                    className="icon-button is-delete"
                    type="button"
                    onClick={() => onDelete(entry)}
                    title="删除持仓校准记录"
                    aria-label="删除持仓校准记录"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            )
          }
          const record = entry.record
          const allocations = getTradeAllocations(record)
          const hasFixedAllocations = allocations.length > 1
          const isCrossBatch = spansMultipleBatches(record)
          const batchDirection =
            allocations.find((allocation) => allocation.batchDirection)?.batchDirection ??
            record.batchDirection ??
            'forward'
          const hasBatchAllocation = allocations.some((allocation) => allocation.batchId)
          const fees = totalRecordedTradeFees(record)
          const feeDetails = record.feeItems
            ?.map((item) => `${item.label} ${item.amount.toFixed(2)}`)
            .join(' · ')
          const amountChange =
            record.side === 'buy'
              ? -(record.price * record.quantity + fees)
              : record.price * record.quantity - fees
          const isEditing = editingTradeId === record.id && draft
          if (isEditing) {
            const tBuyLabel = batchDirection === 'reverse' ? '回补买入' : 'T仓买入'
            const tSellLabel = batchDirection === 'reverse' ? '反T卖出' : 'T仓卖出'
            return (
              <div
                className="trade-record-row is-editing"
                key={entry.id}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    onCancelEdit()
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onSaveEdit()
                  }
                }}
              >
                <select
                  value={`${draft.purpose}:${draft.side}`}
                  disabled={hasFixedAllocations}
                  onChange={(event) => {
                    const [purpose, side] = event.target.value.split(':') as [
                      TTradePurpose,
                      TTradeSide
                    ]
                    onDraftChange({ purpose, side })
                  }}
                  aria-label="交易类型"
                >
                  <option value="base:buy">底仓买入</option>
                  <option value="base:sell">底仓卖出</option>
                  {hasBatchAllocation ? <option value="t:buy">{tBuyLabel}</option> : null}
                  {hasBatchAllocation ? <option value="t:sell">{tSellLabel}</option> : null}
                </select>
                <span className="trade-record-edit-context">
                  <strong>{tradeRecordContext(record)}</strong>
                  <input
                    type="datetime-local"
                    value={draft.tradedAt}
                    onChange={(event) => onDraftChange({ tradedAt: event.target.value })}
                    aria-label="成交时间"
                  />
                </span>
                <span className="trade-record-edit-numbers">
                  <label>
                    <span>数量</span>
                    <input
                      type="number"
                      min={market === 'CN' ? 100 : 1}
                      step="100"
                      value={draft.quantity}
                      disabled={hasFixedAllocations}
                      onChange={(event) => onDraftChange({ quantity: event.target.value })}
                      aria-label="成交数量"
                    />
                  </label>
                  <label>
                    <span>价格</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.price}
                      onChange={(event) => onDraftChange({ price: event.target.value })}
                      aria-label="成交价格"
                    />
                  </label>
                  <label>
                    <span>费用</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.fees}
                      onChange={(event) => onDraftChange({ fees: event.target.value })}
                      aria-label="交易费用合计"
                    />
                  </label>
                  {currency !== 'CNY' ? (
                    <label>
                      <span>汇率</span>
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        value={draft.exchangeRate}
                        onChange={(event) => onDraftChange({ exchangeRate: event.target.value })}
                        aria-label="成交汇率"
                      />
                    </label>
                  ) : null}
                </span>
                <span className="trade-record-edit-hint">
                  <label>
                    <span>实际交收</span>
                    <input
                      type="date"
                      value={draft.actualSettlementDate}
                      onChange={(event) =>
                        onDraftChange({
                          actualSettlementDate: event.target.value
                        })
                      }
                    />
                  </label>
                </span>
                <input
                  className="trade-record-note-input"
                  type="text"
                  value={draft.note}
                  maxLength={100}
                  onChange={(event) => onDraftChange({ note: event.target.value })}
                  aria-label="交易备注"
                />
                <span className="trade-record-actions">
                  <button
                    className="icon-button is-save"
                    type="button"
                    onClick={onSaveEdit}
                    title="保存本行"
                    aria-label="保存本行"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={onCancelEdit}
                    title="取消编辑"
                    aria-label="取消编辑"
                  >
                    <X size={15} />
                  </button>
                </span>
                {error ? <small className="trade-record-edit-error">{error}</small> : null}
              </div>
            )
          }
          return (
            <div className="trade-record-row" key={entry.id}>
              <span className={`trade-record-side is-${record.side}`}>
                {tradeRecordLabel(record)}
              </span>
              <span>
                <strong>{tradeRecordContext(record)}</strong>
                <small>
                  {formatTradeTime(record.tradedAt)} ·{' '}
                  {record.actualSettlementDate
                    ? `实际交收 ${record.actualSettlementDate}`
                    : record.estimatedSettlementDate
                      ? `预计交收 ${record.estimatedSettlementDate}`
                      : '交收日 --'}
                  {record.settlementRule ? ` · ${record.settlementRule.label}` : ''}
                </small>
              </span>
              <span>
                <strong>
                  {formatShares(record.quantity)} × {formatPrice(record.price)}
                </strong>
                <small title={feeDetails}>
                  费用 {formatMoney(fees, currency)}
                  {feeDetails ? ` · ${feeDetails}` : ''}
                  {record.feeTemplate
                    ? ` · ${record.feeTemplate.label} v${record.feeTemplate.version}`
                    : ''}
                  {record.exchangeRate ? ` · 汇率 ${record.exchangeRate.toFixed(6)}` : ''}
                </small>
              </span>
              <strong className={valueClass(amountChange)}>
                金额变动 {formatMoneyProfit(amountChange, currency)}
              </strong>
              <small title={record.note || undefined}>{record.note || '--'}</small>
              <span className="trade-record-actions">
                <button
                  className="icon-button"
                  type="button"
                  disabled={isCrossBatch}
                  onClick={() => onStartEdit(record)}
                  title={isCrossBatch ? '请在交易管理中处理跨批次成交' : '编辑本条交易'}
                  aria-label="编辑本条交易"
                >
                  <PencilLine size={14} />
                </button>
                <button
                  className="icon-button is-delete"
                  type="button"
                  disabled={isCrossBatch}
                  onClick={() => onDelete(entry)}
                  title={isCrossBatch ? '请在交易管理中处理跨批次成交' : '删除本条交易'}
                  aria-label="删除本条交易"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PositionEditor({
  stock,
  quote,
  account,
  planDefaults,
  exchangeRates,
  marketTradeFees,
  tradingCalendar,
  onSave,
  onClose
}: PositionEditorProps) {
  const confirm = useConfirmDialog()
  const market = marketFromQuoteId(stock.quoteId)
  const capabilities = marketCapabilitiesForQuoteId(stock.quoteId)
  const currency = stock.currency ?? quote?.currency ?? currencyForMarket(market)
  const currentMarketDateTime = marketDateTimeInput(market)
  const effectiveExchangeRate = exchangeRateForCurrency(exchangeRates, currency)
  const usesManualRate = currency !== 'CNY' && exchangeRates.manualOverrides[currency] !== undefined
  const [quantity, setQuantity] = useState(stock.position?.quantity.toString() ?? '')
  const [cost, setCost] = useState(stock.position?.cost.toString() ?? '')
  const [costExchangeRate, setCostExchangeRate] = useState(
    stock.position?.costExchangeRate?.toString() ?? effectiveExchangeRate?.toString() ?? ''
  )
  const [openedOn, setOpenedOn] = useState(
    stock.position ? (stock.position.openedOn ?? '') : currentMarketDateTime.slice(0, 10)
  )
  const [showRadarSignals, setShowRadarSignals] = useState(stock.showRadarSignals)
  const [positionSnapshots, setPositionSnapshots] = useState<StockPositionSnapshot[]>(
    () => stock.positionSnapshots ?? []
  )
  const [editedAccount, setEditedAccount] = useState<TTradingAccount | undefined>()
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [tradeRecordDraft, setTradeRecordDraft] = useState<TradeRecordDraft | null>(null)
  const [tradeRecordError, setTradeRecordError] = useState('')
  const [newTradeDraft, setNewTradeDraft] = useState<NewTradeRecordDraft>(() => ({
    side: 'buy',
    tradedAt: currentMarketDateTime,
    price: quote?.latest?.toString() ?? '',
    quantity: market === 'CN' ? '100' : '1',
    actualFees: '',
    exchangeRate: effectiveExchangeRate?.toString() ?? '',
    stampDutyExempt: stock.instrumentType === 'etf',
    note: ''
  }))
  const [newTradeError, setNewTradeError] = useState('')
  const [showAllTradeRecords, setShowAllTradeRecords] = useState(false)
  const [tradeRecordPage, setTradeRecordPage] = useState(0)
  const [positionError, setPositionError] = useState('')
  const hasPositionInput = quantity.trim() !== '' || cost.trim() !== ''
  const currentQuantity = Number(quantity) || 0
  const currentCost = Number(cost) || 0
  const currentMetrics = calculateVersionMetrics(currentQuantity, currentCost, quote?.latest)
  const workingAccount = editedAccount ?? account
  const tradeRecords = workingAccount?.tradeRecords ?? []
  const positionRecords = positionRecordLedgerEntries(workingAccount)
  const ledgerMetrics =
    market === 'CN' ? null : calculateMarketLedgerMetrics(tradeRecords, market, currency)
  const newTradePrice = Number(newTradeDraft.price)
  const newTradeQuantity = Number(newTradeDraft.quantity)
  const calculatedNewTradeFeeItems = calculateMarketTradeFeeItems(
    market,
    Number.isFinite(newTradePrice) && Number.isFinite(newTradeQuantity)
      ? newTradePrice * newTradeQuantity
      : 0,
    Number.isFinite(newTradeQuantity) ? newTradeQuantity : 0,
    newTradeDraft.side,
    marketTradeFees,
    {
      stampDutyExempt: newTradeDraft.stampDutyExempt
    }
  )
  const calculatedNewTradeFees = totalTradeFeeItems(calculatedNewTradeFeeItems)
  const recentPositionRecords = positionRecords.slice(0, 5)
  const tradeRecordPageCount = Math.max(
    1,
    Math.ceil(positionRecords.length / TRADE_RECORD_PAGE_SIZE)
  )
  const currentTradeRecordPage = Math.min(tradeRecordPage, Math.max(0, tradeRecordPageCount - 1))
  const visiblePositionRecords = positionRecords.slice(
    currentTradeRecordPage * TRADE_RECORD_PAGE_SIZE,
    (currentTradeRecordPage + 1) * TRADE_RECORD_PAGE_SIZE
  )

  const addSnapshot = () => {
    if (!stock.position) return
    const createdAt = new Date().toISOString()
    setPositionSnapshots((current) => [
      {
        id: crypto.randomUUID(),
        name: defaultSnapshotName(createdAt),
        createdAt,
        quantity: stock.position!.quantity,
        cost: stock.position!.cost,
        currency,
        costExchangeRate: stock.position!.costExchangeRate,
        costExchangeRateDate: stock.position!.costExchangeRateDate
      },
      ...current
    ])
  }

  const updateSnapshot = (
    snapshotId: string,
    changes: Partial<Pick<StockPositionSnapshot, 'quantity' | 'cost'>>
  ) => {
    setPositionSnapshots((current) =>
      current.map((snapshot) =>
        snapshot.id === snapshotId ? { ...snapshot, ...changes } : snapshot
      )
    )
  }

  const startEditingTradeRecord = (record: TTradeRecord) => {
    setEditingTradeId(record.id)
    setTradeRecordDraft(createTradeRecordDraft(record))
    setTradeRecordError('')
  }

  const cancelEditingTradeRecord = () => {
    setEditingTradeId(null)
    setTradeRecordDraft(null)
    setTradeRecordError('')
  }

  const closeAllTradeRecords = () => {
    setShowAllTradeRecords(false)
    cancelEditingTradeRecord()
  }

  const applyGlobalLedgerPosition = (
    nextAccount: TTradingAccount,
    includeAStock = false
  ): boolean => {
    if (market === 'CN' && !includeAStock) return true
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setTradeRecordError(replay.error)
      return false
    }
    setQuantity(replay.position?.quantity.toString() ?? '')
    setCost(replay.position?.cost.toString() ?? '')
    setCostExchangeRate(replay.position?.costExchangeRate?.toString() ?? '')
    setOpenedOn(replay.position?.openedOn ?? currentMarketDateTime.slice(0, 10))
    return true
  }

  const currentPositionFallback = (): StockPosition | undefined => {
    const nextQuantity = Number(quantity)
    const nextCost = Number(cost)
    const nextRate = currency === 'CNY' ? 1 : Number(costExchangeRate)
    if (
      !hasPositionInput ||
      !Number.isFinite(nextQuantity) ||
      !Number.isFinite(nextCost) ||
      !Number.isFinite(nextRate) ||
      nextRate <= 0 ||
      !openedOn
    ) {
      return stock.position
    }
    return {
      quantity: nextQuantity,
      cost: nextCost,
      openedToday: openedOn === currentMarketDateTime.slice(0, 10),
      openedOn,
      currency,
      costExchangeRate: nextRate,
      costExchangeRateDate: stock.position?.costExchangeRateDate
    }
  }

  const applyResolvedPosition = (nextPosition: StockPosition | undefined) => {
    setQuantity(nextPosition?.quantity.toString() ?? '')
    setCost(nextPosition?.cost.toString() ?? '')
    setCostExchangeRate(nextPosition?.costExchangeRate?.toString() ?? '')
    setOpenedOn(nextPosition?.openedOn ?? currentMarketDateTime.slice(0, 10))
  }

  const savePosition = (nextPosition: StockPosition | undefined) => {
    let resolvedPosition = nextPosition
    let updatedAccount = capabilities.tradeLedger ? editedAccount : undefined
    if (
      capabilities.tradeLedger &&
      nextPosition &&
      shouldCreateInitialPositionRecord(stock.position, nextPosition, workingAccount)
    ) {
      updatedAccount = createInitialPositionAccount(
        workingAccount,
        {
          quoteId: stock.quoteId,
          code: stock.code,
          name: stock.name,
          market,
          currency
        },
        nextPosition,
        marketDateTimeInput(market)
      )
      const replay = calculatePortfolioLedgerPosition(updatedAccount, market, currency)
      if (replay.error) {
        setPositionError(`初始持仓不足以覆盖现有交易流水：${replay.error}`)
        return
      }
      resolvedPosition = replay.position
    } else if (capabilities.tradeLedger && workingAccount) {
      const replay = calculatePortfolioLedgerPosition(workingAccount, market, currency)
      const previousPosition = replay.error ? stock.position : replay.position
      const positionWasEdited = !positionsMatch(stock.position, nextPosition)
      if (positionWasEdited && !positionsMatch(previousPosition, nextPosition)) {
        const recordedAt = new Date()
        updatedAccount = appendPositionAdjustment(
          workingAccount,
          previousPosition,
          nextPosition,
          marketLedgerDateTime(market, recordedAt),
          recordedAt.toISOString()
        )
      }
    }
    onSave(
      resolvedPosition,
      capabilities.radar ? showRadarSignals : stock.showRadarSignals,
      positionSnapshots,
      updatedAccount
    )
  }

  const addTradeRecord = () => {
    const price = Number(newTradeDraft.price)
    const tradeQuantity = Number(newTradeDraft.quantity)
    const manualFees =
      newTradeDraft.actualFees.trim() === '' ? null : Number(newTradeDraft.actualFees)
    const quantityError = marketTradeQuantityError(market, tradeQuantity)
    if (
      !newTradeDraft.tradedAt ||
      !Number.isFinite(price) ||
      price <= 0 ||
      (manualFees !== null && (!Number.isFinite(manualFees) || manualFees < 0))
    ) {
      setNewTradeError('请填写有效的成交时间、价格和实际费用')
      return
    }
    if (quantityError) {
      setNewTradeError(quantityError)
      return
    }

    const exchangeRate = currency === 'CNY' ? 1 : Number(newTradeDraft.exchangeRate)
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setNewTradeError('请填写有效的成交汇率')
      return
    }

    let nextAccount = workingAccount ?? {
      quoteId: stock.quoteId,
      code: stock.code,
      name: stock.name,
      market,
      currency,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    }
    if (nextAccount.tradeRecords.length === 0 && stock.position) {
      nextAccount = createInitialPositionAccount(
        nextAccount,
        {
          quoteId: stock.quoteId,
          code: stock.code,
          name: stock.name,
          market,
          currency
        },
        stock.position,
        marketDateTimeInput(market)
      )
    }

    const marketDate = newTradeDraft.tradedAt.slice(0, 10)
    const feeItems: TradeFeeItem[] =
      manualFees === null
        ? calculatedNewTradeFeeItems
        : manualFees > 0
          ? [{ code: 'manual', label: '券商实际费用', amount: roundMoney(manualFees) }]
          : []
    const trade: TTrade = {
      id: crypto.randomUUID(),
      side: newTradeDraft.side,
      purpose: 'base',
      tradedAt: newTradeDraft.tradedAt,
      price,
      quantity: tradeQuantity,
      fees: emptyTradeFees(),
      feeItems,
      feeTemplate: market === 'HK' || market === 'US' ? MARKET_FEE_TEMPLATES[market] : undefined,
      market,
      currency,
      marketDate,
      exchangeRate,
      exchangeRateDate: usesManualRate ? marketDate : (exchangeRates.rateDate ?? marketDate),
      estimatedSettlementDate: estimateSettlementDate(market, marketDate, tradingCalendar),
      settlementRule: settlementRuleForTradeDate(market, marketDate),
      origin: 'execution',
      note: newTradeDraft.note.trim()
    }
    nextAccount = withLedgerTradeRecords(
      { ...nextAccount, market, currency },
      upsertTradeRecord(nextAccount.tradeRecords, trade)
    )
    if (!applyGlobalLedgerPosition(nextAccount)) {
      setNewTradeError('卖出数量不能超过交易流水中的可用持仓数量')
      return
    }
    setEditedAccount(nextAccount)
    setNewTradeDraft((current) => ({
      ...current,
      tradedAt: marketDateTimeInput(market),
      price: quote?.latest?.toString() ?? '',
      quantity: market === 'CN' ? '100' : '1',
      actualFees: '',
      note: ''
    }))
    setNewTradeError('')
  }

  const saveTradeRecord = () => {
    if (!workingAccount || !editingTradeId || !tradeRecordDraft) return
    const record = tradeRecords.find((item) => item.id === editingTradeId)
    if (!record) return

    const price = Number(tradeRecordDraft.price)
    const tradeQuantity = Number(tradeRecordDraft.quantity)
    const fees = Number(tradeRecordDraft.fees)
    if (
      !tradeRecordDraft.tradedAt ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(fees) ||
      fees < 0
    ) {
      setTradeRecordError('请填写有效的成交时间、价格和费用')
      return
    }
    const quantityError = marketTradeQuantityError(market, tradeQuantity)
    if (quantityError) {
      setTradeRecordError(quantityError)
      return
    }

    const exchangeRate = currency === 'CNY' ? 1 : Number(tradeRecordDraft.exchangeRate)
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setTradeRecordError('请填写有效的成交汇率')
      return
    }

    const feeTotal = roundMoney(fees)
    const marketDate = tradeRecordDraft.tradedAt.slice(0, 10)
    const feeTotalChanged = feeTotal !== totalRecordedTradeFees(record)
    const transactionChanged =
      record.side !== tradeRecordDraft.side ||
      record.price !== price ||
      record.quantity !== tradeQuantity
    const nextMarketFeeItems = feeTotalChanged
      ? feeTotal > 0
        ? [{ code: 'manual' as const, label: '券商实际费用', amount: feeTotal }]
        : []
      : transactionChanged && record.feeTemplate
        ? calculateMarketTradeFeeItems(
            market,
            price * tradeQuantity,
            tradeQuantity,
            tradeRecordDraft.side,
            marketTradeFees,
            {
              stampDutyExempt:
                market === 'HK' && !record.feeItems?.some((item) => item.code === 'stamp-duty')
            }
          )
        : record.feeItems

    const nextTrade: TTrade = {
      id: record.id,
      side: tradeRecordDraft.side,
      purpose: tradeRecordDraft.purpose,
      tradedAt: tradeRecordDraft.tradedAt,
      price,
      quantity: tradeQuantity,
      fees: market === 'CN' ? feesWithTotal(record.fees, feeTotal) : emptyTradeFees(),
      feeItems: market === 'CN' ? record.feeItems : nextMarketFeeItems,
      feeTemplate: market === 'CN' || !feeTotalChanged ? record.feeTemplate : undefined,
      market,
      currency,
      marketDate,
      exchangeRate,
      exchangeRateDate:
        record.exchangeRate === exchangeRate
          ? record.exchangeRateDate
          : usesManualRate
            ? marketDate
            : (exchangeRates.rateDate ?? marketDate),
      estimatedSettlementDate: estimateSettlementDate(market, marketDate, tradingCalendar),
      actualSettlementDate: tradeRecordDraft.actualSettlementDate || undefined,
      settlementRule: settlementRuleForTradeDate(market, marketDate),
      origin: record.origin,
      allocations: record.allocations?.length
        ? record.allocations.length > 1
          ? record.allocations
          : [
              {
                ...record.allocations[0],
                purpose: tradeRecordDraft.purpose,
                quantity: tradeQuantity
              }
            ]
        : undefined,
      note: tradeRecordDraft.note.trim()
    }
    if (isIndependentBaseTrade(record) && isIndependentBaseTrade(nextTrade)) {
      const result = upsertIndependentBaseTrade(
        workingAccount,
        nextTrade,
        market,
        currency,
        currentPositionFallback()
      )
      if (result.error) {
        setTradeRecordError(result.error)
        return
      }
      setEditedAccount(result.account)
      applyResolvedPosition(result.position)
      cancelEditingTradeRecord()
      return
    }
    const result = updateTradeAccount(workingAccount, record, nextTrade, planDefaults)
    if (result.error) {
      setTradeRecordError(result.error)
      return
    }
    if (!applyGlobalLedgerPosition(result.account, isIndependentBaseTrade(record))) {
      setEditingTradeId(record.id)
      setTradeRecordDraft(createTradeRecordDraft(record))
      return
    }
    setEditedAccount(result.account)
    if (result.updatesPosition) {
      setQuantity(result.position?.quantity.toString() ?? '')
      setCost(result.position?.cost.toString() ?? '')
    }
    cancelEditingTradeRecord()
  }

  const deleteTradeRecord = async (record: TTradeRecord) => {
    if (!workingAccount) return
    const confirmed = await confirm({
      title: '删除交易记录',
      message: `确定删除 ${formatTradeTime(record.tradedAt)} 的${tradeRecordLabel(record)}记录吗？`,
      confirmLabel: '删除记录',
      tone: 'danger'
    })
    if (!confirmed) return
    if (isIndependentBaseTrade(record)) {
      const result = deleteIndependentBaseTrade(
        workingAccount,
        record.id,
        market,
        currency,
        currentPositionFallback()
      )
      if (result.error) {
        setEditingTradeId(record.id)
        setTradeRecordDraft(createTradeRecordDraft(record))
        setTradeRecordError(result.error)
        return
      }
      setEditedAccount(result.account)
      applyResolvedPosition(result.position)
      if (editingTradeId === record.id) cancelEditingTradeRecord()
      return
    }
    const result = updateTradeAccount(workingAccount, record, undefined, planDefaults)
    if (result.error) {
      setEditingTradeId(record.id)
      setTradeRecordDraft(createTradeRecordDraft(record))
      setTradeRecordError(result.error)
      return
    }
    if (!applyGlobalLedgerPosition(result.account, isIndependentBaseTrade(record))) {
      setEditingTradeId(record.id)
      setTradeRecordDraft(createTradeRecordDraft(record))
      return
    }
    setEditedAccount(result.account)
    if (result.updatesPosition) {
      setQuantity(result.position?.quantity.toString() ?? '')
      setCost(result.position?.cost.toString() ?? '')
    }
    if (editingTradeId === record.id) cancelEditingTradeRecord()
  }

  const deletePositionRecord = async (entry: PositionRecordLedgerEntry) => {
    if (!workingAccount) return
    const preview = previewPositionRecordDeletion(workingAccount, entry.id)
    if (!preview) return
    if (entry.kind === 'trade' && preview.laterRecordCount === 0) {
      await deleteTradeRecord(entry.record)
      return
    }

    const affectedBatchIds = new Set(
      preview.entries.flatMap((recordEntry) =>
        recordEntry.kind === 'trade'
          ? getTradeAllocations(recordEntry.record).flatMap((allocation) =>
              allocation.batchId ? [allocation.batchId] : []
            )
          : []
      )
    )
    const targetLabel =
      entry.kind === 'positionAdjustment' ? '持仓校准' : tradeRecordLabel(entry.record)
    const cascadeDescription =
      preview.laterRecordCount > 0
        ? `删除后会影响后续持仓和收益计算，并同时删除之后 ${preview.laterRecordCount} 条记录${affectedBatchIds.size > 0 ? `，涉及 ${affectedBatchIds.size} 个 T 批次` : ''}。`
        : ''
    const confirmed = await confirm({
      title: preview.laterRecordCount > 0 ? '删除记录及后续记录' : '删除持仓校准',
      message: `确定删除 ${formatTradeTime(entry.occurredAt)} 的${targetLabel}记录吗？${cascadeDescription}保存设置后生效。`,
      confirmLabel:
        preview.laterRecordCount > 0 ? `删除 ${preview.entries.length} 条记录` : '删除记录',
      tone: 'danger'
    })
    if (!confirmed) return

    const deletedEntryIds = new Set(preview.entries.map((recordEntry) => recordEntry.id))
    const accountWithoutRecords = removePositionRecordEntries(workingAccount, deletedEntryIds)
    const remainingTradeRecords = accountWithoutRecords.tradeRecords
    const activeBatch = workingAccount.activeBatch
      ? (() => {
          const batchTrades = sortTradeRecords(
            remainingTradeRecords.filter((record) =>
              tradeReferencesBatch(record, workingAccount.activeBatch!.id)
            ),
            'ascending'
          )
          return batchTrades.some((record) =>
            hasTAllocationForBatch(record, workingAccount.activeBatch!.id)
          )
            ? rebalanceTBatchPlans(workingAccount.activeBatch!, batchTrades, planDefaults)
            : undefined
        })()
      : undefined
    const history = workingAccount.history.flatMap((batch) => {
      const batchTrades = sortTradeRecords(
        remainingTradeRecords.filter((record) => tradeReferencesBatch(record, batch.id)),
        'ascending'
      )
      return batchTrades.length > 0 ? [refreshBatchSettlement(batch, batchTrades)] : []
    })
    const nextAccount = { ...accountWithoutRecords, activeBatch, history }
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setTradeRecordError(replay.error)
      return
    }
    setEditedAccount(nextAccount)
    applyResolvedPosition(replay.position)
    if (
      editingTradeId &&
      preview.entries.some(
        (recordEntry) => recordEntry.kind === 'trade' && recordEntry.record.id === editingTradeId
      )
    ) {
      cancelEditingTradeRecord()
    }
  }

  const tradeRecordListProps = {
    market,
    currency,
    editingTradeId,
    draft: tradeRecordDraft,
    error: tradeRecordError,
    onStartEdit: startEditingTradeRecord,
    onDraftChange: (changes: Partial<TradeRecordDraft>) => {
      setTradeRecordDraft((current) => (current ? { ...current, ...changes } : current))
      setTradeRecordError('')
    },
    onSaveEdit: saveTradeRecord,
    onCancelEdit: cancelEditingTradeRecord,
    onDelete: deletePositionRecord
  }

  return createPortal(
    <>
      <div className="position-dialog-backdrop" role="presentation" onMouseDown={onClose}>
        <section
          className="position-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="position-dialog-title"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        >
          <header className="position-dialog-header">
            <div>
              <span className="position-dialog-icon">
                <BriefcaseBusiness size={18} />
              </span>
              <span>
                <span className="position-dialog-title-line">
                  <strong id="position-dialog-title">编辑持仓</strong>
                  {capabilities.radar ? (
                    <label className="position-header-radar-switch">
                      <span>显示异动数据</span>
                      <input
                        className="switch-input"
                        type="checkbox"
                        checked={showRadarSignals}
                        onChange={(event) => setShowRadarSignals(event.target.checked)}
                      />
                    </label>
                  ) : null}
                </span>
                <small>
                  {stock.name} · {stock.code}
                </small>
              </span>
            </div>
            <button
              className="icon-button dialog-close"
              type="button"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </header>

          <form
            className="position-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              const nextRate = currency === 'CNY' ? 1 : Number(costExchangeRate)
              const nextQuantity = Number(quantity)
              const nextCost = Number(cost)
              const quantityError = hasPositionInput
                ? marketTradeQuantityError(market, nextQuantity)
                : undefined
              if (
                quantityError ||
                (hasPositionInput && (cost.trim() === '' || !Number.isFinite(nextCost))) ||
                (hasPositionInput && (!Number.isFinite(nextRate) || nextRate <= 0)) ||
                (hasPositionInput && !openedOn)
              ) {
                setPositionError(quantityError ?? '请填写有效的成本价、建仓日期和成本汇率')
                return
              }
              setPositionError('')
              const nextPosition = hasPositionInput
                ? {
                    quantity: nextQuantity,
                    cost: nextCost,
                    openedToday: openedOn === currentMarketDateTime.slice(0, 10),
                    openedOn,
                    currency,
                    costExchangeRate: nextRate,
                    costExchangeRateDate:
                      stock.position?.costExchangeRate === nextRate
                        ? stock.position.costExchangeRateDate
                        : usesManualRate
                          ? currentMarketDateTime.slice(0, 10)
                          : (exchangeRates.rateDate ?? currentMarketDateTime.slice(0, 10))
                  }
                : undefined
              savePosition(nextPosition)
            }}
          >
            <div className="position-fields">
              <label>
                <span>持仓数量</span>
                <span className="position-input-wrap">
                  <input
                    type="number"
                    min={market === 'CN' ? 100 : 1}
                    step="100"
                    required={hasPositionInput}
                    autoFocus
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="例如 1000"
                  />
                  <span>股</span>
                </span>
              </label>
              <label>
                <span>成本价</span>
                <span className="position-input-wrap">
                  <input
                    type="number"
                    step="0.0001"
                    required={hasPositionInput}
                    value={cost}
                    onChange={(event) => setCost(event.target.value)}
                    placeholder="例如 12.5800"
                  />
                  <span>{currency}</span>
                </span>
              </label>
              {currency !== 'CNY' ? (
                <label>
                  <span>建仓汇率</span>
                  <span className="position-input-wrap">
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      required={hasPositionInput}
                      value={costExchangeRate}
                      onChange={(event) => setCostExchangeRate(event.target.value)}
                      placeholder="兑人民币汇率"
                    />
                    <span>CNY</span>
                  </span>
                  <small>
                    1 {currency} = {effectiveExchangeRate?.toFixed(6) ?? '--'} CNY
                    {usesManualRate
                      ? '（手工覆盖）'
                      : exchangeRates.rateDate
                        ? `（官方 ${exchangeRates.rateDate}）`
                        : ''}
                  </small>
                </label>
              ) : null}
              <label>
                <span>建仓日期</span>
                <span className="position-input-wrap">
                  <input
                    type="date"
                    max={currentMarketDateTime.slice(0, 10)}
                    required={hasPositionInput}
                    value={openedOn}
                    onChange={(event) => setOpenedOn(event.target.value)}
                  />
                </span>
              </label>
            </div>
            {positionError ? <div className="position-form-error">{positionError}</div> : null}
            <section className="position-snapshot-panel">
              <header>
                <span>
                  <strong>持仓快照</strong>
                  <small>当前价 {formatPrice(quote?.latest)}，快照修改随“保存设置”一并保存</small>
                </span>
                <button
                  className="secondary-button position-snapshot-add"
                  type="button"
                  disabled={!stock.position}
                  onClick={addSnapshot}
                >
                  <Camera size={14} />
                  保存持仓快照
                </button>
              </header>

              <div className="position-snapshot-scroll">
                <div className="position-snapshot-table">
                  <div className="position-snapshot-row position-snapshot-table-header">
                    <span>持仓版本</span>
                    <span>数量</span>
                    <span>成本</span>
                    <span>持仓市值</span>
                    <span>持仓收益</span>
                    <span>收益率</span>
                    <span>较当前收益</span>
                    <span />
                  </div>
                  <div className="position-snapshot-row is-current">
                    <span className="position-snapshot-name">
                      <strong>当前持仓</strong>
                      <small>按上方输入实时预览</small>
                    </span>
                    <strong>{formatShares(currentQuantity)}</strong>
                    <strong>
                      {currentCost > 0
                        ? `${STOCK_CURRENCY_SYMBOLS[currency]}${formatCost(currentCost)}`
                        : '--'}
                    </strong>
                    <span>{formatMoney(currentMetrics.marketValue, currency)}</span>
                    <span className={valueClass(currentMetrics.totalProfit)}>
                      {formatMoneyProfit(currentMetrics.totalProfit, currency)}
                    </span>
                    <span className={valueClass(currentMetrics.profitPercent)}>
                      {formatPercent(currentMetrics.profitPercent)}
                    </span>
                    <span>--</span>
                    <span />
                  </div>
                  {positionSnapshots.map((snapshot) => {
                    const metrics = calculateVersionMetrics(
                      snapshot.quantity,
                      snapshot.cost,
                      quote?.latest
                    )
                    const profitDifference =
                      metrics.totalProfit === null || currentMetrics.totalProfit === null
                        ? null
                        : metrics.totalProfit - currentMetrics.totalProfit
                    return (
                      <div className="position-snapshot-row" key={snapshot.id}>
                        <span className="position-snapshot-time">
                          {formatSnapshotTime(snapshot.createdAt)}
                        </span>
                        <input
                          className="position-snapshot-number"
                          type="number"
                          min={market === 'CN' ? 100 : 1}
                          step="100"
                          required
                          value={snapshot.quantity}
                          onChange={(event) =>
                            updateSnapshot(snapshot.id, {
                              quantity: Number(event.target.value)
                            })
                          }
                          aria-label={`${formatSnapshotTime(snapshot.createdAt)}持仓数量`}
                        />
                        <input
                          className="position-snapshot-number"
                          type="number"
                          step="0.0001"
                          required
                          value={snapshot.cost}
                          onChange={(event) =>
                            updateSnapshot(snapshot.id, {
                              cost: Number(event.target.value)
                            })
                          }
                          aria-label={`${formatSnapshotTime(snapshot.createdAt)}成本价`}
                        />
                        <span>{formatMoney(metrics.marketValue, currency)}</span>
                        <span className={valueClass(metrics.totalProfit)}>
                          {formatMoneyProfit(metrics.totalProfit, currency)}
                        </span>
                        <span className={valueClass(metrics.profitPercent)}>
                          {formatPercent(metrics.profitPercent)}
                        </span>
                        <span className={valueClass(profitDifference)}>
                          {formatMoneyProfit(profitDifference, currency)}
                        </span>
                        <button
                          className="icon-button position-snapshot-delete"
                          type="button"
                          onClick={() =>
                            setPositionSnapshots((current) =>
                              current.filter((item) => item.id !== snapshot.id)
                            )
                          }
                          title={`删除${formatSnapshotTime(snapshot.createdAt)}快照`}
                          aria-label={`删除${formatSnapshotTime(snapshot.createdAt)}快照`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                  {positionSnapshots.length === 0 ? (
                    <div className="position-snapshot-empty">
                      保存一次当前持仓，之后即可和新持仓实时比较。
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {capabilities.tradeLedger ? (
              <section className="trade-record-panel">
                <header>
                  <span>
                    <strong>交易记录</strong>
                    <small>
                      {positionRecords.length > 0
                        ? `显示最近 ${Math.min(5, positionRecords.length)} 条，共 ${positionRecords.length} 条；修改随“保存设置”保存`
                        : market === 'CN'
                          ? '做T交易和底仓增减会统一记录在这里'
                          : `${STOCK_MARKET_LABELS[market]}买卖流水、费用和预计交收日会统一记录在这里`}
                    </small>
                    {ledgerMetrics ? (
                      <small className="trade-ledger-summary">
                        已实现收益{' '}
                        <b className={valueClass(ledgerMetrics.realizedProfit)}>
                          {formatMoneyProfit(ledgerMetrics.realizedProfit, currency)}
                        </b>
                        {' · '}累计费用 {formatMoney(ledgerMetrics.totalFees, currency)}
                        {ledgerMetrics.realizedProfitCny !== null ? (
                          <>
                            {' · '}人民币已实现{' '}
                            <b className={valueClass(ledgerMetrics.realizedProfitCny)}>
                              {formatMoneyProfit(ledgerMetrics.realizedProfitCny, 'CNY')}
                            </b>
                          </>
                        ) : null}
                      </small>
                    ) : null}
                  </span>
                  {positionRecords.length > 5 ? (
                    <button
                      className="secondary-button trade-record-more"
                      type="button"
                      onClick={() => {
                        setTradeRecordPage(0)
                        setShowAllTradeRecords(true)
                      }}
                    >
                      查看更多
                    </button>
                  ) : null}
                </header>
                {market !== 'CN' ? (
                  <div
                    className="trade-record-create"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addTradeRecord()
                      }
                    }}
                  >
                    <div className="trade-record-create-fields">
                      <label>
                        <span>方向</span>
                        <select
                          value={newTradeDraft.side}
                          onChange={(event) => {
                            setNewTradeDraft((current) => ({
                              ...current,
                              side: event.target.value as TTradeSide
                            }))
                            setNewTradeError('')
                          }}
                        >
                          <option value="buy">买入</option>
                          <option value="sell">卖出</option>
                        </select>
                      </label>
                      <label>
                        <span>市场成交时间</span>
                        <input
                          type="datetime-local"
                          value={newTradeDraft.tradedAt}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              tradedAt: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>数量</span>
                        <input
                          type="number"
                          min="1"
                          step="100"
                          value={newTradeDraft.quantity}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              quantity: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>成交价</span>
                        <input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={newTradeDraft.price}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              price: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>实际费用</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newTradeDraft.actualFees}
                          placeholder={`自动 ${calculatedNewTradeFees.toFixed(2)}`}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              actualFees: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>兑人民币汇率</span>
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={newTradeDraft.exchangeRate}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              exchangeRate: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="trade-record-create-note">
                        <span>备注</span>
                        <input
                          type="text"
                          maxLength={100}
                          value={newTradeDraft.note}
                          onChange={(event) =>
                            setNewTradeDraft((current) => ({
                              ...current,
                              note: event.target.value
                            }))
                          }
                        />
                      </label>
                      {market === 'HK' ? (
                        <label className="trade-record-create-check">
                          <input
                            type="checkbox"
                            checked={newTradeDraft.stampDutyExempt}
                            onChange={(event) =>
                              setNewTradeDraft((current) => ({
                                ...current,
                                stampDutyExempt: event.target.checked
                              }))
                            }
                          />
                          <span>印花税豁免证券</span>
                        </label>
                      ) : null}
                      <button
                        className="primary-button compact-button"
                        type="button"
                        onClick={addTradeRecord}
                      >
                        添加交易
                      </button>
                    </div>
                    <small className="trade-record-create-preview">
                      自动费用：
                      {calculatedNewTradeFeeItems.length > 0
                        ? calculatedNewTradeFeeItems
                            .map((item) => `${item.label} ${item.amount.toFixed(2)}`)
                            .join(' · ')
                        : '0.00'}
                      {' · '}预计交收：
                      {estimateSettlementDate(
                        market,
                        newTradeDraft.tradedAt.slice(0, 10),
                        tradingCalendar
                      ) || '--'}
                      {' · '}留空实际费用时使用模板估算，券商账单优先
                    </small>
                    {newTradeError ? (
                      <small className="trade-record-create-error">{newTradeError}</small>
                    ) : null}
                  </div>
                ) : null}
                {recentPositionRecords.length > 0 ? (
                  <TradeRecordList records={recentPositionRecords} {...tradeRecordListProps} />
                ) : (
                  <div className="trade-record-empty">暂无交易记录</div>
                )}
              </section>
            ) : null}

            <footer className="position-dialog-actions">
              {stock.position ? (
                <button
                  className="clear-position-button"
                  type="button"
                  disabled={editingTradeId !== null}
                  onClick={() => savePosition(undefined)}
                >
                  清空持仓
                </button>
              ) : (
                <span />
              )}
              <span>
                <button className="secondary-button compact-button" type="button" onClick={onClose}>
                  取消
                </button>
                <button
                  className="primary-button compact-button"
                  type="submit"
                  disabled={editingTradeId !== null}
                  title={editingTradeId ? '请先保存或取消当前交易记录编辑' : undefined}
                >
                  保存设置
                </button>
              </span>
            </footer>
          </form>
        </section>
      </div>

      {capabilities.tradeLedger && showAllTradeRecords ? (
        <div
          className="trade-record-dialog-backdrop"
          role="presentation"
          onMouseDown={closeAllTradeRecords}
        >
          <section
            className="position-dialog trade-record-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-record-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeAllTradeRecords()
            }}
          >
            <header className="position-dialog-header">
              <div>
                <span className="position-dialog-icon">
                  <ReceiptText size={18} />
                </span>
                <span>
                  <strong id="trade-record-dialog-title">全部交易记录</strong>
                  <small>
                    {stock.name} · {stock.code} · 共 {positionRecords.length} 条
                  </small>
                </span>
              </div>
              <button
                className="icon-button dialog-close"
                type="button"
                autoFocus
                onClick={closeAllTradeRecords}
                aria-label="关闭全部交易记录"
              >
                <X size={18} />
              </button>
            </header>
            <div className="trade-record-dialog-content">
              <TradeRecordList records={visiblePositionRecords} {...tradeRecordListProps} />
            </div>
            <footer className="trade-record-dialog-footer">
              <span>每页 {TRADE_RECORD_PAGE_SIZE} 条</span>
              <div className="trade-record-pagination" aria-label="全部交易记录分页">
                <button
                  type="button"
                  onClick={() => setTradeRecordPage((current) => Math.max(0, current - 1))}
                  disabled={currentTradeRecordPage === 0}
                >
                  上一页
                </button>
                <span>
                  {currentTradeRecordPage + 1} / {tradeRecordPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTradeRecordPage((current) => Math.min(tradeRecordPageCount - 1, current + 1))
                  }
                  disabled={currentTradeRecordPage === tradeRecordPageCount - 1}
                >
                  下一页
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </>,
    document.body
  )
}
