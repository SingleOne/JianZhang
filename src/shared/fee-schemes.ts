import {
  DEFAULT_APP_SETTINGS,
  type AccountFeeSettings,
  type AppSettings,
  type AppState,
  type BrokerFeeScheme,
  type BrokerFeeSchemes,
  type CnBrokerFeeScheme,
  type CnFeeExchange,
  type CnFixedFeeRates,
  type FixedFeeCode,
  type SecuritiesAccount,
  type SecuritiesAccounts,
  type StockMarket
} from './types'

export const FIXED_FEE_CODES: readonly FixedFeeCode[] = [
  'handling',
  'regulatory',
  'transfer',
  'stampDuty'
]
export const FIXED_FEE_LABELS: Record<FixedFeeCode, string> = {
  handling: '经手费',
  regulatory: '证管费',
  transfer: '过户费',
  stampDuty: '印花税'
}
export const DEFAULT_CN_FIXED_FEE_RATES: CnFixedFeeRates = {
  handling: 0.341,
  regulatory: 0.2,
  transfer: 0.1,
  stampDuty: 5
}
export const DEFAULT_INCLUDED_FEES: readonly FixedFeeCode[] = ['handling', 'regulatory', 'transfer']

export function defaultFeeSchemeId(market: StockMarket): string {
  return `default-fees:${market}`
}

export function createCnFeeScheme(
  id: string,
  name: string,
  fixedFees = DEFAULT_CN_FIXED_FEE_RATES
): CnBrokerFeeScheme {
  const rule = {
    ratePerTenThousand: Number(
      (
        DEFAULT_APP_SETTINGS.tTradingFees.commissionRatePerTenThousand +
        DEFAULT_INCLUDED_FEES.reduce((total, code) => total + fixedFees[code], 0)
      ).toFixed(10)
    ),
    minimumCommission: DEFAULT_APP_SETTINGS.tTradingFees.minimumCommissionBundle,
    includedFees: [...DEFAULT_INCLUDED_FEES]
  }
  return {
    id,
    name,
    market: 'CN',
    fixedFees: { ...fixedFees },
    commission: { SH: structuredClone(rule), SZ: structuredClone(rule) },
    roundingMode: 'half-up'
  }
}

/** 只在配置升级时使用；交易读取路径不接受旧账户 feeSettings。 */
export function feeSchemeFromLegacy(
  id: string,
  name: string,
  fees: AccountFeeSettings
): BrokerFeeScheme {
  if (fees.market !== 'CN') return { id, name, ...structuredClone(fees) }
  const settings = fees.settings
  const fixedFees = {
    handling: settings.handlingRatePerTenThousand,
    regulatory: settings.regulatoryRatePerTenThousand,
    transfer: settings.transferRatePerTenThousand,
    stampDuty: settings.stampDutyRatePerTenThousand
  }
  const makeRule = (exchange: CnFeeExchange) => {
    const includedFees: FixedFeeCode[] =
      settings.commissionIncludesFees || exchange === 'SZ'
        ? [...DEFAULT_INCLUDED_FEES]
        : ['handling', 'regulatory']
    return {
      ratePerTenThousand: settings.commissionIncludesFees
        ? settings.commissionRatePerTenThousand
        : Number(
            (
              settings.commissionRatePerTenThousand +
              includedFees.reduce((total, code) => total + fixedFees[code], 0)
            ).toFixed(10)
          ),
      minimumCommission: settings.minimumCommissionBundle,
      includedFees
    }
  }
  return {
    id,
    name,
    market: 'CN',
    fixedFees,
    commission: { SH: makeRule('SH'), SZ: makeRule('SZ') },
    roundingMode: 'half-up',
    existingCommissionMode: settings.commissionIncludesFees ? 'inclusive' : 'net'
  }
}

export function createDefaultFeeSchemes(settings = DEFAULT_APP_SETTINGS): BrokerFeeSchemes {
  return Object.fromEntries(
    (['CN', 'HK', 'US'] as const).map((market) => {
      const fees: AccountFeeSettings =
        market === 'CN'
          ? { market, settings: settings.tTradingFees }
          : market === 'HK'
            ? { market, settings: settings.marketTradeFees.HK }
            : { market, settings: settings.marketTradeFees.US }
      const name =
        market === 'CN' ? 'A 股默认方案' : market === 'HK' ? '港股默认方案' : '美股默认方案'
      const id = defaultFeeSchemeId(market)
      return [id, feeSchemeFromLegacy(id, name, fees)]
    })
  )
}

export function effectiveFixedFees(
  account: SecuritiesAccount,
  scheme: CnBrokerFeeScheme
): CnFixedFeeRates {
  return { ...scheme.fixedFees, ...account.fixedFeeOverrides }
}

export function accountFeeScheme(
  account: SecuritiesAccount,
  schemes: BrokerFeeSchemes
): BrokerFeeScheme {
  const scheme = schemes[account.feeSchemeId]
  if (!scheme || scheme.market !== account.market) throw new Error('账户绑定的费用方案无效')
  return scheme
}

