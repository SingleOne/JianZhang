import {
  BriefcaseBusiness,
  Camera,
  Check,
  PencilLine,
  ReceiptText,
  Trash2,
  X
} from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCost, formatCurrency, formatPercent, formatPrice, formatProfit, formatShares } from '../lib/format'
import { currentDateKey } from '../lib/portfolio'
import {
  detachTradeRecordsFromBatch,
  sortTradeRecords,
  upsertTradeRecord
} from '../lib/trade-records'
import {
  calculateTBatchMetrics,
  recalculatePositionFromBatch,
  rebalanceTBatchPlans,
  roundMoney,
  totalTradeFees,
  validateTBatchTrades
} from '../lib/t-trading'
import type {
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingBatch,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeRecord,
  TTradeSide,
  WatchStock
} from '../shared/types'

interface PositionEditorProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  planDefaults: TPlanDefaultSettings
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
  if (quantity <= 0 || cost <= 0) {
    return { marketValue: 0, totalProfit: 0, profitPercent: null }
  }
  return {
    marketValue: latest * quantity,
    totalProfit: (latest - cost) * quantity,
    profitPercent: (latest / cost - 1) * 100
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
  }).format(new Date(value)).replaceAll('/', '-')
}

function defaultSnapshotName(createdAt: string): string {
  return formatSnapshotTime(createdAt)
}

