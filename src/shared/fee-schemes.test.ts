import { describe, expect, it } from 'vitest'
import {
  createCnFeeScheme,
  createDefaultFeeSchemes,
  DEFAULT_CN_FIXED_FEE_RATES,
  effectiveFixedFees,
  feeSchemeFromLegacy,
  projectExistingTradeSettings,
  validateFeeConfiguration
} from './fee-schemes'
import { createDefaultAccounts } from './stock-accounts'
import { DEFAULT_T_TRADING_FEE_SETTINGS } from './types'
import { calculateTradeFees, totalTradeFees } from '../lib/t-trading'
import { calculateSchemeTradeFees } from '../lib/broker-fees'

describe('fee scheme configuration', () => {
  it('uses editable copies of centrally maintained defaults for new schemes', () => {
    const defaults = { ...DEFAULT_CN_FIXED_FEE_RATES, handling: 0.3 }
    const first = createCnFeeScheme('first', '方案一', defaults)
    const second = createCnFeeScheme('second', '方案二', defaults)
    first.fixedFees.handling = 0.2
    expect(second.fixedFees.handling).toBe(0.3)
    expect(defaults.handling).toBe(0.3)
    expect(first.commission.SH.includedFees).toEqual(['handling', 'regulatory', 'transfer'])
    expect(first.commission.SZ.includedFees).toEqual(['handling', 'regulatory', 'transfer'])
  })
  it('converts net quotes independently for Shanghai and Shenzhen without reinterpreting the original quote', () => {
    const scheme = feeSchemeFromLegacy('migrated', '旧方案', {
      market: 'CN',
      settings: DEFAULT_T_TRADING_FEE_SETTINGS
    })
    expect(scheme).toMatchObject({
      commission: {
        SH: { ratePerTenThousand: 5.854, includedFees: ['handling', 'regulatory'] },
        SZ: { ratePerTenThousand: 5.954, includedFees: ['handling', 'regulatory', 'transfer'] }
      }
    })
  })

  it('preserves the existing net rounding order through migration and Shenzhen projection', () => {
    const previous = { ...DEFAULT_T_TRADING_FEE_SETTINGS, commissionRatePerTenThousand: 1 }
    const migrated = feeSchemeFromLegacy('net', '净佣金', { market: 'CN', settings: previous })
    const saved = structuredClone(migrated)
    const account = { ...createDefaultAccounts()['default:CN'], feeSchemeId: saved.id }
    const projected = projectExistingTradeSettings(account, { [saved.id]: saved }, 'SZ')
    if (projected.market !== 'CN') throw new Error('Expected CN settings')
    expect(projected.settings.commissionIncludesFees).toBe(false)
    expect(calculateTradeFees(50_050, 'buy', projected.settings, '深A')).toEqual(
      calculateTradeFees(50_050, 'buy', previous, '深A')
    )
    expect(totalTradeFees(calculateTradeFees(50_050, 'buy', projected.settings, '深A'))).toBe(8.22)
  })

  it('retains the existing inclusive rounding order through Shanghai projection', () => {
    const previous = {
      ...DEFAULT_T_TRADING_FEE_SETTINGS,
      commissionIncludesFees: true,
      commissionRatePerTenThousand: 1,
      minimumCommissionBundle: 1
    }
    const saved = feeSchemeFromLegacy('inclusive', '全包佣金', { market: 'CN', settings: previous })
    const account = { ...createDefaultAccounts()['default:CN'], feeSchemeId: saved.id }
    const projected = projectExistingTradeSettings(account, { [saved.id]: saved }, 'SH')
    if (projected.market !== 'CN') throw new Error('Expected CN settings')
    expect(projected.settings.commissionIncludesFees).toBe(true)
    expect(calculateTradeFees(50_050, 'buy', projected.settings, '沪A')).toEqual(
      calculateTradeFees(50_050, 'buy', previous, '沪A')
    )
  })

  it('keeps the saved inclusive quote authoritative when an account changes an included fixed rate', () => {
    const previous = { ...DEFAULT_T_TRADING_FEE_SETTINGS, commissionRatePerTenThousand: 1 }
    const saved = feeSchemeFromLegacy('quote', '佣金报价', { market: 'CN', settings: previous })
    const account = {
      ...createDefaultAccounts()['default:CN'],
      feeSchemeId: saved.id,
      fixedFeeOverrides: { handling: 0 }
    }
    const projected = projectExistingTradeSettings(account, { [saved.id]: saved }, 'SH')
    if (saved.market !== 'CN' || projected.market !== 'CN') throw new Error('Expected CN settings')
    expect(saved.commission.SH.ratePerTenThousand).toBe(1.541)
    expect(projected.settings.commissionRatePerTenThousand).toBe(1.341)
    expect(calculateTradeFees(100_000, 'buy', projected.settings, '沪A')).toEqual(
      calculateSchemeTradeFees(100_000, 'buy', saved, 'SH', account.fixedFeeOverrides).fees
    )
  })
  it('inherits unmodified rates while isolating a bound account override', () => {
    const scheme = createCnFeeScheme('shared', '共享方案')
    const first = {
      ...createDefaultAccounts()['default:CN'],
      feeSchemeId: scheme.id,
      fixedFeeOverrides: { transfer: 0 }
    }
    const second = { ...first, fixedFeeOverrides: undefined }
    expect(effectiveFixedFees(first, scheme).transfer).toBe(0)
    expect(effectiveFixedFees(second, scheme).transfer).toBe(0.1)
    scheme.fixedFees.handling = 0.3
    expect(effectiveFixedFees(first, scheme).handling).toBe(0.3)
    expect(effectiveFixedFees(second, scheme).handling).toBe(0.3)
  })
  it('rejects a deleted bound scheme and a scheme from another market', () => {
    const accounts = createDefaultAccounts()
    const schemes = createDefaultFeeSchemes()
    delete schemes[accounts['default:CN'].feeSchemeId]
    expect(() => validateFeeConfiguration(accounts, schemes, DEFAULT_CN_FIXED_FEE_RATES)).toThrow(
      '费用方案无效'
    )
    accounts['default:CN'].feeSchemeId = accounts['default:HK'].feeSchemeId
    expect(() => validateFeeConfiguration(accounts, schemes, DEFAULT_CN_FIXED_FEE_RATES)).toThrow(
      '费用方案无效'
    )
  })
})
