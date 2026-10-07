import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus } from 'lucide-react'
import {
  ACCOUNT_MARKETS,
  flattenStockAccountBooks,
  normalizeAccountState
} from '../shared/stock-accounts'
import { STOCK_MARKET_LABELS } from '../shared/stock-market'
import { FIXED_FEE_CODES, validateFeeConfiguration } from '../shared/fee-schemes'
import type {
  AppState,
  CnFixedFeeRates,
  FixedFeeCode,
  SecuritiesAccount,
  SecuritiesAccounts,
  StockMarket
} from '../shared/types'
import { AppSelect } from './AppSelect'
import { AppInput } from './AppFormControls'
import { AppButton } from './AppButton'
import {
  FixedFeeFields,
  fixedFeeDraft,
  parseFeeNumber,
  type FixedFeeDraft
} from './FeeSchemeEditor'
import { getActiveStockTBatches } from '../shared/stock-t-batches'
import { getBatchTrades } from '../lib/trade-records'
import './SecuritiesAccounts.css'

const MARKET_OPTIONS = ACCOUNT_MARKETS.map((value) => ({
  value,
  label: STOCK_MARKET_LABELS[value]
}))
type AccountDraft = Omit<SecuritiesAccount, 'fixedFeeOverrides'> & {
  fixedFeeOverrides?: Partial<FixedFeeDraft>
}
type AccountDrafts = Record<string, AccountDraft>

