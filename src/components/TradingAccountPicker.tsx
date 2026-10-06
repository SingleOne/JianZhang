import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { formatCost, formatMoney, formatMoneyProfit, formatShares } from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { getBatchTrades } from '../lib/trade-records'
import { calculateTBatchMetrics } from '../lib/t-trading'
import { currencyForMarket, STOCK_MARKET_LABELS } from '../shared/stock-market'
import type {
  ExchangeRateSettings,
  SecuritiesAccount,
  StockQuote,
  TTradingAccount,
  WatchStock
} from '../shared/types'
import './TradingAccountPicker.css'

interface TradingAccountPickerProps {
  value: string
  accounts: readonly SecuritiesAccount[]
  books: readonly TTradingAccount[]
  stock: WatchStock
  quote: StockQuote | undefined
  exchangeRates: ExchangeRateSettings
  disabled: boolean
  buttonRef: RefObject<HTMLButtonElement | null>
  onChange: (id: string) => void
}

function accountFeeRows(account: SecuritiesAccount): [string, string][] {
  const fees = account.feeSettings
  if (fees.market === 'CN') {
    return [
      ['净佣金', `万分之 ${fees.settings.commissionRatePerTenThousand}`],
      ['最低佣金组合', formatMoney(fees.settings.minimumCommissionBundle, 'CNY')],
      ['经手费', `万分之 ${fees.settings.handlingRatePerTenThousand}`],
      ['证管费', `万分之 ${fees.settings.regulatoryRatePerTenThousand}`],
      ['过户费', `万分之 ${fees.settings.transferRatePerTenThousand}`],
      ['卖出印花税', `万分之 ${fees.settings.stampDutyRatePerTenThousand}`]
    ]
  }
  if (fees.market === 'HK') {
    return [
      ['佣金比例', `${fees.settings.brokerageRatePercent}%`],
      ['最低佣金', formatMoney(fees.settings.minimumBrokerage, 'HKD')],
      ['平台费', formatMoney(fees.settings.platformFee, 'HKD')],
      ['交收费', fees.settings.includeSettlementFee ? '计入' : '不计入']
    ]
  }
  return [
    ['每股佣金', `${fees.settings.commissionPerShare} USD / 股`],
    ['最低佣金', formatMoney(fees.settings.minimumCommission, 'USD')],
    ['平台费', formatMoney(fees.settings.platformFee, 'USD')],
    ['SEC 费用', fees.settings.includeSecFee ? '计入' : '不计入'],
    ['FINRA TAF', fees.settings.includeFinraTaf ? '计入' : '不计入']
  ]
}

export function TradingAccountPicker(props: TradingAccountPickerProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const selectedAccount = props.accounts.find((account) => account.id === props.value)

  return (
    <>
      <button
        ref={props.buttonRef}
        className="text-button trading-account-picker-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`选择交易账户：${selectedAccount?.name ?? '未选择'}`}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        {selectedAccount?.name ?? '选择账户'}
      </button>
      {open ? <TradingAccountDialog {...props} onClose={close} /> : null}
    </>
  )
}

