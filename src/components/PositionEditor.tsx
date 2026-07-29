import { BriefcaseBusiness, Camera, ReceiptText, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCost, formatCurrency, formatPercent, formatPrice, formatProfit, formatShares } from '../lib/format'
import { currentDateKey } from '../lib/portfolio'
import { totalTradeFees } from '../lib/t-trading'
import type {
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  TTradingAccount,
  TTrade,
  TTradeRecord,
  WatchStock
} from '../shared/types'

interface PositionEditorProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
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
    history: []
  }

  return {
    ...currentAccount,
    baseTrades: [...(currentAccount.baseTrades ?? []), trade],
    tradeRecords: [
      ...(currentAccount.tradeRecords ?? []).filter((record) => record.id !== trade.id),
      trade
    ].sort((left, right) => right.tradedAt.localeCompare(left.tradedAt))
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

function TradeRecordList({ records }: { records: readonly TTradeRecord[] }) {
  return (
    <div className="trade-record-scroll">
      <div className="trade-record-list">
        {records.map((record) => {
          const fees = totalTradeFees(record.fees)
          const amountChange = record.side === 'buy'
            ? -(record.price * record.quantity + fees)
            : record.price * record.quantity - fees
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PositionEditor({ stock, quote, account, onSave, onClose }: PositionEditorProps) {
  const [quantity, setQuantity] = useState(stock.position?.quantity.toString() ?? '')
  const [cost, setCost] = useState(stock.position?.cost.toString() ?? '')
  const [openedOn, setOpenedOn] = useState(
    stock.position ? stock.position.openedOn ?? '' : currentDateKey()
  )
  const [showRadarSignals, setShowRadarSignals] = useState(stock.showRadarSignals)
  const [positionSnapshots, setPositionSnapshots] = useState<StockPositionSnapshot[]>(
    () => stock.positionSnapshots ?? []
  )
  const [showAllTradeRecords, setShowAllTradeRecords] = useState(false)
  const [tradeRecordPage, setTradeRecordPage] = useState(0)
  const hasPositionInput = quantity.trim() !== '' || cost.trim() !== ''
  const currentQuantity = Number(quantity) || 0
  const currentCost = Number(cost) || 0
  const currentMetrics = calculateVersionMetrics(currentQuantity, currentCost, quote?.latest)
  const tradeRecords = account?.tradeRecords ?? []
  const recentTradeRecords = tradeRecords.slice(0, 5)
  const tradeRecordPageCount = Math.ceil(tradeRecords.length / TRADE_RECORD_PAGE_SIZE)
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
                  account,
                  nextPosition.quantity,
                  nextPosition.cost,
                  nextPosition.openedOn
                )
              : undefined
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
                    ? `显示最近 ${Math.min(5, tradeRecords.length)} 条，共 ${tradeRecords.length} 条`
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
              <TradeRecordList records={recentTradeRecords} />
            ) : (
              <div className="trade-record-empty">暂无交易记录</div>
            )}
          </section>

          <footer className="position-dialog-actions">
            {stock.position ? (
              <button
                className="clear-position-button"
                type="button"
                onClick={() => onSave(undefined, showRadarSignals, positionSnapshots)}
              >
                清空持仓
              </button>
            ) : <span />}
            <span>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button>
              <button className="primary-button compact-button" type="submit">保存设置</button>
            </span>
          </footer>
        </form>
        </section>
      </div>

      {showAllTradeRecords ? (
        <div
          className="trade-record-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowAllTradeRecords(false)}
        >
          <section
            className="position-dialog trade-record-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-record-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowAllTradeRecords(false)
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
                onClick={() => setShowAllTradeRecords(false)}
                aria-label="关闭全部交易记录"
              >
                <X size={18} />
              </button>
            </header>
            <div className="trade-record-dialog-content">
              <TradeRecordList records={visibleTradeRecords} />
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
