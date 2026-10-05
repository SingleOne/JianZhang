import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus } from 'lucide-react'
import {
  ACCOUNT_MARKETS,
  createDefaultAccounts,
  defaultAccountId,
  flattenStockAccountBooks,
  normalizeAccountState
} from '../shared/stock-accounts'
import { STOCK_MARKET_LABELS } from '../shared/stock-market'
import type {
  AccountFeeSettings,
  AppState,
  SecuritiesAccount,
  SecuritiesAccounts,
  StockMarket
} from '../shared/types'
import { AppSelect } from './AppSelect'
import './SecuritiesAccounts.css'

const FEE_LABELS: Record<string, string> = {
  commissionRatePerTenThousand: '净佣金（万分）',
  minimumCommissionBundle: '最低佣金组合（元）',
  handlingRatePerTenThousand: '经手费（万分）',
  regulatoryRatePerTenThousand: '证管费（万分）',
  transferRatePerTenThousand: '过户费（万分）',
  stampDutyRatePerTenThousand: '卖出印花税（万分）',
  brokerageRatePercent: '佣金比例（%）',
  minimumBrokerage: '最低佣金（HKD）',
  platformFee: '平台费',
  includeSettlementFee: '计入交收费',
  commissionPerShare: '每股佣金（USD）',
  minimumCommission: '最低佣金（USD）',
  includeSecFee: '计入 SEC 费用',
  includeFinraTaf: '计入 FINRA TAF'
}

const MARKET_OPTIONS = ACCOUNT_MARKETS.map((value) => ({
  value,
  label: STOCK_MARKET_LABELS[value]
}))

type AccountDraft = Omit<SecuritiesAccount, 'feeSettings'> & {
  feeSettings: { market: StockMarket; settings: Record<string, string | boolean> }
}
type AccountDrafts = Record<string, AccountDraft>

function accountDrafts(accounts: SecuritiesAccounts): AccountDrafts {
  return Object.fromEntries(
    Object.entries(accounts).map(([id, account]) => [
      id,
      {
        ...account,
        feeSettings: {
          market: account.market,
          settings: Object.fromEntries(
            Object.entries(account.feeSettings.settings).map(([key, value]) => [
              key,
              typeof value === 'boolean' ? value : String(value)
            ])
          )
        }
      }
    ])
  )
}

