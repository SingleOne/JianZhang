import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { formatMoney } from '../lib/format'
import { currencyForMarket, STOCK_MARKET_LABELS } from '../shared/stock-market'
import type { BrokerFeeSchemes, SecuritiesAccount } from '../shared/types'
import {
  accountFeeScheme,
  effectiveFixedFees,
  FIXED_FEE_CODES,
  FIXED_FEE_LABELS
} from '../shared/fee-schemes'
import { useSecuritiesAccountState } from './SecuritiesAccountContext'
import { AppButton } from './AppButton'
import './TradingAccountPicker.css'

interface TradingAccountPickerProps {
  value: string
  accounts: readonly SecuritiesAccount[]
  disabled: boolean
  buttonRef: RefObject<HTMLButtonElement | null>
  onChange: (id: string) => void
}

function accountFeeRows(account: SecuritiesAccount, schemes: BrokerFeeSchemes): [string, string][] {
  const fees = accountFeeScheme(account, schemes)
  if (fees.market === 'CN') {
    const fixed = effectiveFixedFees(account, fees)
    return [
      ['费用方案', fees.name],
      ['沪 A 佣金报价', `${fees.commission.SH.ratePerTenThousand}‱`],
      ['沪 A 最低起收', formatMoney(fees.commission.SH.minimumCommission, 'CNY')],
      [
        '沪 A 包含费用',
        fees.commission.SH.includedFees.map((code) => FIXED_FEE_LABELS[code]).join('、') || '无'
      ],
      ['深 A 佣金报价', `${fees.commission.SZ.ratePerTenThousand}‱`],
      ['深 A 最低起收', formatMoney(fees.commission.SZ.minimumCommission, 'CNY')],
      [
        '深 A 包含费用',
        fees.commission.SZ.includedFees.map((code) => FIXED_FEE_LABELS[code]).join('、') || '无'
      ],
      ...FIXED_FEE_CODES.map((code): [string, string] => [
        `${FIXED_FEE_LABELS[code]}${account.fixedFeeOverrides?.[code] !== undefined ? '（账户微调）' : ''}`,
        `${fixed[code]}‱${code === 'stampDuty' ? '（卖出）' : ''}`
      ]),
      ['取整规则', fees.roundingMode === 'half-up' ? '四舍五入' : '见分进位（只看第三位）']
    ]
  }
  if (fees.market === 'HK') {
    return [
      ['费用方案', fees.name],
      ['佣金比例', `${fees.settings.brokerageRatePercent}%`],
      ['最低佣金', formatMoney(fees.settings.minimumBrokerage, 'HKD')],
      ['平台费', formatMoney(fees.settings.platformFee, 'HKD')],
      ['交收费', fees.settings.includeSettlementFee ? '计入' : '不计入']
    ]
  }
  return [
    ['费用方案', fees.name],
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
      <AppButton
        variant="plain"
        ref={props.buttonRef}
        className="bordered-text-button text-button trading-account-picker-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`选择交易账户：${selectedAccount?.name ?? '未选择'}`}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        {selectedAccount?.name ?? '选择账户'}
      </AppButton>
      {open ? <TradingAccountDialog {...props} onClose={close} /> : null}
    </>
  )
}

function TradingAccountDialog({
  value,
  accounts,
  buttonRef,
  onChange,
  onClose
}: TradingAccountPickerProps & { onClose: () => void }) {
  const state = useSecuritiesAccountState()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)
  const selectedAccountIdRef = useRef<string | null>(null)
  const closeDialog = useCallback(() => {
    closeButtonRef.current?.focus()
    setClosing(true)
  }, [])
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
        closeDialog()
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
  }, [closeDialog, restoreButtonFocus])

  return createPortal(
    <div
      className={`trading-account-picker-backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation()
        closeDialog()
      }}
    >
      <section
        ref={dialogRef}
        className={`trading-account-picker-dialog${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.animationName === 'trading-account-picker-out' &&
            closing
          ) {
            const accountId = selectedAccountIdRef.current
            if (accountId && accountId !== value) onChange(accountId)
            onClose()
          }
        }}
      >
        <header className="trading-account-picker-header">
          <div>
            <h2 id={titleId}>选择交易账户</h2>
            <p id={descriptionId}>选择交易使用的账户，切换账户会清空当前录入内容</p>
          </div>
          <AppButton
            variant="plain"
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="关闭账户选择弹窗"
            onClick={closeDialog}
          >
            <X size={18} />
          </AppButton>
        </header>
        <div className="trading-account-picker-list">
          {accounts.map((owner) => {
            const currency = currencyForMarket(owner.market)
            const selected = owner.id === value
            return (
              <AppButton
                variant="plain"
                className={`trading-account-picker-option${selected ? ' is-selected' : ''}`}
                type="button"
                key={owner.id}
                aria-pressed={selected}
                disabled={closing || !owner.enabled}
                onClick={() => {
                  selectedAccountIdRef.current = selected ? null : owner.id
                  closeDialog()
                }}
              >
                <span className="trading-account-picker-option-heading">
                  <strong>{owner.name}</strong>
                  <span className="trading-account-picker-market">
                    {STOCK_MARKET_LABELS[owner.market]} · {currency}
                  </span>
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
                <span className="trading-account-picker-fees">
                  <span className="trading-account-picker-fee-grid">
                    {accountFeeRows(owner, state.feeSchemes!).map(([label, amount]) => (
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
              </AppButton>
            )
          })}
        </div>
      </section>
    </div>,
    document.body
  )
}
