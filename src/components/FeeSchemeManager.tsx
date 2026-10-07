import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { ACCOUNT_MARKETS, normalizeAccountState } from '../shared/stock-accounts'
import { STOCK_MARKET_LABELS } from '../shared/stock-market'
import {
  createCnFeeScheme,
  createDefaultFeeSchemes,
  DEFAULT_CN_FIXED_FEE_RATES,
  validateFeeConfiguration
} from '../shared/fee-schemes'
import type { AppState, BrokerFeeSchemes, CnFixedFeeRates, StockMarket } from '../shared/types'
import { AppButton } from './AppButton'
import { AppSelect } from './AppSelect'
import {
  FeeSchemeEditor,
  FixedFeeFields,
  feeSchemeDraft,
  fixedFeeDraft,
  newSchemeName,
  parseFeeSchemeDraft,
  parseFixedFeeDraft,
  type FeeSchemeDraft,
  type FeeSchemeDrafts
} from './FeeSchemeEditor'
import './SecuritiesAccounts.css'

const MARKET_OPTIONS = ACCOUNT_MARKETS.map((value) => ({
  value,
  label: STOCK_MARKET_LABELS[value]
}))

export function FeeSchemeManager({
  state,
  onSave,
  onClose
}: {
  state: AppState
  onSave: (schemes: BrokerFeeSchemes, defaults: CnFixedFeeRates) => Promise<boolean>
  onClose: () => void
}) {
  const [initial] = useState(() => normalizeAccountState(state))
  const [schemes, setSchemes] = useState<FeeSchemeDrafts>(() =>
    Object.fromEntries(
      Object.entries(initial.feeSchemes!).map(([id, scheme]) => [id, feeSchemeDraft(scheme)])
    )
  )
  const [defaults, setDefaults] = useState(() => fixedFeeDraft(initial.fixedFeeDefaults!))
  const [showDefaults, setShowDefaults] = useState(false)
  const [market, setMarket] = useState<StockMarket>('CN')
  const [selectedId, setSelectedId] = useState(
    () => Object.values(schemes).find((scheme) => scheme.market === 'CN')?.id ?? ''
  )
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
  const selected = schemes[selectedId]
  const accounts = Object.values(initial.securitiesAccounts!)
  const boundAccounts = accounts.filter((account) => account.feeSchemeId === selectedId)
  const changed = () => {
    setSaved(false)
    setError('')
  }
  const updateScheme = (draft: FeeSchemeDraft) => {
    setSchemes((current) => ({ ...current, [draft.id]: draft }))
    changed()
  }
  const makeScheme = (copy?: FeeSchemeDraft) => {
    try {
      const id = crypto.randomUUID()
      const name = newSchemeName(
        market,
        schemes,
        copy ? `${copy.name}副本` : `${STOCK_MARKET_LABELS[market]}费用方案`
      )
      const template =
        copy ??
        (market === 'CN'
          ? feeSchemeDraft(createCnFeeScheme(id, name, parseFixedFeeDraft(defaults)))
          : feeSchemeDraft(
              Object.values(createDefaultFeeSchemes(state.settings)).find(
                (scheme) => scheme.market === market
              )!
            ))
      updateScheme({ ...structuredClone(template), id, name })
      setSelectedId(id)
    } catch (reason) {
      setShowDefaults(true)
      setError(reason instanceof Error ? reason.message : '请填写有效费率')
    }
  }
  const removeScheme = () => {
    if (boundAccounts.length) {
      setError('该方案仍被账户绑定，请先在股票账户管理中为这些账户选择其他方案。')
      return
    }
    const remaining = { ...schemes }
    delete remaining[selectedId]
    setSchemes(remaining)
    setSelectedId(Object.values(remaining).find((scheme) => scheme.market === market)?.id ?? '')
    changed()
  }
  const save = async () => {
    let validatedSchemes: BrokerFeeSchemes
    let validatedDefaults: CnFixedFeeRates
    try {
      try {
        validatedDefaults = parseFixedFeeDraft(defaults)
      } catch (reason) {
        setShowDefaults(true)
        throw reason
      }
      validatedSchemes = {}
      for (const draft of Object.values(schemes)) {
        try {
          validatedSchemes[draft.id] = parseFeeSchemeDraft(draft)
        } catch (reason) {
          setMarket(draft.market)
          setSelectedId(draft.id)
          throw new Error(
            `${draft.name || '费用方案'}：${reason instanceof Error ? reason.message : '请检查费用配置'}`
          )
        }
      }
      validateFeeConfiguration(initial.securitiesAccounts!, validatedSchemes, validatedDefaults)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请检查费用配置')
      return
    }
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      if (await onSave(validatedSchemes, validatedDefaults)) setSaved(true)
      else setError('费用方案保存失败，请重试')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
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
        className="account-manager fee-scheme-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fee-scheme-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="account-manager-header">
          <div>
            <h2 id="fee-scheme-manager-title">费用方案管理</h2>
            <p>维护统一默认费率和可复用的券商费用方案。</p>
            <AppButton
              variant="text"
              disabled={saving}
              aria-expanded={showDefaults}
              onClick={() => setShowDefaults((value) => !value)}
            >
              {showDefaults ? '收起' : '维护'} A 股固定费率统一默认值
            </AppButton>
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

        <div className="fee-scheme-manager-body">
          {showDefaults ? (
            <section className="fee-defaults-panel">
              <div className="fee-section-heading">
                <h3>国家 / 交易所固定费率默认值</h3>
                <AppButton
                  variant="text"
                  disabled={saving}
                  onClick={() => {
                    setDefaults(fixedFeeDraft(DEFAULT_CN_FIXED_FEE_RATES))
                    changed()
                  }}
                >
                  恢复初始默认值
                </AppButton>
              </div>
              <FixedFeeFields
                values={defaults}
                disabled={saving}
                onChange={(code, value) => {
                  setDefaults((current) => ({ ...current, [code]: value }))
                  changed()
                }}
              />
              <p className="account-manager-notice">
                用于新建 A 股方案及“恢复统一默认值”；不会覆盖已有方案或账户微调。
              </p>
            </section>
          ) : null}
          <div className="account-manager-layout">
            <div className="account-manager-list">
              <div className="account-manager-actions">
                <AppSelect
                  value={market}
                  options={MARKET_OPTIONS}
                  label="费用方案市场"
                  disabled={saving}
                  className="account-manager-market-select"
                  onChange={(next) => {
                    setMarket(next)
                    setSelectedId(
                      Object.values(schemes).find((scheme) => scheme.market === next)?.id ?? ''
                    )
                    setError('')
                  }}
                />
                <AppButton
                  className="account-manager-add"
                  disabled={saving}
                  onClick={() => makeScheme()}
                >
                  <Plus size={14} />
                  <span>新增</span>
                </AppButton>
              </div>
              {Object.values(schemes)
                .filter((scheme) => scheme.market === market)
                .map((scheme) => (
                  <AppButton
                    variant="plain"
                    disabled={saving}
                    key={scheme.id}
                    className={`account-manager-account fee-scheme-list-item${scheme.id === selectedId ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedId(scheme.id)
                      setError('')
                    }}
                  >
                    <span>{scheme.name || '未命名方案'}</span>
                    <small>
                      {accounts.filter((account) => account.feeSchemeId === scheme.id).length}{' '}
                      个账户
                    </small>
                  </AppButton>
                ))}
              {!Object.values(schemes).some((scheme) => scheme.market === market) ? (
                <p className="account-manager-notice">暂无费用方案，点击“新增”创建。</p>
              ) : null}
            </div>
            <div className="account-manager-detail">
              {selected ? (
                <>
                  <FeeSchemeEditor
                    key={selected.id}
                    draft={selected}
                    defaults={defaults}
                    boundCount={boundAccounts.length}
                    boundAccountNames={boundAccounts.map(
                      (account) => `${account.name}${account.enabled ? '' : '（已停用）'}`
                    )}
                    headerActions={
                      <>
                        <AppButton disabled={saving} onClick={() => makeScheme(selected)}>
                          复制方案
                        </AppButton>
                        <AppButton variant="text" disabled={saving} onClick={removeScheme}>
                          删除方案
                        </AppButton>
                      </>
                    }
                    disabled={saving}
                    onChange={updateScheme}
                  />
                  <p className="account-manager-notice">
                    新建或复制方案后，请在“设置 → 交易 → 股票账户管理”中选择绑定。
                  </p>
                </>
              ) : (
                <p className="account-manager-notice">
                  请先为{STOCK_MARKET_LABELS[market]}新建费用方案。
                </p>
              )}
              <p className="account-manager-notice">
                修改方案不会自动重算历史费用。新交易、五档预测和主动重新估算均采用当前账户方案；重新估算保存后更新相关成本与收益。
              </p>
            </div>
          </div>
        </div>
        <footer>
          {error ? (
            <p className="account-manager-error" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="account-manager-status" role="status">
              费用方案已保存
            </p>
          ) : null}
          <AppButton variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '正在保存…' : '保存费用方案'}
          </AppButton>
        </footer>
      </section>
    </div>,
    document.body
  )
}