export function validateFeeConfiguration(
  accounts: SecuritiesAccounts,
  schemes: BrokerFeeSchemes,
  fixedDefaults: CnFixedFeeRates
): void {
  const validateNumbers = (values: unknown[]) => {
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      throw new Error('费率和费用必须为有效的非负数字')
  }
  validateNumbers(FIXED_FEE_CODES.map((code) => fixedDefaults[code]))
  for (const [id, scheme] of Object.entries(schemes)) {
    if (id !== scheme.id || !scheme.name.trim()) throw new Error('费用方案名称或编号无效')
    if (scheme.market === 'CN') {
      validateNumbers(FIXED_FEE_CODES.map((code) => scheme.fixedFees[code]))
      if (!['half-up', 'next-digit-up'].includes(scheme.roundingMode))
        throw new Error('费用取整规则无效')
      for (const rule of Object.values(scheme.commission)) {
        validateNumbers([rule.ratePerTenThousand, rule.minimumCommission])
        if (
          new Set(rule.includedFees).size !== rule.includedFees.length ||
          rule.includedFees.some((code) => !FIXED_FEE_CODES.includes(code))
        )
          throw new Error('佣金包含费用的配置无效')
      }
      if (!scheme.commission.SH || !scheme.commission.SZ) throw new Error('缺少沪深佣金参数')
    } else
      validateNumbers(Object.values(scheme.settings).filter((value) => typeof value !== 'boolean'))
  }
  for (const [id, account] of Object.entries(accounts)) {
    if (!account.name.trim() || account.id !== id) throw new Error('股票账户名称或编号无效')
    accountFeeScheme(account, schemes)
    if (account.fixedFeeOverrides) {
      if (
        account.market !== 'CN' ||
        Object.keys(account.fixedFeeOverrides).some(
          (code) => !FIXED_FEE_CODES.includes(code as FixedFeeCode)
        )
      )
        throw new Error('账户固定费率无效')
      validateNumbers(Object.values(account.fixedFeeOverrides))
    }
  }
}

type LegacySecuritiesAccount = Omit<SecuritiesAccount, 'feeSchemeId'> & {
  feeSettings: AccountFeeSettings
}

export function migrateAccountFeeConfiguration(
  state: Pick<AppState, 'feeSchemes' | 'fixedFeeDefaults' | 'securitiesAccounts'>,
  settings: AppSettings,
  initialAccounts: SecuritiesAccounts
) {
  const schemes = { ...(state.feeSchemes ?? createDefaultFeeSchemes(settings)) }
  const accounts: SecuritiesAccounts = {}
  for (const [id, input] of Object.entries(state.securitiesAccounts ?? initialAccounts)) {
    if ('feeSettings' in input) {
      const { feeSettings, ...account } = input as LegacySecuritiesAccount
      if (feeSettings.market !== account.market) throw new Error('股票账户资料或市场不一致')
      const schemeId = `account-fees:${id}`
      schemes[schemeId] = feeSchemeFromLegacy(schemeId, `${account.name}费用方案`, feeSettings)
      accounts[id] = { ...account, feeSchemeId: schemeId, isSystemDefault: false }
    } else accounts[id] = { ...input, isSystemDefault: false }
  }
  const fixedFeeDefaults = { ...(state.fixedFeeDefaults ?? DEFAULT_CN_FIXED_FEE_RATES) }
  validateFeeConfiguration(accounts, schemes, fixedFeeDefaults)
  return { accounts, schemes, fixedFeeDefaults }
}

/** 已有交易入口的数据接口适配；完整计算器的接入另行实施。 */
export function projectExistingTradeSettings(
  account: SecuritiesAccount,
  schemes: BrokerFeeSchemes,
  exchange: CnFeeExchange
): AccountFeeSettings {
  const scheme = accountFeeScheme(account, schemes)
  if (scheme.market === 'HK') return { market: 'HK', settings: structuredClone(scheme.settings) }
  if (scheme.market === 'US') return { market: 'US', settings: structuredClone(scheme.settings) }
  const fixed = effectiveFixedFees(account, scheme)
  const rule = scheme.commission[exchange]
  // 报价包含所选费用：主动调整固定费率后，按当前费率还原净佣金。
  // 原计算方式标记只保留取整顺序，不冻结迁移时的旧净佣金参数。
  const included =
    scheme.existingCommissionMode !== 'net' &&
    DEFAULT_INCLUDED_FEES.every((code) => rule.includedFees.includes(code)) &&
    !rule.includedFees.includes('stampDuty')
  return {
    market: 'CN',
    settings: {
      commissionIncludesFees: included,
      commissionRatePerTenThousand: included
        ? rule.ratePerTenThousand
        : Math.max(
            0,
            Number(
              (
                rule.ratePerTenThousand -
                rule.includedFees.reduce((total, code) => total + fixed[code], 0)
              ).toFixed(10)
            )
          ),
      minimumCommissionBundle: rule.minimumCommission,
      handlingRatePerTenThousand: fixed.handling,
      regulatoryRatePerTenThousand: fixed.regulatory,
      transferRatePerTenThousand: fixed.transfer,
      stampDutyRatePerTenThousand: fixed.stampDuty
    }
  }
}
