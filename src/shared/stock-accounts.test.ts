import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type TTradingAccount,
  withLedgerTradeRecords
} from './types'
import {
  accountFeeSettings,
  createDefaultAccounts,
  getStockAccountBook,
  listAccountsForMarket,
  normalizeAccountState,
  resolveAccountSelection,
  upsertStockAccount
} from './stock-accounts'

function legacyState(): AppState {
  const account: TTradingAccount = {
    quoteId: '1.600000',
    code: '600000',
    name: '股票',
    history: [],
    ledger: { schemaVersion: 1, entries: [] },
    tradeRecords: []
  }
  return {
    watchlist: [
      {
        quoteId: account.quoteId,
        code: account.code,
        name: account.name,
        marketLabel: '沪A',
        showInTaskbar: true,
        isPriority: true,
        showRadarSignals: true,
        position: {
          quantity: 100,
          cost: 10,
          openedToday: false,
          openedOn: '2026-01-02',
          currency: 'CNY'
        }
      }
    ],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    stockTradingBooks: { [account.quoteId]: account },
    corporateActionApplications: {},
    portfolioPerformanceAdjustments: { [account.quoteId]: 12 }
  }
}

describe('stock account state', () => {
  it('migrates legacy positions and adjustments once and retains the original fee configuration', () => {
    const legacy = legacyState()
    legacy.settings.tTradingFees.minimumCommissionBundle = 7
    const state = normalizeAccountState(legacy)
    const book = getStockAccountBook(state.stockTradingBooks, '1.600000', 'default:CN')!
    expect(book.position).toEqual(legacy.watchlist[0].position)
    expect(book.performanceAdjustmentCny).toBe(12)
    expect(
      accountFeeSettings(state.securitiesAccounts!['default:CN']).tTradingFees
        .minimumCommissionBundle
    ).toBe(7)
    expect(Object.keys(state.securitiesAccounts!)).toHaveLength(3)
    expect(normalizeAccountState(state)).toEqual(state)
  })

  it('isolates market choices and remembers only a successfully added execution', () => {
    let state = normalizeAccountState(legacyState())
    const accounts = createDefaultAccounts(state.settings)
    const secondary = {
      ...accounts['default:CN'],
      id: 'secondary',
      name: '第二账户',
      isSystemDefault: false
    }
    state = normalizeAccountState({ ...state, securitiesAccounts: { ...accounts, secondary } })
    expect(
      listAccountsForMarket(state.securitiesAccounts, 'CN').map((account) => account.id)
    ).toContain('secondary')
    expect(
      listAccountsForMarket(state.securitiesAccounts, 'HK').map((account) => account.id)
    ).not.toContain('secondary')
    const empty: TTradingAccount = {
      accountId: 'secondary',
      quoteId: '1.600000',
      code: '600000',
      name: '股票',
      market: 'CN',
      currency: 'CNY',
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    }
    state = upsertStockAccount(state, empty, undefined)
    expect(resolveAccountSelection(state, 'CN')).toBe('default:CN')
    const book = withLedgerTradeRecords(empty, [
      {
        id: 'buy',
        accountId: 'secondary',
        purpose: 'base',
        side: 'buy',
        price: 20,
        quantity: 100,
        tradedAt: '2026-01-05T10:00',
        origin: 'execution',
        fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
        note: ''
      }
    ])
    state = upsertStockAccount(state, book, {
      quantity: 100,
      cost: 20,
      openedToday: false,
      currency: 'CNY'
    })
    expect(resolveAccountSelection(state, 'CN')).toBe('secondary')
    expect(state.watchlist[0].position?.quantity).toBe(200)
    expect(state.watchlist[0].position?.cost).toBe(15)
    expect(
      getStockAccountBook(state.stockTradingBooks, '1.600000', 'default:CN')?.position?.cost
    ).toBe(10)
    const edited = withLedgerTradeRecords(book, [{ ...book.tradeRecords[0], price: 21 }])
    state.settings.lastUsedAccountIdByMarket = { CN: 'default:CN' }
    state = upsertStockAccount(state, edited, {
      quantity: 100,
      cost: 21,
      openedToday: false,
      currency: 'CNY'
    })
    expect(resolveAccountSelection(state, 'CN')).toBe('default:CN')
  })

  it('rejects a record whose account identity disagrees with its book', () => {
    const state = normalizeAccountState(legacyState())
    const book = getStockAccountBook(state.stockTradingBooks, '1.600000', 'default:CN')!
    const invalid = withLedgerTradeRecords(book, [
      {
        id: 'bad',
        purpose: 'base',
        side: 'buy',
        price: 10,
        quantity: 100,
        tradedAt: '2026-01-05T10:00',
        fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
        note: ''
      }
    ])
    invalid.ledger.entries[0].accountId = 'default:HK'
    expect(() => upsertStockAccount(state, invalid, book.position)).toThrow('跨账户')
  })
})
