import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState
} from '../../shared/types'
import {
  createDefaultFeeSchemes,
  defaultFeeSchemeId,
  DEFAULT_CN_FIXED_FEE_RATES
} from '../../shared/fee-schemes'
import { normalizeAccountState } from '../../shared/stock-accounts'
import { saveFeeConfiguration, saveSecuritiesAccounts } from './mutations'

function fixture(): AppState {
  return normalizeAccountState({
    revision: 1,
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    stockTradingBooks: {},
    corporateActionApplications: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    feeSchemes: createDefaultFeeSchemes(),
    fixedFeeDefaults: { ...DEFAULT_CN_FIXED_FEE_RATES },
    securitiesAccounts: {
      a: {
        id: 'a',
        name: '账户 A',
        market: 'CN',
        feeSchemeId: defaultFeeSchemeId('CN'),
        enabled: true,
        isSystemDefault: false
      }
    }
  })
}

function withNewHolding(state: AppState): AppState {
  return {
    ...state,
    stockTradingBooks: {
      '1.600000': {
        quoteId: '1.600000',
        accounts: {
          a: {
            quoteId: '1.600000',
            code: '600000',
            name: '浦发银行',
            accountId: 'a',
            history: [],
            tradeRecords: [],
            ledger: { schemaVersion: 1, entries: [] },
            position: { quantity: 100, cost: 10, openedToday: false, openedOn: '2026-11-03' }
          }
        }
      }
    }
  }
}

describe('configuration commands validate their execution snapshot', () => {
  it('rejects deleting an account if a book appeared after the command was created', () => {
    const state = fixture()
    const remove = saveSecuritiesAccounts({})
    expect(() => remove(withNewHolding(state))).toThrow('已有业务记录')
  })

  it('rejects disabling an account that acquired a position while waiting', () => {
    const state = fixture()
    const disable = saveSecuritiesAccounts({
      a: { ...state.securitiesAccounts!.a, enabled: false }
    })
    expect(() => disable(withNewHolding(state))).toThrow('仍有持仓')
  })

  it('rejects a fee scheme removal when an account is now bound to it', () => {
    const state = fixture()
    const schemes = { ...state.feeSchemes }
    delete schemes[defaultFeeSchemeId('CN')]
    const save = saveFeeConfiguration(schemes, state.fixedFeeDefaults!)
    expect(() => save(state)).toThrow()
  })

  it('preserves a concurrent account rename when saving valid fee settings', () => {
    const state = fixture()
    const save = saveFeeConfiguration(state.feeSchemes!, state.fixedFeeDefaults!)
    const current = {
      ...state,
      securitiesAccounts: { a: { ...state.securitiesAccounts!.a, name: '新名称' } }
    }
    expect(save(current).securitiesAccounts!.a.name).toBe('新名称')
  })
})
