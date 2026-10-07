import { useState, type ReactNode } from 'react'
import { FIXED_FEE_CODES, FIXED_FEE_LABELS } from '../shared/fee-schemes'
import type {
  BrokerFeeScheme,
  BrokerCommissionRule,
  CnFeeExchange,
  CnFixedFeeRates,
  FeeRoundingMode,
  FixedFeeCode,
  StockMarket
} from '../shared/types'
import { calculateSchemeTradeFees } from '../lib/broker-fees'
import { formatMoney } from '../lib/format'
import { AppInput } from './AppFormControls'
import { AppButton } from './AppButton'
import { AppSelect } from './AppSelect'
import './FeeSchemeEditor.css'

export type FixedFeeDraft = Record<FixedFeeCode, string>
type CommissionDraft = Omit<BrokerCommissionRule, 'ratePerTenThousand' | 'minimumCommission'> & {
  ratePerTenThousand: string
  minimumCommission: string
}
export type FeeSchemeDraft =
  | {
      id: string
      name: string
      market: 'CN'
      fixedFees: FixedFeeDraft
      commission: Record<CnFeeExchange, CommissionDraft>
      roundingMode: FeeRoundingMode
      existingCommissionMode?: 'net' | 'inclusive'
    }
  | { id: string; name: string; market: 'HK' | 'US'; settings: Record<string, string | boolean> }
export type FeeSchemeDrafts = Record<string, FeeSchemeDraft>

export function fixedFeeDraft(fees: CnFixedFeeRates): FixedFeeDraft {
  return Object.fromEntries(
    FIXED_FEE_CODES.map((code) => [code, String(fees[code])])
  ) as FixedFeeDraft
}

export function feeSchemeDraft(scheme: BrokerFeeScheme): FeeSchemeDraft {
  if (scheme.market === 'CN') {
    const rule = (exchange: CnFeeExchange) => ({
      ...scheme.commission[exchange],
      ratePerTenThousand: String(scheme.commission[exchange].ratePerTenThousand),
      minimumCommission: String(scheme.commission[exchange].minimumCommission)
    })
    return {
      ...structuredClone(scheme),
      fixedFees: fixedFeeDraft(scheme.fixedFees),
      commission: { SH: rule('SH'), SZ: rule('SZ') }
    }
  }
  return {
    ...scheme,
    settings: Object.fromEntries(
      Object.entries(scheme.settings).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? value : String(value)
      ])
    )
  }
}

export function parseFeeNumber(value: string | boolean): number {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new Error('费率和费用必须为有效的非负数字')
  return Number(value)
}
export function parseFixedFeeDraft(draft: FixedFeeDraft): CnFixedFeeRates {
  return Object.fromEntries(
    FIXED_FEE_CODES.map((code) => [code, parseFeeNumber(draft[code])])
  ) as CnFixedFeeRates
}
export function parseFeeSchemeDraft(draft: FeeSchemeDraft): BrokerFeeScheme {
  const name = draft.name.trim()
  if (!name) throw new Error('请填写费用方案名称')
  if (draft.market === 'CN') {
    const rule = (exchange: CnFeeExchange): BrokerCommissionRule => ({
      ...draft.commission[exchange],
      ratePerTenThousand: parseFeeNumber(draft.commission[exchange].ratePerTenThousand),
      minimumCommission: parseFeeNumber(draft.commission[exchange].minimumCommission)
    })
    return {
      ...draft,
      name,
      fixedFees: parseFixedFeeDraft(draft.fixedFees),
      commission: { SH: rule('SH'), SZ: rule('SZ') }
    }
  }
  const settings = draft.settings
  if (draft.market === 'HK')
    return {
      id: draft.id,
      name,
      market: 'HK',
      settings: {
        brokerageRatePercent: parseFeeNumber(settings.brokerageRatePercent),
        minimumBrokerage: parseFeeNumber(settings.minimumBrokerage),
        platformFee: parseFeeNumber(settings.platformFee),
        includeSettlementFee: settings.includeSettlementFee === true
      }
    }
  return {
    id: draft.id,
    name,
    market: 'US',
    settings: {
      commissionPerShare: parseFeeNumber(settings.commissionPerShare),
      minimumCommission: parseFeeNumber(settings.minimumCommission),
      platformFee: parseFeeNumber(settings.platformFee),
      includeSecFee: settings.includeSecFee === true,
      includeFinraTaf: settings.includeFinraTaf === true
    }
  }
}