function localDateTimeInput(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

function createOpeningTradeAccount(
  stock: WatchStock,
  account: TTradingAccount | undefined,
  quantity: number,
  cost: number,
  openedOn: string
): TTradingAccount {
  const trade: TTrade = {
    id: crypto.randomUUID(),
    side: 'buy',
    purpose: 'base',
    tradedAt: openedOn === currentDateKey() ? localDateTimeInput() : `${openedOn}T09:30`,
    price: cost,
    quantity,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    note: '首次建仓'
  }
  const currentAccount: TTradingAccount = account ?? {
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    history: [],
    tradeRecords: []
  }

  return {
    ...currentAccount,
    tradeRecords: upsertTradeRecord(currentAccount.tradeRecords, trade)
  }
}

const TRADE_RECORD_PAGE_SIZE = 15

function formatTradeTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function tradeRecordLabel(record: TTradeRecord): string {
  if (record.purpose === 'base') return record.side === 'buy' ? '底仓买入' : '底仓卖出'
  if ((record.batchDirection ?? 'forward') === 'reverse') {
    return record.side === 'sell' ? '反T卖出' : '回补买入'
  }
  return record.side === 'buy' ? 'T仓买入' : 'T仓卖出'
}

function tradeRecordContext(record: TTradeRecord): string {
  if (record.batchSequence === undefined) return '独立底仓'
  return `${(record.batchDirection ?? 'forward') === 'reverse' ? '反T' : '正T'}批次 #${record.batchSequence}`
}

function createTradeRecordDraft(record: TTradeRecord): TradeRecordDraft {
  return {
    side: record.side,
    purpose: record.purpose,
    tradedAt: record.tradedAt.slice(0, 16),
    price: record.price.toString(),
    quantity: record.quantity.toString(),
    fees: totalTradeFees(record.fees).toString(),
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

function refreshBatchSettlement(
  batch: TTradingBatch,
  trades: readonly TTrade[]
): TTradingBatch {
  if (!batch.settlement) return batch
  const ledgerProfit = calculateTBatchMetrics(batch, trades).realizedProfit
  const settlement = {
    ...batch.settlement,
    ledgerProfit,
    finalProfit: batch.settlement.source === 'ledger'
      ? ledgerProfit
      : batch.settlement.finalProfit
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
  if (activeBatch && activeBatch.id === record.batchId) {
    const nextBatch = activeBatch
    const nextBatchTrades = sortTradeRecords(
      nextRecords.filter((item) => item.batchId === nextBatch.id),
      'ascending'
    )
    const validationError = validateTBatchTrades(nextBatch, nextBatchTrades)
    if (validationError) {
      return { account, updatesPosition: false, error: validationError }
    }
    const plannedBatch = rebalanceTBatchPlans(nextBatch, nextBatchTrades, planDefaults)
    const hasTTrades = nextBatchTrades.some((trade) => trade.purpose === 't')
    const finalRecords = hasTTrades
      ? nextRecords
      : detachTradeRecordsFromBatch(nextRecords, nextBatch.id)
    return {
      account: {
        ...account,
        activeBatch: hasTTrades ? plannedBatch : undefined,
        tradeRecords: finalRecords
      },
      position: recalculatePositionFromBatch(plannedBatch, nextBatchTrades),
      updatesPosition: true
    }
  }

  const historyIndex = account.history.findIndex((batch) => (
    batch.id === record.batchId
  ))
  if (historyIndex >= 0) {
    const batch = account.history[historyIndex]
    const nextBatchTrades = sortTradeRecords(
      nextRecords.filter((item) => item.batchId === batch.id),
      'ascending'
    )
    const validationError = validateTBatchTrades(batch, nextBatchTrades)
    if (validationError) {
      return { account, updatesPosition: false, error: validationError }
    }
    const history = account.history.map((item, index) => (
      index === historyIndex ? refreshBatchSettlement(batch, nextBatchTrades) : item
    ))
    return {
      account: { ...account, history, tradeRecords: nextRecords },
      updatesPosition: false
    }
  }

  return {
    account: { ...account, tradeRecords: nextRecords },
    updatesPosition: false
  }
}

interface TradeRecordListProps {
  records: readonly TTradeRecord[]
  editingTradeId: string | null
  draft: TradeRecordDraft | null
  error: string
  onStartEdit: (record: TTradeRecord) => void
  onDraftChange: (changes: Partial<TradeRecordDraft>) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: (record: TTradeRecord) => void
}

function TradeRecordList({
  records,
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
        {records.map((record) => {
          const fees = totalTradeFees(record.fees)
          const amountChange = record.side === 'buy'
            ? -(record.price * record.quantity + fees)
            : record.price * record.quantity - fees
          const isEditing = editingTradeId === record.id && draft
          if (isEditing) {
            const tBuyLabel = (record.batchDirection ?? 'forward') === 'reverse'
              ? '回补买入'
              : 'T仓买入'
            const tSellLabel = (record.batchDirection ?? 'forward') === 'reverse'
              ? '反T卖出'
              : 'T仓卖出'
            return (
              <div
                className="trade-record-row is-editing"
                key={record.id}
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
                  onChange={(event) => {
                    const [purpose, side] = event.target.value.split(':') as [TTradePurpose, TTradeSide]
                    onDraftChange({ purpose, side })
                  }}
                  aria-label="交易类型"
                >
                  <option value="base:buy">底仓买入</option>
                  <option value="base:sell">底仓卖出</option>
                  {record.batchId ? <option value="t:buy">{tBuyLabel}</option> : null}
                  {record.batchId ? <option value="t:sell">{tSellLabel}</option> : null}
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
                      min="100"
                      step="100"
                      value={draft.quantity}
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
                </span>
                <span className="trade-record-edit-hint">保存后重新计算</span>
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
            <div className="trade-record-row" key={record.id}>
              <span className={`trade-record-side is-${record.side}`}>
                {tradeRecordLabel(record)}
              </span>
              <span>
                <strong>{tradeRecordContext(record)}</strong>
                <small>{formatTradeTime(record.tradedAt)}</small>
              </span>
              <span>
                <strong>{formatShares(record.quantity)} × {formatPrice(record.price)}</strong>
                <small>费用 {formatCurrency(fees)}</small>
              </span>
              <strong className={valueClass(amountChange)}>
                金额变动 {formatProfit(amountChange)}
              </strong>
              <small title={record.note || undefined}>{record.note || '--'}</small>
              <span className="trade-record-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onStartEdit(record)}
                  title="编辑本条交易"
                  aria-label="编辑本条交易"
                >
                  <PencilLine size={14} />
                </button>
                <button
                  className="icon-button is-delete"
                  type="button"
                  onClick={() => onDelete(record)}
                  title="删除本条交易"
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
  onSave,
  onClose
}: PositionEditorProps) {
  const [quantity, setQuantity] = useState(stock.position?.quantity.toString() ?? '')
  const [cost, setCost] = useState(stock.position?.cost.toString() ?? '')
  const [openedOn, setOpenedOn] = useState(
    stock.position ? stock.position.openedOn ?? '' : currentDateKey()
  )
  const [showRadarSignals, setShowRadarSignals] = useState(stock.showRadarSignals)
  const [positionSnapshots, setPositionSnapshots] = useState<StockPositionSnapshot[]>(
    () => stock.positionSnapshots ?? []
  )
  const [editedAccount, setEditedAccount] = useState<TTradingAccount | undefined>()
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [tradeRecordDraft, setTradeRecordDraft] = useState<TradeRecordDraft | null>(null)
  const [tradeRecordError, setTradeRecordError] = useState('')
  const [showAllTradeRecords, setShowAllTradeRecords] = useState(false)
  const [tradeRecordPage, setTradeRecordPage] = useState(0)
  const hasPositionInput = quantity.trim() !== '' || cost.trim() !== ''
  const currentQuantity = Number(quantity) || 0
  const currentCost = Number(cost) || 0
  const currentMetrics = calculateVersionMetrics(currentQuantity, currentCost, quote?.latest)
  const workingAccount = editedAccount ?? account
  const tradeRecords = workingAccount?.tradeRecords ?? []
  const recentTradeRecords = tradeRecords.slice(0, 5)
  const tradeRecordPageCount = Math.max(
    1,
    Math.ceil(tradeRecords.length / TRADE_RECORD_PAGE_SIZE)
  )
  const currentTradeRecordPage = Math.min(
    tradeRecordPage,
    Math.max(0, tradeRecordPageCount - 1)
  )
  const visibleTradeRecords = tradeRecords.slice(
    currentTradeRecordPage * TRADE_RECORD_PAGE_SIZE,
    (currentTradeRecordPage + 1) * TRADE_RECORD_PAGE_SIZE
  )

  const addSnapshot = () => {
    if (!stock.position) return
    const createdAt = new Date().toISOString()
    setPositionSnapshots((current) => [{
      id: crypto.randomUUID(),
      name: defaultSnapshotName(createdAt),
      createdAt,
      quantity: stock.position!.quantity,
      cost: stock.position!.cost
    }, ...current])
  }

  const updateSnapshot = (
    snapshotId: string,
    changes: Partial<Pick<StockPositionSnapshot, 'quantity' | 'cost'>>
  ) => {
    setPositionSnapshots((current) => current.map((snapshot) => (
      snapshot.id === snapshotId ? { ...snapshot, ...changes } : snapshot
    )))
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

  const saveTradeRecord = () => {
    if (!workingAccount || !editingTradeId || !tradeRecordDraft) return
    const record = tradeRecords.find((item) => item.id === editingTradeId)
    if (!record) return

    const price = Number(tradeRecordDraft.price)
    const tradeQuantity = Number(tradeRecordDraft.quantity)
    const fees = Number(tradeRecordDraft.fees)
    if (
      !tradeRecordDraft.tradedAt
      || !Number.isFinite(price)
      || price <= 0
      || !Number.isFinite(fees)
      || fees < 0
    ) {
      setTradeRecordError('请填写有效的成交时间、价格和费用')
      return
    }
    if (tradeQuantity <= 0 || !Number.isInteger(tradeQuantity) || tradeQuantity % 100 !== 0) {
      setTradeRecordError('成交数量必须是 100 股的整数倍')
      return
    }

    const nextTrade: TTrade = {
      id: record.id,
      side: tradeRecordDraft.side,
      purpose: tradeRecordDraft.purpose,
      tradedAt: tradeRecordDraft.tradedAt,
      price,
      quantity: tradeQuantity,
      fees: feesWithTotal(record.fees, roundMoney(fees)),
      note: tradeRecordDraft.note.trim()
    }
    const result = updateTradeAccount(workingAccount, record, nextTrade, planDefaults)
    if (result.error) {
      setTradeRecordError(result.error)
      return
    }
    setEditedAccount(result.account)
    if (result.updatesPosition) {
      setQuantity(result.position?.quantity.toString() ?? '')
      setCost(result.position?.cost.toString() ?? '')
    }
    cancelEditingTradeRecord()
  }

  const deleteTradeRecord = (record: TTradeRecord) => {
    if (!workingAccount) return
    if (!window.confirm(`确定删除 ${formatTradeTime(record.tradedAt)} 的${tradeRecordLabel(record)}记录吗？`)) {
      return
    }
    const result = updateTradeAccount(workingAccount, record, undefined, planDefaults)
    if (result.error) {
      setEditingTradeId(record.id)
      setTradeRecordDraft(createTradeRecordDraft(record))
      setTradeRecordError(result.error)
      return
    }
    setEditedAccount(result.account)
    if (result.updatesPosition) {
      setQuantity(result.position?.quantity.toString() ?? '')
      setCost(result.position?.cost.toString() ?? '')
    }
    if (editingTradeId === record.id) cancelEditingTradeRecord()
  }

  const tradeRecordListProps = {
    editingTradeId,
    draft: tradeRecordDraft,
    error: tradeRecordError,
    onStartEdit: startEditingTradeRecord,
    onDraftChange: (changes: Partial<TradeRecordDraft>) => {
      setTradeRecordDraft((current) => current ? { ...current, ...changes } : current)
      setTradeRecordError('')
    },
    onSaveEdit: saveTradeRecord,
    onCancelEdit: cancelEditingTradeRecord,
    onDelete: deleteTradeRecord
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
            <span className="position-dialog-icon"><BriefcaseBusiness size={18} /></span>
            <span>
              <span className="position-dialog-title-line">
                <strong id="position-dialog-title">编辑持仓</strong>
                <label className="position-header-radar-switch">
                  <span>显示异动数据</span>
                  <input
                    className="switch-input"
                    type="checkbox"
                    checked={showRadarSignals}
                    onChange={(event) => setShowRadarSignals(event.target.checked)}
                  />
                </label>
              </span>
              <small>{stock.name} · {stock.code}</small>
            </span>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <form
          className="position-form"
          onSubmit={(event) => {
            event.preventDefault()
            const nextPosition = hasPositionInput ? {
              quantity: Number(quantity),
              cost: Number(cost),
              openedToday: openedOn === currentDateKey(),
              openedOn
            } : undefined
            const updatedAccount = !stock.position && nextPosition
              ? createOpeningTradeAccount(
                  stock,
                  workingAccount,
                  nextPosition.quantity,
                  nextPosition.cost,
                  nextPosition.openedOn
                )
              : editedAccount
            onSave(nextPosition, showRadarSignals, positionSnapshots, updatedAccount)
          }}
        >
          <div className="position-fields">
            <label>
              <span>持仓数量</span>
              <span className="position-input-wrap">
                <input
                  type="number"
                  min="100"
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
                  min="0.0001"
                  step="0.0001"
                  required={hasPositionInput}
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="例如 12.5800"
                />
                <span>元</span>
              </span>
            </label>
            <label>
              <span>建仓日期</span>
              <span className="position-input-wrap">
                <input
                  type="date"
                  max={currentDateKey()}
                  required={hasPositionInput}
                  value={openedOn}
                  onChange={(event) => setOpenedOn(event.target.value)}
                />
              </span>
            </label>
          </div>
          <section className="position-snapshot-panel">
            <header>
              <span>
                <strong>持仓快照</strong>
                <small>
                  当前价 {formatPrice(quote?.latest)}，快照修改随“保存设置”一并保存
                </small>
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
                  <strong>{currentCost > 0 ? formatCost(currentCost) : '--'}</strong>
                  <span>{formatCurrency(currentMetrics.marketValue)}</span>
                  <span className={valueClass(currentMetrics.totalProfit)}>
                    {formatProfit(currentMetrics.totalProfit)}
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
                  const profitDifference = metrics.totalProfit === null
                    || currentMetrics.totalProfit === null
                    ? null
                    : metrics.totalProfit - currentMetrics.totalProfit
                  return (
                    <div className="position-snapshot-row" key={snapshot.id}>
                      <span className="position-snapshot-time">{formatSnapshotTime(snapshot.createdAt)}</span>
                      <input
                        className="position-snapshot-number"
                        type="number"
                        min="100"
                        step="100"
                        required
                        value={snapshot.quantity}
                        onChange={(event) => updateSnapshot(snapshot.id, {
                          quantity: Number(event.target.value)
                        })}
                        aria-label={`${formatSnapshotTime(snapshot.createdAt)}持仓数量`}
                      />
                      <input
                        className="position-snapshot-number"
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        required
                        value={snapshot.cost}
                        onChange={(event) => updateSnapshot(snapshot.id, {
                          cost: Number(event.target.value)
                        })}
                        aria-label={`${formatSnapshotTime(snapshot.createdAt)}成本价`}
                      />
                      <span>{formatCurrency(metrics.marketValue)}</span>
                      <span className={valueClass(metrics.totalProfit)}>
                        {formatProfit(metrics.totalProfit)}
                      </span>
                      <span className={valueClass(metrics.profitPercent)}>
                        {formatPercent(metrics.profitPercent)}
                      </span>
                      <span className={valueClass(profitDifference)}>
                        {formatProfit(profitDifference)}
                      </span>
                      <button
                        className="icon-button position-snapshot-delete"
                        type="button"
                        onClick={() => setPositionSnapshots((current) => (
                          current.filter((item) => item.id !== snapshot.id)
                        ))}
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

          <section className="trade-record-panel">
            <header>
              <span>
                <strong>交易记录</strong>
                <small>
                  {tradeRecords.length > 0
                    ? `显示最近 ${Math.min(5, tradeRecords.length)} 条，共 ${tradeRecords.length} 条；修改随“保存设置”保存`
                    : '做T交易和底仓增减会统一记录在这里'}
                </small>
              </span>
              {tradeRecords.length > 5 ? (
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
            {recentTradeRecords.length > 0 ? (
              <TradeRecordList records={recentTradeRecords} {...tradeRecordListProps} />
            ) : (
              <div className="trade-record-empty">暂无交易记录</div>
            )}
          </section>

          <footer className="position-dialog-actions">
            {stock.position ? (
              <button
                className="clear-position-button"
                type="button"
                disabled={editingTradeId !== null}
                onClick={() => onSave(
                  undefined,
                  showRadarSignals,
                  positionSnapshots,
                  editedAccount
                )}
              >
                清空持仓
              </button>
            ) : <span />}
            <span>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button>
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

      {showAllTradeRecords ? (
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
                <span className="position-dialog-icon"><ReceiptText size={18} /></span>
                <span>
                  <strong id="trade-record-dialog-title">全部交易记录</strong>
                  <small>{stock.name} · {stock.code} · 共 {tradeRecords.length} 条</small>
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
              <TradeRecordList records={visibleTradeRecords} {...tradeRecordListProps} />
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
                <span>{currentTradeRecordPage + 1} / {tradeRecordPageCount}</span>
                <button
                  type="button"
                  onClick={() => setTradeRecordPage((current) => (
                    Math.min(tradeRecordPageCount - 1, current + 1)
                  ))}
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