function accountDrafts(accounts: SecuritiesAccounts): AccountDrafts {
  return Object.fromEntries(
    Object.entries(accounts).map(([id, account]) => [
      id,
      {
        ...account,
        fixedFeeOverrides: Object.fromEntries(
          Object.entries(account.fixedFeeOverrides ?? {}).map(([code, value]) => [
            code,
            String(value)
          ])
        )
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
  const [initial] = useState(() => normalizeAccountState(state))
  const [accounts, setAccounts] = useState(() => accountDrafts(initial.securitiesAccounts!))
  const schemes = initial.feeSchemes!
  const [selectedId, setSelectedId] = useState(
    () => Object.values(accounts).find((a) => a.market === 'CN')?.id ?? ''
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
  const boundScheme = selected ? schemes[selected.feeSchemeId] : undefined
  const books = Object.values(flattenStockAccountBooks(state.stockTradingBooks))
  const changed = () => {
    setSaved(false)
    setError('')
  }
  const selectAccount = (id: string) => {
    setSelectedId(id)
    setError('')
  }
  const update = (changes: Partial<AccountDraft>) => {
    setAccounts((current) => ({ ...current, [selectedId]: { ...current[selectedId], ...changes } }))
    changed()
  }
  const bindScheme = (feeSchemeId: string) => {
    update({ feeSchemeId, fixedFeeOverrides: {} })
  }
  const add = () => {
    const id = crypto.randomUUID()
    let name = `${STOCK_MARKET_LABELS[market]}账户`
    let count = 1
    while (
      Object.values(accounts).some((account) => account.market === market && account.name === name)
    )
      name = `${STOCK_MARKET_LABELS[market]}账户 ${++count}`
    const feeSchemeId = Object.values(schemes).find((scheme) => scheme.market === market)?.id
    if (!feeSchemeId) {
      setError(
        `暂无${STOCK_MARKET_LABELS[market]}费用方案，请先在“设置 → 交易 → 费用方案管理”中新建。`
      )
      return
    }
    setAccounts((current) => ({
      ...current,
      [id]: { id, name, market, feeSchemeId, enabled: true, isSystemDefault: false }
    }))
    setSelectedId(id)
    changed()
  }
  const toggle = () => {
    if (
      selected.enabled &&
      books.some(
        (book) =>
          book.accountId === selectedId &&
          ((book.position?.quantity ?? 0) > 0 ||
            getActiveStockTBatches(state.stockTradingBooks[book.quoteId]).some((batch) =>
              getBatchTrades(state.stockTradingBooks[book.quoteId], batch).some(
                (trade) => trade.accountId === selectedId
              )
            ))
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
    const remaining = { ...accounts }
    delete remaining[selectedId]
    const next = Object.values(remaining).find((account) => account.market === market)
    setAccounts(remaining)
    setSelectedId(next?.id ?? '')
    changed()
  }
  const save = async () => {
    const validated: SecuritiesAccounts = {}
    try {
      const names = new Set<string>()
      for (const account of Object.values(accounts)) {
        const name = account.name.trim()
        const key = `${account.market}:${name}`
        if (!name || (account.enabled && names.has(key))) {
          setMarket(account.market)
          selectAccount(account.id)
          throw new Error(!name ? '请填写账户名称' : '同一市场的启用账户名称不能重复')
        }
        if (account.enabled) names.add(key)
        const overrides: Partial<CnFixedFeeRates> = {}
        try {
          for (const code of FIXED_FEE_CODES) {
            const value = account.fixedFeeOverrides?.[code]
            if (value !== undefined) overrides[code] = parseFeeNumber(value)
          }
        } catch (reason) {
          setMarket(account.market)
          selectAccount(account.id)
          throw new Error(`${name}：${reason instanceof Error ? reason.message : '请检查费用配置'}`)
        }
        validated[account.id] = {
          ...account,
          name,
          fixedFeeOverrides: Object.keys(overrides).length ? overrides : undefined
        }
      }
      validateFeeConfiguration(validated, schemes, initial.fixedFeeDefaults!)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请检查费用配置')
      return
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
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }
  const schemeOptions = Object.values(schemes)
    .filter((scheme) => scheme.market === market)
    .map((scheme) => ({ value: scheme.id, label: scheme.name }))
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
        <header className="account-manager-header">
          <div>
            <h2 id="account-manager-title">股票账户管理</h2>
            <p>管理各市场的股票账户、绑定费用方案及账户费率微调。</p>
          </div>
          <AppButton
            variant="icon"
            className="account-manager-close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <X size={18} />
          </AppButton>
        </header>
        <div className="account-manager-layout">
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
                  selectAccount(
                    Object.values(accounts).find((account) => account.market === next)?.id ?? ''
                  )
                }}
              />
              <AppButton className="account-manager-add" disabled={saving} onClick={add}>
                <Plus size={14} />
                <span>新增</span>
              </AppButton>
            </div>
            {Object.values(accounts)
              .filter((account) => account.market === market)
              .map((account) => (
                <AppButton
                  variant="plain"
                  disabled={saving}
                  key={account.id}
                  className={`account-manager-account${account.id === selectedId ? ' is-selected' : ''}`}
                  onClick={() => selectAccount(account.id)}
                >
                  <span>{account.name}</span>
                  {!account.enabled ? <small>已停用</small> : null}
                </AppButton>
              ))}
            {!Object.values(accounts).some((account) => account.market === market) ? (
              <p className="account-manager-notice">暂无账户，点击“新增”创建。</p>
            ) : null}
          </div>
          <div className="account-manager-detail">
            {selected && selected.market === market ? (
              <>
                <div className="account-manager-fields">
                  <label>
                    <span>账户名称</span>
                    <AppInput
                      value={selected.name}
                      disabled={saving}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>所属市场</span>
                    <AppInput value={STOCK_MARKET_LABELS[selected.market]} disabled />
                  </label>
                  <label className="fee-account-binding">
                    <span>绑定费用方案</span>
                    <AppSelect
                      value={selected.feeSchemeId}
                      options={schemeOptions}
                      label="账户费用方案"
                      disabled={saving}
                      onChange={bindScheme}
                    />
                  </label>
                </div>
                <p className="account-manager-notice">
                  切换方案采用新方案默认费率，并清除本账户的固定费率微调。
                </p>
                {boundScheme?.market === 'CN' ? (
                  <section className="fee-account-overrides">
                    <div className="fee-section-heading">
                      <h3>本账户固定费率</h3>
                      <AppButton
                        variant="text"
                        disabled={saving}
                        onClick={() => update({ fixedFeeOverrides: {} })}
                      >
                        恢复方案默认值
                      </AppButton>
                    </div>
                    <FixedFeeFields
                      values={{
                        ...fixedFeeDraft(boundScheme.fixedFees),
                        ...selected.fixedFeeOverrides
                      }}
                      inherited={fixedFeeDraft(boundScheme.fixedFees)}
                      disabled={saving}
                      onChange={(code: FixedFeeCode, value) =>
                        update({
                          fixedFeeOverrides: { ...selected.fixedFeeOverrides, [code]: value }
                        })
                      }
                    />
                    <p className="account-manager-notice">
                      仅本账户生效；未微调的项目跟随绑定方案。
                    </p>
                  </section>
                ) : null}
                <div className="account-manager-actions">
                  <AppButton disabled={saving} onClick={toggle}>
                    {selected.enabled ? '停用账户' : '恢复启用'}
                  </AppButton>
                  <AppButton variant="text" disabled={saving} onClick={remove}>
                    删除空账户
                  </AppButton>
                </div>
              </>
            ) : (
              <p className="account-manager-notice">
                请先为{STOCK_MARKET_LABELS[market]}创建股票账户。
              </p>
            )}
            <p className="account-manager-notice">
              方案的佣金参数与取整规则请在“设置 → 交易 → 费用方案管理”中调整。
            </p>
          </div>
        </div>
        {error ? (
          <p className="account-manager-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="account-manager-status" role="status">
            股票账户已保存
          </p>
        ) : null}
        <footer>
          <AppButton variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '正在保存…' : '保存账户'}
          </AppButton>
        </footer>
      </section>
    </div>,
    document.body
  )
}