export function SecuritiesAccountManager({
  state,
  onSave,
  onClose
}: {
  state: AppState
  onSave: (accounts: SecuritiesAccounts) => Promise<boolean>
  onClose: () => void
}) {
  const [accounts, setAccounts] = useState(() =>
    accountDrafts(normalizeAccountState(state).securitiesAccounts!)
  )
  const [selectedId, setSelectedId] = useState(
    () => Object.values(accounts).find((account) => account.market === 'CN')?.id ?? ''
  )
  const [market, setMarket] = useState<StockMarket>('CN')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', escape)
    }
  }, [onClose, saving])
  const selected = accounts[selectedId]
  const books = Object.values(flattenStockAccountBooks(state.stockTradingBooks))
  const update = (changes: Partial<AccountDraft>) => {
    setAccounts((current) => ({ ...current, [selectedId]: { ...current[selectedId], ...changes } }))
    setSaved(false)
    setError('')
  }
  const add = () => {
    const id = crypto.randomUUID()
    let name = `${STOCK_MARKET_LABELS[market]}账户`
    let count = 1
    while (
      Object.values(accounts).some((account) => account.market === market && account.name === name)
    )
      name = `${STOCK_MARKET_LABELS[market]}账户 ${++count}`
    const template =
      Object.values(accounts).find((account) => account.market === market) ??
      accountDrafts(createDefaultAccounts(state.settings))[defaultAccountId(market)]
    setAccounts((current) => ({
      ...current,
      [id]: { ...structuredClone(template), id, name, enabled: true, isSystemDefault: false }
    }))
    setSelectedId(id)
    setSaved(false)
    setError('')
  }
  const toggle = () => {
    if (
      selected.enabled &&
      books.some(
        (book) =>
          book.accountId === selectedId && ((book.position?.quantity ?? 0) > 0 || book.activeBatch)
      )
    ) {
      setError('该账户仍有持仓或未结算 T 批次，请先处理后再停用。')
      return
    }
    update({ enabled: !selected.enabled })
  }
  const remove = () => {
    if (
      books.some((book) => book.accountId === selectedId) ||
      Object.values(state.corporateActionApplications).some(
        (record) => record.accountId === selectedId
      )
    ) {
      setError('该账户已有业务记录，可以停用并保留历史。')
      return
    }
    const { [selectedId]: _removed, ...remaining } = accounts
    setAccounts(remaining)
    setSelectedId(Object.values(remaining).find((account) => account.market === market)?.id ?? '')
    setSaved(false)
    setError('')
  }
  const save = async () => {
    const names = new Set<string>()
    const validated: SecuritiesAccounts = {}
    const feeTemplates = createDefaultAccounts(state.settings)
    for (const account of Object.values(accounts)) {
      const name = account.name.trim()
      const invalid = (message: string) => {
        setSelectedId(account.id)
        setMarket(account.market)
        setError(message)
      }
      if (!name) {
        invalid('请填写账户名称')
        return
      }
      const key = `${account.market}:${name}`
      if (account.enabled && names.has(key)) {
        invalid('同一市场的启用账户名称不能重复')
        return
      }
      if (account.enabled) names.add(key)
      if (
        Object.values(account.feeSettings.settings).some(
          (value) =>
            typeof value === 'string' &&
            (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0)
        )
      ) {
        invalid('费率和费用必须为有效的非负数字')
        return
      }
      const feeTemplate = feeTemplates[defaultAccountId(account.market)].feeSettings
      validated[account.id] = {
        ...account,
        name,
        feeSettings: {
          ...feeTemplate,
          settings: {
            ...feeTemplate.settings,
            ...Object.fromEntries(
              Object.entries(account.feeSettings.settings).map(([key, value]) => [
                key,
                typeof value === 'boolean' ? value : Number(value)
              ])
            )
          }
        } as AccountFeeSettings
      }
    }
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      if (await onSave(validated)) {
        setAccounts(accountDrafts(validated))
        setSaved(true)
      } else setError('账户保存失败，请重试')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账户保存失败')
    } finally {
      setSaving(false)
    }
  }
  return createPortal(
    <div
      className="account-manager-backdrop"
      onMouseDown={() => {
        if (!saving) onClose()
      }}
      role="presentation"
    >
      <section
        className="account-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="account-manager-title">股票账户</h2>
            <p>各账户独立管理持仓、交易费用和做 T。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <fieldset className="account-manager-layout" disabled={saving}>
          <div className="account-manager-list">
            <div className="account-manager-actions">
              <AppSelect
                value={market}
                options={MARKET_OPTIONS}
                label="股票市场"
                disabled={saving}
                className="account-manager-market-select"
                onChange={(next) => {
                  setMarket(next)
                  setSelectedId(
                    Object.values(accounts).find((account) => account.market === next)?.id ?? ''
                  )
                  setError('')
                }}
              />
              <button className="secondary-button account-manager-add" type="button" onClick={add}>
                <Plus size={14} />
                <span>新增</span>
              </button>
            </div>
            {Object.values(accounts)
              .filter((account) => account.market === market)
              .map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className={`account-manager-account${account.id === selectedId ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(account.id)
                    setError('')
                  }}
                >
                  <span>{account.name}</span>
                  {!account.enabled ? <small>已停用</small> : null}
                </button>
              ))}
            {!Object.values(accounts).some((account) => account.market === market) ? (
              <p className="account-manager-notice">暂无账户，点击“新增”创建。</p>
            ) : null}
          </div>
          {selected ? (
            <div>
              <div className="account-manager-fields">
                <label>
                  <span>账户名称</span>
                  <input
                    value={selected.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <label>
                  <span>所属市场</span>
                  <input value={STOCK_MARKET_LABELS[selected.market]} disabled />
                </label>
                {Object.entries(selected.feeSettings.settings).map(([key, value]) => (
                  <label key={key}>
                    <span>{FEE_LABELS[key]}</span>
                    <input
                      type={typeof value === 'boolean' ? 'checkbox' : 'number'}
                      min={typeof value === 'boolean' ? undefined : 0}
                      step={typeof value === 'boolean' ? undefined : '0.0001'}
                      checked={typeof value === 'boolean' ? value : undefined}
                      value={typeof value === 'string' ? value : undefined}
                      onChange={(event) =>
                        update({
                          feeSettings: {
                            ...selected.feeSettings,
                            settings: {
                              ...selected.feeSettings.settings,
                              [key]:
                                typeof value === 'boolean'
                                  ? event.target.checked
                                  : event.target.value
                            }
                          }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="account-manager-notice">
                费率修改用于之后的交易估算和五档预测，历史已保存费用保持不变。港美股市场费用仍按成交日期的模板计算。
              </p>
              <div className="account-manager-actions">
                <button type="button" className="secondary-button" onClick={toggle}>
                  {selected.enabled ? '停用账户' : '恢复启用'}
                </button>
                <button type="button" className="text-button" onClick={remove}>
                  删除空账户
                </button>
              </div>
            </div>
          ) : (
            <p className="account-manager-notice">
              请先为{STOCK_MARKET_LABELS[market]}创建股票账户。
            </p>
          )}
        </fieldset>
        {error ? (
          <p className="account-manager-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="account-manager-status" role="status">
            账户已保存
          </p>
        ) : null}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            关闭
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? '正在保存…' : '保存账户'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}
