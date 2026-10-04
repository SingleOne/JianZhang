import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus } from 'lucide-react'
import {
  ACCOUNT_MARKETS,
  defaultAccountId,
  flattenStockAccountBooks,
  normalizeAccountState
} from '../shared/stock-accounts'
import { STOCK_MARKET_LABELS } from '../shared/stock-market'
import type { AccountFeeSettings, AppState, SecuritiesAccounts, StockMarket } from '../shared/types'
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
    structuredClone(normalizeAccountState(state).securitiesAccounts!)
  )
  const [selectedId, setSelectedId] = useState(defaultAccountId('CN'))
  const [market, setMarket] = useState<StockMarket>('CN')
  const [error, setError] = useState('')
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
  const update = (changes: Partial<typeof selected>) =>
    setAccounts((current) => ({ ...current, [selectedId]: { ...current[selectedId], ...changes } }))
  const add = () => {
    const id = crypto.randomUUID()
    let name = `${STOCK_MARKET_LABELS[market]}账户`
    let count = 1
    while (
      Object.values(accounts).some((account) => account.market === market && account.name === name)
    )
      name = `${STOCK_MARKET_LABELS[market]}账户 ${++count}`
    setAccounts((current) => ({
      ...current,
      [id]: {
        ...structuredClone(current[defaultAccountId(market)]),
        id,
        name,
        isSystemDefault: false
      }
    }))
    setSelectedId(id)
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
    setError('')
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
    setSelectedId(defaultAccountId(market))
    setError('')
  }
  const save = async () => {
    const names = new Set<string>()
    for (const account of Object.values(accounts)) {
      const name = account.name.trim()
      if (!name) {
        setError('请填写账户名称')
        return
      }
      const key = `${account.market}:${name}`
      if (account.enabled && names.has(key)) {
        setError('同一市场的启用账户名称不能重复')
        return
      }
      if (account.enabled) names.add(key)
      if (
        Object.values(account.feeSettings.settings).some(
          (value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0)
        )
      ) {
        setError('费率和费用必须为有效的非负数字')
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const trimmed = Object.fromEntries(
        Object.entries(accounts).map(([id, account]) => [
          id,
          { ...account, name: account.name.trim() }
        ])
      )
      if (await onSave(trimmed)) onClose()
      else setError('账户保存失败，请重试')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账户保存失败')
    } finally {
      setSaving(false)
    }
  }
  return createPortal(
    <div className="account-manager-backdrop" onMouseDown={onClose} role="presentation">
      <section
        className="account-manager"
        role="dialog"
        aria-modal="true"
        aria-label="股票账户管理"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>股票账户</strong>
            <p>各账户独立管理持仓、交易费用和做 T。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="account-manager-layout">
          <div className="account-manager-list">
            <div className="account-manager-actions">
              <select
                value={market}
                onChange={(event) => {
                  const next = event.target.value as StockMarket
                  setMarket(next)
                  setSelectedId(defaultAccountId(next))
                  setError('')
                }}
              >
                {ACCOUNT_MARKETS.map((value) => (
                  <option value={value} key={value}>
                    {STOCK_MARKET_LABELS[value]}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="button" onClick={add}>
                <Plus size={14} />
                新增
              </button>
            </div>
            {Object.values(accounts)
              .filter((account) => account.market === market)
              .map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className={account.id === selectedId ? 'is-selected' : ''}
                  onClick={() => {
                    setSelectedId(account.id)
                    setError('')
                  }}
                >
                  {account.name}
                  <small>
                    {account.isSystemDefault ? ' · 系统默认' : ''}
                    {!account.enabled ? ' · 已停用' : ''}
                  </small>
                </button>
              ))}
          </div>
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
                <input value={STOCK_MARKET_LABELS[selected.market]} readOnly />
              </label>
              {Object.entries(selected.feeSettings.settings).map(([key, value]) => (
                <label key={key}>
                  <span>{FEE_LABELS[key]}</span>
                  <input
                    type={typeof value === 'boolean' ? 'checkbox' : 'number'}
                    min={typeof value === 'boolean' ? undefined : 0}
                    step={typeof value === 'boolean' ? undefined : '0.0001'}
                    checked={typeof value === 'boolean' ? value : undefined}
                    value={typeof value === 'number' ? value : undefined}
                    onChange={(event) =>
                      update({
                        feeSettings: {
                          ...selected.feeSettings,
                          settings: {
                            ...selected.feeSettings.settings,
                            [key]:
                              typeof value === 'boolean'
                                ? event.target.checked
                                : Number(event.target.value)
                          }
                        } as AccountFeeSettings
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              <small>
                费率修改用于之后的交易估算和五档预测，历史已保存费用保持不变。港美股市场费用仍按成交日期的模板计算。
              </small>
            </p>
            {!selected.isSystemDefault ? (
              <div className="account-manager-actions">
                <button type="button" className="secondary-button" onClick={toggle}>
                  {selected.enabled ? '停用账户' : '恢复启用'}
                </button>
                <button type="button" className="text-button" onClick={remove}>
                  删除空账户
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="account-manager-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            取消
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
