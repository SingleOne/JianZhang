import { describe, expect, it } from 'vitest'
import { normalizeStateChanges } from './normalize-state-changes'
import { normalizeAccountState } from './stock-accounts'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  DEFAULT_WATCHLIST_GROUPS,
  normalizeStockTrackingProfiles,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  type AppState,
  type CorporateActionRecord,
  type StockTradingBook
} from './types'

function state(): AppState {
  return normalizeAccountState({
    revision: 1,
    watchlist: normalizeWatchlist([
      {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        marketLabel: '沪A',
        isPriority: false,
        showInTaskbar: false,
        showRadarSignals: true
      },
      {
        quoteId: '0.000001',
        code: '000001',
        name: '平安银行',
        marketLabel: '深A',
        isPriority: false,
        showInTaskbar: false,
        showRadarSignals: true
      }
    ]),
    watchlistGroups: normalizeWatchlistGroups(DEFAULT_WATCHLIST_GROUPS),
    stockTrackingProfiles: normalizeStockTrackingProfiles({
      '1.600000': {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        marketLabel: '沪A',
        cycleId: 'cycle-1',
        status: 'tracking',
        tags: [],
        thesis: '',
        startedAt: '2026-10-28',
        updatedAt: '2026-10-28',
        sources: [],
        entries: [],
        metricSnapshots: [
          { tradingDate: '2026-10-28', capturedAt: '2026-10-28', metrics: { close: 10 } }
        ]
      }
    }),
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    stockTradingBooks: {
      '1.600000': { quoteId: '1.600000', accounts: {} },
      '0.000001': { quoteId: '0.000001', accounts: {} }
    },
    corporateActionApplications: {}
  })
}

describe('normalizing changed state branches', () => {
  it('keeps account books and tracking history untouched for a theme change', () => {
    const before = state()
    const result = normalizeStateChanges(before, {
      ...before,
      settings: { ...before.settings, theme: 'dark' }
    })
    expect(result.settings.theme).toBe('dark')
    expect(result.stockTradingBooks).toBe(before.stockTradingBooks)
    expect(result.stockTrackingProfiles).toBe(before.stockTrackingProfiles)
    expect(result.watchlist).toBe(before.watchlist)
  })

  it('does not re-normalize metric history when only tracking tags change', () => {
    const before = state()
    const profile = before.stockTrackingProfiles['1.600000']
    Object.defineProperty(profile.metricSnapshots[0], 'metrics', {
      enumerable: true,
      get: () => {
        throw new Error('Unchanged metrics must not be read')
      }
    })
    const result = normalizeStateChanges(before, {
      ...before,
      stockTrackingProfiles: {
        ...before.stockTrackingProfiles,
        '1.600000': { ...profile, tags: ['观察'] }
      }
    })
    expect(result.stockTrackingProfiles['1.600000'].tags).toEqual(['观察'])
    expect(result.stockTrackingProfiles['1.600000'].metricSnapshots).toBe(profile.metricSnapshots)
  })

  it('preserves unrelated books and global adjustments when one stock book changes', () => {
    const before = state()
    before.portfolioPerformanceAdjustments = { '0.000001': 123 }
    const book = before.stockTradingBooks['1.600000'] as StockTradingBook
    const result = normalizeStateChanges(before, {
      ...before,
      stockTradingBooks: { ...before.stockTradingBooks, '1.600000': { ...book, boardLotSize: 200 } }
    })
    expect(result.stockTradingBooks['0.000001']).toBe(before.stockTradingBooks['0.000001'])
    expect(result.portfolioPerformanceAdjustments).toBe(before.portfolioPerformanceAdjustments)
    expect((result.stockTradingBooks['1.600000'] as StockTradingBook).boardLotSize).toBe(200)
  })

  it('still rejects a corporate action assigned to an account in another market', () => {
    const before = state()
    const record: CorporateActionRecord = {
      id: 'dividend-1',
      quoteId: '1.600000',
      market: 'CN',
      type: 'cashDividend',
      status: 'confirmed',
      title: '现金分红',
      announcementDate: '2026-10-28',
      terms: { kind: 'manualCash' },
      evidence: [],
      providerId: 'manual',
      providerEventId: 'dividend-1',
      contentHash: 'hash',
      detectedAt: '2026-10-28',
      accountId: 'default:HK'
    }
    expect(() =>
      normalizeStateChanges(before, {
        ...before,
        corporateActionApplications: { [record.id]: record }
      })
    ).toThrow('公司行动账户归属无效')
  })
})