function TradingAccountDialog({
  value,
  accounts,
  books,
  stock,
  quote,
  exchangeRates,
  buttonRef,
  onChange,
  onClose
}: TradingAccountPickerProps & { onClose: () => void }) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreButtonFocus = useCallback(() => buttonRef.current?.focus(), [buttonRef])

  useEffect(() => {
    const dialogElement = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'Tab') {
        const buttons = dialogElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!buttons?.length) return
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      requestAnimationFrame(() => {
        if (!dialogElement?.isConnected) restoreButtonFocus()
      })
    }
  }, [onClose, restoreButtonFocus])

  return createPortal(
    <div
      className="trading-account-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="trading-account-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="trading-account-picker-header">
          <div>
            <h2 id={titleId}>选择交易账户</h2>
            <p id={descriptionId}>
              {stock.name}（{stock.code}）· 切换账户会清空当前录入内容
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="关闭账户选择弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="trading-account-picker-list">
          {accounts.map((owner) => {
            const book = books.find((account) => account.accountId === owner.id)
            const currency = currencyForMarket(owner.market)
            const scopedStock = {
              ...stock,
              position: book?.position,
              positionSnapshots: book?.positionSnapshots
            }
            const profit = calculateCurrentPositionProfitOverride(
              scopedStock,
              quote,
              book,
              exchangeRates,
              book?.performanceAdjustmentCny
            )
            const metrics = calculatePositionMetrics(
              book?.position,
              quote,
              book,
              exchangeRates,
              profit
            )
            const activeMetrics = calculateTBatchMetrics(
              book?.activeBatch,
              book ? getBatchTrades(book, book.activeBatch) : [],
              quote?.latest
            )
            const historyProfit = (book?.history ?? []).reduce(
              (total, batch) => total + (batch.settlement?.finalProfit ?? 0),
              0
            )
            const quantity = book?.position?.quantity ?? 0
            const marketValue =
              quantity === 0
                ? 0
                : quote?.latest === undefined || quote.latest === null
                  ? undefined
                  : quantity * quote.latest
            const selected = owner.id === value
            return (
              <button
                className={`trading-account-picker-option${selected ? ' is-selected' : ''}`}
                type="button"
                key={owner.id}
                aria-pressed={selected}
                disabled={!owner.enabled}
                onClick={() => {
                  if (!selected) onChange(owner.id)
                  onClose()
                }}
              >
                <span className="trading-account-picker-option-heading">
                  <strong>{owner.name}</strong>
                  <span className="trading-account-picker-badges">
                    <span>{owner.enabled ? '已启用' : '已停用'}</span>
                    {selected ? (
                      <span className="is-current">
                        <Check size={14} />
                        当前账户
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="trading-account-picker-market">
                  {STOCK_MARKET_LABELS[owner.market]} · {currency}
                </span>
                <span className="trading-account-picker-metrics">
                  <span>
                    <small>本股持仓</small>
                    <strong>{formatShares(quantity)}</strong>
                  </span>
                  <span>
                    <small>本股持仓成本</small>
                    <strong>
                      {metrics.holdingCost === null
                        ? '--'
                        : `${formatCost(metrics.holdingCost)} ${currency}`}
                    </strong>
                  </span>
                  <span>
                    <small>本股持仓市值</small>
                    <strong>{formatMoney(marketValue, currency)}</strong>
                  </span>
                  <span>
                    <small>当前 T 批次</small>
                    <strong>
                      {book?.activeBatch
                        ? `${activeMetrics.direction === 'reverse' ? '反T' : '正T'} · #${book.activeBatch.sequence}`
                        : '无'}
                    </strong>
                  </span>
                  <span>
                    <small>
                      {activeMetrics.direction === 'reverse' ? '待回补数量' : '当前 T 仓'}
                    </small>
                    <strong>{formatShares(activeMetrics.remainingQuantity)}</strong>
                  </span>
                  <span>
                    <small>交易笔数</small>
                    <strong>
                      {book?.tradeRecords.filter((trade) => trade.origin !== 'opening-balance')
                        .length ?? 0}{' '}
                      笔
                    </strong>
                  </span>
                  <span>
                    <small>已结算 T 批次</small>
                    <strong>{book?.history.length ?? 0} 个</strong>
                  </span>
                  <span>
                    <small>已结算 T 收益</small>
                    <strong
                      className={
                        historyProfit > 0 ? 'is-up' : historyProfit < 0 ? 'is-down' : 'is-flat'
                      }
                    >
                      {formatMoneyProfit(historyProfit, currency)}
                    </strong>
                  </span>
                </span>
                <span className="trading-account-picker-fees">
                  <strong>账户费用设置</strong>
                  <span className="trading-account-picker-fee-grid">
                    {accountFeeRows(owner).map(([label, amount]) => (
                      <span key={label}>
                        <span>{label}</span>
                        <span>{amount}</span>
                      </span>
                    ))}
                  </span>
                </span>
                {!owner.enabled ? (
                  <span className="trading-account-picker-disabled-note">恢复启用后可录入交易</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    </div>,
    document.body
  )
}
