import { PencilLine, ReceiptText, Trash2, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { deleteIndependentBaseTrade } from '../lib/base-trades'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPrice,
  formatShares
} from '../lib/format'
import {
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from '../lib/portfolio-ledger'
import {
  positionRecordLedgerEntries,
  type PositionRecordBoundary,
  type PositionRecordLedgerEntry
} from '../lib/position-ledger'
import { previewStockPositionRecordDeletion } from '../lib/position-record-deletion'
import { deleteStockTTrade } from '../lib/stock-t-trading'
import { totalRecordedTradeFees } from '../lib/t-trading'
import { getTradeAllocations, isIndependentBaseTrade } from '../lib/trade-records'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import type {
  CashDividendLedgerEntry,
  PortfolioLedgerEntry,
  StockPosition,
  StockTradingBook,
  TPlanDefaultSettings,
  TTradingAccount,
  TTrade,
  TTradeRecord,
  WatchStock,
  WithholdingTaxLedgerEntry
} from '../shared/types'
import { AppButton } from './AppButton'
import { useConfirmDialog } from './ConfirmDialog'
import { PositionBoundaryBadge } from './PositionBoundaryBadge'
import { TradeSplitSource } from './TradeSplitSource'
import './TransactionLedger.css'

export interface TransactionLedgerProps {
  stock: WatchStock
  accounts: readonly TTradingAccount[]
  book: StockTradingBook
  planDefaults: TPlanDefaultSettings
  onApply: (account: TTradingAccount, position: StockPosition | undefined) => void
  onApplyBook: (book: StockTradingBook) => void
  renderTradeEditor: (trade: TTrade, onComplete: () => void) => ReactNode
}

type CashEntry = CashDividendLedgerEntry | WithholdingTaxLedgerEntry
type LedgerEntry = Exclude<PortfolioLedgerEntry, { kind: 'reversal' }> & {
  positionBoundary?: PositionRecordBoundary
}
interface LedgerItem {
  account: TTradingAccount
  entry: LedgerEntry
}

const PAGE_SIZE = 15

function isCashEntry(entry: PortfolioLedgerEntry): entry is CashEntry {
  return entry.kind === 'cashDividend' || entry.kind === 'withholdingTax'
}

function cashAmount(entry: CashEntry): number {
  return entry.kind === 'cashDividend' ? entry.amount : -entry.amount
}

function valueClass(value: number): string {
  return value === 0 ? 'is-flat' : value > 0 ? 'is-up' : 'is-down'
}

function tradeTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function tradeLabel(trade: TTradeRecord): string {
  if (trade.origin === 'opening-balance') return '初始持仓'
  const allocations = getTradeAllocations(trade)
  const purposes = new Set(allocations.map((allocation) => allocation.purpose))
  if (purposes.size > 1) return trade.side === 'buy' ? 'T仓 / 底仓买入' : 'T仓 / 底仓卖出'
  const batches = new Set(allocations.map((allocation) => allocation.batchId).filter(Boolean))
  if (batches.size > 1) return trade.side === 'buy' ? '跨批次买入' : '跨批次卖出'
  if (isIndependentBaseTrade(trade)) return trade.side === 'buy' ? '底仓买入' : '底仓卖出'
  const direction = allocations.find((allocation) => allocation.batchDirection)?.batchDirection
  if ((direction ?? trade.batchDirection) === 'reverse') {
    return trade.side === 'buy' ? '回补买入' : '反T卖出'
  }
  return trade.side === 'buy' ? 'T仓买入' : 'T仓卖出'
}

function tradeContext(trade: TTradeRecord): string {
  if (trade.origin === 'opening-balance') return '初始余额'
  const labels = getTradeAllocations(trade)
    .filter((allocation) => allocation.purpose === 't' && allocation.batchSequence !== undefined)
    .map(
      (allocation) =>
        `${allocation.batchDirection === 'reverse' ? '反T' : '正T'}批次 #${allocation.batchSequence}`
    )
  return (
    [...new Set(labels)].join(' / ') || (isIndependentBaseTrade(trade) ? '独立底仓交易' : 'T仓交易')
  )
}

export function TransactionLedger({
  stock,
  accounts,
  book,
  planDefaults,
  onApply,
  onApplyBook,
  renderTradeEditor
}: TransactionLedgerProps) {
  const confirm = useConfirmDialog()
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)
  const [showAll, setShowAll] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewAllRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const finishEditing = useCallback(() => setEditingKey(null), [])
  const closeAll = useCallback(() => {
    setShowAll(false)
    setEditingKey(null)
    setError('')
  }, [])
  const entries = useMemo(
    () =>
      accounts
        .flatMap<LedgerItem>((account) => {
          const boundaries = new Map(
            positionRecordLedgerEntries(account).map((entry) => [entry.id, entry.positionBoundary])
          )
          return activePortfolioLedgerEntries(account).flatMap<LedgerItem>((entry) =>
            entry.kind === 'reversal'
              ? []
              : [{ account, entry: { ...entry, positionBoundary: boundaries.get(entry.id) } }]
          )
        })
        .sort(
          ({ entry: left }, { entry: right }) =>
            right.occurredAt.localeCompare(left.occurredAt) ||
            (right.recordedAt === right.occurredAt ? '' : (right.recordedAt ?? '')).localeCompare(
              left.recordedAt === left.occurredAt ? '' : (left.recordedAt ?? '')
            ) ||
            right.id.localeCompare(left.id)
        ),
    [accounts]
  )
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const cashAmounts = entries.flatMap(({ entry }) => {
    if (isCashEntry(entry)) return [cashAmount(entry)]
    if (entry.kind === 'cashAdjustment') return [entry.amount]
    if (entry.kind === 'corporateActionFee') return [-entry.amount]
    return []
  })
  const cashNet = cashAmounts.reduce((sum, amount) => sum + amount, 0)

  useEffect(() => {
    if (!showAll) return
    const previousFocus = viewAllRef.current
    closeRef.current?.focus()
    return () => previousFocus?.focus()
  }, [showAll])

  const editTrade = (account: TTradingAccount, trade: TTradeRecord) => {
    const batches = new Set(
      getTradeAllocations(trade)
        .map((allocation) => allocation.batchId)
        .filter(Boolean)
    )
    if (batches.size > 1) {
      setError('跨批次成交如需调整，请先删除该成交后重新录入')
      return
    }
    setError('')
    setEditingKey(`${account.accountId}:${trade.id}`)
  }

  const deleteTrade = (account: TTradingAccount, trade: TTradeRecord) => {
    try {
      if (isIndependentBaseTrade(trade)) {
        const result = deleteIndependentBaseTrade(
          account,
          trade.id,
          market,
          currency,
          account.position
        )
        if (result.error) throw new Error(`删除后账本不完整：${result.error}`)
        onApply(result.account, result.position)
      } else {
        onApplyBook(deleteStockTTrade(book, trade, planDefaults))
      }
      finishEditing()
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const deleteCash = (account: TTradingAccount, entry: CashEntry) => {
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

  const deleteAdjustment = async (account: TTradingAccount, entry: PositionRecordLedgerEntry) => {
    try {
      const deletion = previewStockPositionRecordDeletion(
        book,
        account.accountId!,
        entry.id,
        planDefaults
      )
      if (!deletion) return
      const details = deletion.accounts.map((item) => {
        const name = book.accounts[item.accountId].accountName ?? item.accountId
        const records = [...item.entries]
          .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
          .map(
            (record) =>
              `${tradeTime(record.occurredAt)} ${record.kind === 'trade' ? `${tradeLabel(record.record)} ${formatShares(record.record.quantity)}` : record.kind === 'positionAdjustment' ? '持仓校准' : '撤销流水'}`
          )
        return `${name}：${item.entries.length} 条\n${records.join('\n')}`
      })
      const confirmed = await confirm({
        title: '删除持仓校准及关联记录',
        message: [
          `确定删除 ${tradeTime(entry.occurredAt)} 的持仓校准及其后关联记录吗？`,
          deletion.batches.length
            ? `将完整删除关联 T 批次 ${deletion.batches.map((batch) => `#${batch.sequence}`).join('、')}，包括各账户关联成交及成本校准。`
            : '',
          ...details,
          '受影响账户的持仓和收益将按剩余流水重算。'
        ]
          .filter(Boolean)
          .join('\n\n'),
        confirmLabel: `删除 ${deletion.entryCount} 条记录`,
        tone: 'danger'
      })
      if (!confirmed) return
      onApplyBook(deletion.nextBook)
      finishEditing()
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const renderRows = (items: LedgerItem[], inDialog = false) => (
    <div className="t-trade-list">
      {items.map(({ account, entry }) => {
        const key = `${account.accountId}:${entry.id}`
        const accountName = account.accountName ?? account.accountId
        if (entry.kind === 'positionAdjustment') {
          return (
            <div className="t-trade-row" key={key}>
              <span className="t-base-trade-type">
                <span className="t-trade-side is-adjustment">持仓校准</span>
                <PositionBoundaryBadge boundary={entry.positionBoundary} />
              </span>
              <span>
                <strong>
                  {formatShares(entry.quantityBefore)} → {formatShares(entry.quantityAfter)}
                </strong>
                <small>
                  {accountName} · {tradeTime(entry.occurredAt)}
                </small>
                <small>
                  成本 {formatCost(entry.costBefore)} → {formatCost(entry.costAfter)}
                </small>
              </span>
              <span className="t-trade-amount">
                <small>{entry.resetsPerformance ? '收益基准重置' : entry.note || '持仓校准'}</small>
              </span>
              <span className="t-trade-actions">
                <AppButton
                  variant="icon"
                  title="删除持仓校准及关联记录"
                  onClick={() => void deleteAdjustment(account, entry)}
                >
                  <Trash2 size={14} />
                </AppButton>
              </span>
            </div>
          )
        }
        if (isCashEntry(entry)) {
          const amount = cashAmount(entry)
          const deletable = entry.source !== 'corporateAction' && !entry.corporateActionId
          return (
            <div className="t-trade-row" key={key}>
              <span
                className={`t-trade-side ${entry.kind === 'cashDividend' ? 'is-buy' : 'is-sell'}`}
              >
                {entry.kind === 'cashDividend' ? '分红' : '缴税'}
              </span>
              <span>
                <strong>
                  {entry.kind === 'cashDividend' && entry.eligibleQuantity > 0
                    ? `${formatShares(entry.eligibleQuantity)} · 每股 ${formatMoney(entry.amountPerShare, currency)}`
                    : entry.kind === 'cashDividend'
                      ? '税前分红'
                      : '预扣税款'}
                </strong>
                <small>
                  {accountName} · {tradeTime(entry.occurredAt)} ·{' '}
                  {entry.source === 'manual'
                    ? '手工录入'
                    : entry.source === 'corporateAction'
                      ? '公司行动'
                      : entry.source === 'brokerImport'
                        ? '券商导入'
                        : '交易录入'}
                </small>
              </span>
              <span className="t-trade-amount">
                <strong className={valueClass(amount)}>
                  {formatMoneyProfit(amount, currency)}
                </strong>
                <small>{entry.note || (entry.kind === 'cashDividend' ? '现金分红' : '缴税')}</small>
              </span>
              <span className="t-trade-actions">
                <AppButton
                  variant="icon"
                  disabled={!deletable}
                  title={deletable ? '删除现金流水' : '请在公司行动中撤销'}
                  onClick={() => deleteCash(account, entry)}
                >
                  <Trash2 size={14} />
                </AppButton>
              </span>
            </div>
          )
        }
        if (entry.kind !== 'trade') {
          const label =
            entry.kind === 'shareAdjustment'
              ? { stockDividend: '送转股', split: '拆股', reverseSplit: '合股' }[entry.actionType]
              : entry.kind === 'securityConversion'
                ? '证券转换'
                : entry.kind === 'rightsSubscription'
                  ? '配股认购'
                  : entry.kind === 'corporateActionFee'
                    ? '公司行动费用'
                    : '现金调整'
          const amount =
            entry.kind === 'rightsSubscription'
              ? -((entry.cost ?? entry.quantity * entry.price) + entry.fees)
              : entry.kind === 'corporateActionFee'
                ? -entry.amount
                : entry.kind === 'cashAdjustment'
                  ? entry.amount
                  : null
          return (
            <div className="t-trade-row" key={key}>
              <span className="t-base-trade-type">
                <span className="t-trade-side is-adjustment">{label}</span>
                <PositionBoundaryBadge boundary={entry.positionBoundary} />
              </span>
              <span>
                <strong>
                  {entry.kind === 'shareAdjustment' || entry.kind === 'securityConversion'
                    ? `${formatShares(entry.quantityBefore)} → ${formatShares(entry.quantityAfter)}`
                    : entry.kind === 'rightsSubscription'
                      ? `${formatShares(entry.quantity)} × ${formatPrice(entry.price)}`
                      : label}
                </strong>
                <small>
                  {accountName} · {tradeTime(entry.occurredAt)}
                </small>
                <small>{entry.note || label}</small>
              </span>
              <span className="t-trade-amount">
                {amount !== null ? (
                  <strong className={valueClass(amount)}>
                    {formatMoneyProfit(amount, entry.currency ?? currency)}
                  </strong>
                ) : null}
                <small>
                  {entry.source === 'corporateAction'
                    ? '公司行动流水'
                    : entry.source === 'brokerImport'
                      ? '券商导入'
                      : '手工录入'}
                </small>
              </span>
              <span className="t-trade-actions">
                {entry.source === 'corporateAction' || entry.corporateActionId ? (
                  <AppButton variant="icon" disabled title="请在公司行动中撤销">
                    <Trash2 size={14} />
                  </AppButton>
                ) : null}
              </span>
            </div>
          )
        }
        const trade = entry.record
        const editing = editingKey === `${account.accountId}:${trade.id}` && showAll === inDialog
        return (
          <Fragment key={key}>
            <div className="t-trade-row">
              <span className="t-base-trade-type">
                <span className={`t-trade-side is-${trade.side}`}>{tradeLabel(trade)}</span>
                <PositionBoundaryBadge boundary={entry.positionBoundary} />
              </span>
              <span>
                <strong>
                  {formatShares(trade.quantity)} × {formatPrice(trade.price)}
                </strong>
                <small>
                  {accountName} · {tradeTime(trade.tradedAt)} · 费用{' '}
                  {formatMoney(totalRecordedTradeFees(trade), currency)}
                </small>
                <small>{tradeContext(trade)}</small>
                {market !== 'CN' ? (
                  <small>
                    {trade.actualSettlementDate
                      ? `实际交收 ${trade.actualSettlementDate}`
                      : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}{' '}
                    ·{' '}
                    {trade.feeSource === 'actual'
                      ? '券商实际'
                      : trade.feeTemplate
                        ? `模板估算 v${trade.feeTemplate.version}`
                        : '来源未标记'}
                  </small>
                ) : null}
                {trade.splitSource ? (
                  <small>
                    <TradeSplitSource trade={trade} />
                  </small>
                ) : null}
              </span>
              <span className="t-trade-amount">
                <span>{formatMoney(trade.price * trade.quantity, currency)}</span>
                <small>{trade.note || tradeLabel(trade)}</small>
              </span>
              <span className="t-trade-actions">
                <AppButton
                  variant="icon"
                  title={editing ? '取消编辑交易' : '修改交易'}
                  onClick={() => (editing ? finishEditing() : editTrade(account, trade))}
                >
                  {editing ? <X size={14} /> : <PencilLine size={14} />}
                </AppButton>
                <AppButton
                  variant="icon"
                  title="删除交易"
                  onClick={() => deleteTrade(account, trade)}
                >
                  <Trash2 size={14} />
                </AppButton>
              </span>
            </div>
            {editing ? (
              <div className="t-trade-inline-editor">{renderTradeEditor(trade, finishEditing)}</div>
            ) : null}
          </Fragment>
        )
      })}
      {items.length === 0 ? <div className="t-transaction-empty">暂无交易记录</div> : null}
    </div>
  )

  return (
    <>
      <section className="t-card t-transaction-ledger-card" inert={showAll}>
        <div className="t-card-heading">
          <span>
            <strong>交易流水</strong>
            <small>底仓、T 仓及公司行动等全部流水 · 最近 {Math.min(5, entries.length)} 条</small>
          </span>
          <div className="t-batch-summary">
            {cashAmounts.length > 0 ? (
              <span>
                <small>现金净收入</small>
                <strong className={valueClass(cashNet)}>
                  {formatMoneyProfit(cashNet, currency)}
                </strong>
              </span>
            ) : null}
            <em>{entries.length} 笔流水</em>
            <AppButton
              ref={viewAllRef}
              variant="secondary"
              onClick={() => {
                setPage(0)
                finishEditing()
                setError('')
                setShowAll(true)
              }}
            >
              查看全部
            </AppButton>
          </div>
        </div>
        {renderRows(entries.slice(0, 5))}
        {!showAll && error ? (
          <div className="t-form-error" role="alert">
            {error}
          </div>
        ) : null}
      </section>
      {showAll
        ? createPortal(
            <div
              className="t-transaction-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                event.stopPropagation()
                if (event.target === event.currentTarget) closeAll()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  closeAll()
                }
                if (event.key === 'Tab') {
                  const targets = dialogRef.current?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
                  )
                  if (!targets?.length) return
                  const first = targets[0]
                  const last = targets[targets.length - 1]
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault()
                    last.focus()
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault()
                    first.focus()
                  }
                }
              }}
            >
              <section
                className="t-transaction-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="transaction-dialog-title"
              >
                <header className="t-transaction-dialog-header">
                  <span>
                    <ReceiptText size={19} />
                    <span>
                      <strong id="transaction-dialog-title">全部交易记录</strong>
                      <small>
                        {stock.name} · {stock.code} · 全部账户 · 共 {entries.length} 条
                      </small>
                    </span>
                  </span>
                  <AppButton
                    ref={closeRef}
                    variant="icon"
                    aria-label="关闭全部交易记录"
                    onClick={closeAll}
                  >
                    <X size={19} />
                  </AppButton>
                </header>
                <div className="t-transaction-dialog-content">
                  {error ? (
                    <div className="t-form-error" role="alert">
                      {error}
                    </div>
                  ) : null}
                  {renderRows(
                    entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
                    true
                  )}
                </div>
                <footer className="t-transaction-dialog-footer">
                  <span>每页 {PAGE_SIZE} 条 · 按时间倒序</span>
                  <div>
                    <AppButton
                      variant="secondary"
                      disabled={currentPage === 0}
                      onClick={() => {
                        finishEditing()
                        setPage(currentPage - 1)
                      }}
                    >
                      上一页
                    </AppButton>
                    <span>
                      {currentPage + 1} / {pageCount}
                    </span>
                    <AppButton
                      variant="secondary"
                      disabled={currentPage === pageCount - 1}
                      onClick={() => {
                        finishEditing()
                        setPage(currentPage + 1)
                      }}
                    >
                      下一页
                    </AppButton>
                  </div>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