export function FixedFeeFields({
  values,
  onChange,
  inherited,
  disabled = false
}: {
  values: FixedFeeDraft
  onChange: (code: FixedFeeCode, value: string) => void
  inherited?: FixedFeeDraft
  disabled?: boolean
}) {
  return (
    <div className="fee-fixed-fields">
      {FIXED_FEE_CODES.map((code) => (
        <label key={code}>
          <span>{FIXED_FEE_LABELS[code]}（‱）</span>
          <AppInput
            type="number"
            min={0}
            step="0.0001"
            value={values[code]}
            disabled={disabled}
            onChange={(event) => onChange(code, event.target.value)}
          />
          {inherited ? <small>方案默认：{inherited[code]}‱</small> : null}
        </label>
      ))}
    </div>
  )
}

const GLOBAL_FEE_LABELS: Record<string, string> = {
  brokerageRatePercent: '佣金比例（%）',
  minimumBrokerage: '最低佣金（HKD）',
  platformFee: '平台费',
  includeSettlementFee: '计入交收费',
  commissionPerShare: '每股佣金（USD）',
  minimumCommission: '最低佣金（USD）',
  includeSecFee: '计入 SEC 费用',
  includeFinraTaf: '计入 FINRA TAF'
}

export function FeeSchemeEditor({
  draft,
  defaults,
  boundCount,
  boundAccountNames = [],
  headerActions,
  disabled,
  onChange
}: {
  draft: FeeSchemeDraft
  defaults: FixedFeeDraft
  boundCount: number
  boundAccountNames?: readonly string[]
  headerActions?: ReactNode
  disabled: boolean
  onChange: (draft: FeeSchemeDraft) => void
}) {
  return (
    <section className="fee-scheme-editor">
      <div className="fee-scheme-heading">
        <label className="fee-scheme-name">
          <span>费用方案名称</span>
          <AppInput
            value={draft.name}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        {headerActions ? <div className="fee-scheme-actions">{headerActions}</div> : null}
      </div>
      <p className="fee-scheme-binding">
        <span>
          已绑定 {boundCount} 个账户
          {boundAccountNames.length ? `：${boundAccountNames.join('、')}` : ''}
        </span>
        <span>修改影响所有绑定账户；只调整一个账户时，复制方案后到股票账户管理中绑定。</span>
      </p>
      {draft.market === 'CN' ? (
        <>
          <div className="fee-section-heading">
            <h3>国家 / 交易所固定费率</h3>
            <AppButton
              variant="text"
              disabled={disabled}
              onClick={() => onChange({ ...draft, fixedFees: { ...defaults } })}
            >
              恢复统一默认值
            </AppButton>
          </div>
          <FixedFeeFields
            values={draft.fixedFees}
            disabled={disabled}
            onChange={(code, value) =>
              onChange({ ...draft, fixedFees: { ...draft.fixedFees, [code]: value } })
            }
          />
          <p className="account-manager-notice">
            固定费率可以按券商微调；印花税仅卖出计收，过户费非零时最低 0.01 元。
          </p>
          <h3>券商佣金参数</h3>
          <p className="account-manager-notice">
            佣金报价包含下方勾选的费用；微调固定费率不会自动改变报价。要保持净佣金费率不变，请同步调整报价。
          </p>
          <div className="fee-commission-exchanges">
            {(['SH', 'SZ'] as const).map((exchange) => {
              const rule = draft.commission[exchange]
              const change = (next: Partial<CommissionDraft>) =>
                onChange({
                  ...draft,
                  commission: { ...draft.commission, [exchange]: { ...rule, ...next } }
                })
              return (
                <section className="fee-commission-card" key={exchange}>
                  <h4>{exchange === 'SH' ? '沪 A' : '深 A / 其他 A 股'}</h4>
                  <div className="account-manager-fields">
                    <label>
                      <span>佣金报价（‱）</span>
                      <AppInput
                        type="number"
                        min={0}
                        step="0.0001"
                        value={rule.ratePerTenThousand}
                        disabled={disabled}
                        onChange={(event) => change({ ratePerTenThousand: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>最低起收（元）</span>
                      <AppInput
                        type="number"
                        min={0}
                        step="0.01"
                        value={rule.minimumCommission}
                        disabled={disabled}
                        onChange={(event) => change({ minimumCommission: event.target.value })}
                      />
                    </label>
                  </div>
                  <p>佣金报价及最低起收包含：</p>
                  <div className="fee-included-options">
                    {FIXED_FEE_CODES.map((code) => (
                      <label key={code}>
                        <AppInput
                          type="checkbox"
                          checked={rule.includedFees.includes(code)}
                          disabled={disabled}
                          onChange={(event) =>
                            change({
                              includedFees: event.target.checked
                                ? [...rule.includedFees, code]
                                : rule.includedFees.filter((item) => item !== code)
                            })
                          }
                        />
                        <span>{FIXED_FEE_LABELS[code]}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
          <label className="fee-scheme-rounding">
            <span>保留两位小数</span>
            <AppSelect<FeeRoundingMode>
              value={draft.roundingMode}
              disabled={disabled}
              label="费用取整规则"
              options={[
                { value: 'half-up', label: '四舍五入' },
                { value: 'next-digit-up', label: '见分进位（只看第三位）' }
              ]}
              onChange={(roundingMode) => onChange({ ...draft, roundingMode })}
            />
          </label>
          <p className="account-manager-notice">
            见分进位：1.231 → 1.24，1.23001 →
            1.23。每项费用取整后，佣金不足最低起收的部分补入净佣金。
          </p>
          <FeeSchemePreview draft={draft} disabled={disabled} />
        </>
      ) : (
        <div className="account-manager-fields">
          {Object.entries(draft.settings).map(([key, value]) => (
            <label key={key}>
              <span>{GLOBAL_FEE_LABELS[key]}</span>
              <AppInput
                type={typeof value === 'boolean' ? 'checkbox' : 'number'}
                min={typeof value === 'boolean' ? undefined : 0}
                step={typeof value === 'boolean' ? undefined : '0.0001'}
                disabled={disabled}
                checked={typeof value === 'boolean' ? value : undefined}
                value={typeof value === 'string' ? value : undefined}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      [key]: typeof value === 'boolean' ? event.target.checked : event.target.value
                    }
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

function FeeSchemePreview({ draft, disabled }: { draft: FeeSchemeDraft; disabled: boolean }) {
  const [amount, setAmount] = useState('8957')
  const [exchange, setExchange] = useState<CnFeeExchange>('SZ')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  let result: ReturnType<typeof calculateSchemeTradeFees> | undefined
  let error = ''
  try {
    const scheme = parseFeeSchemeDraft(draft)
    if (scheme.market === 'CN') result = calculateSchemeTradeFees(amount, side, scheme, exchange)
  } catch (reason) {
    error = reason instanceof Error ? reason.message : '请填写有效参数'
  }
  return (
    <section className="fee-scheme-preview">
      <h3>方案费用试算</h3>
      <div className="fee-preview-inputs">
        <label>
          <span>成交额（元）</span>
          <AppInput
            type="number"
            min={0}
            step="0.01"
            value={amount}
            disabled={disabled}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <AppSelect<CnFeeExchange>
          value={exchange}
          disabled={disabled}
          label="试算市场"
          options={[
            { value: 'SH', label: '沪 A' },
            { value: 'SZ', label: '深 A / 其他 A 股' }
          ]}
          onChange={setExchange}
        />
        <AppSelect<'buy' | 'sell'>
          value={side}
          disabled={disabled}
          label="试算方向"
          options={[
            { value: 'buy', label: '买入' },
            { value: 'sell', label: '卖出' }
          ]}
          onChange={setSide}
        />
      </div>
      {result ? (
        <>
          <dl className="fee-preview-results">
            {(['commission', ...FIXED_FEE_CODES] as const).map((code) => (
              <div key={code}>
                <dt>{code === 'commission' ? '净佣金' : FIXED_FEE_LABELS[code]}</dt>
                <dd>{formatMoney(result.fees[code], 'CNY')}</dd>
              </div>
            ))}
            <div>
              <dt>总费用</dt>
              <dd>{formatMoney(result.total, 'CNY')}</dd>
            </div>
          </dl>
          <p className="account-manager-notice">
            最低起收补入净佣金：{formatMoney(result.minimumTopUp, 'CNY')}
            。此处试算使用方案费率，账户微调另在账户中配置。
          </p>
        </>
      ) : (
        <p className="account-manager-error" role="status">
          {error}
        </p>
      )}
    </section>
  )
}

export function newSchemeName(
  market: StockMarket,
  drafts: FeeSchemeDrafts,
  base = '费用方案'
): string {
  let name = base
  let count = 1
  while (Object.values(drafts).some((scheme) => scheme.market === market && scheme.name === name))
    name = `${base} ${++count}`
  return name
}
