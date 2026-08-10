import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState
} from './types'
import {
  JIANZHANG_CONFIG_FORMAT,
  JIANZHANG_CONFIG_VERSION,
  createConfigDocument,
  parseConfigDocument
} from './config'

function state(): AppState {
  return {
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: {}
  }
}

describe('configuration tracking profiles', () => {
  it('imports older configuration documents without tracking data', () => {
    const legacyState = state() as Partial<AppState>
    delete legacyState.stockTrackingProfiles
    const parsed = parseConfigDocument({
      format: JIANZHANG_CONFIG_FORMAT,
      formatVersion: 2,
      applicationVersion: '7.10.0',
      exportedAt: '2026-08-10T00:00:00.000Z',
      state: legacyState
    })

    expect(parsed.stockTrackingProfiles).toEqual({})
    expect(parsed.watchlistGroups).toHaveLength(2)
  })

  it('round trips tracking profiles in the current configuration format', () => {
    const current = state()
    current.stockTrackingProfiles['1.600000'] = {
      quoteId: '1.600000',
      code: '600000',
      name: '浦发银行',
      marketLabel: '沪A',
      status: 'stopped',
      tags: ['银行'],
      thesis: '观察估值修复',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      stoppedAt: '2026-08-10T00:00:00.000Z',
      sources: [],
      entries: [],
      metricSnapshots: []
    }
    const document = createConfigDocument(current, '7.10.0')
    const parsed = parseConfigDocument(document)

    expect(document.formatVersion).toBe(JIANZHANG_CONFIG_VERSION)
    expect(parsed.stockTrackingProfiles['1.600000']).toMatchObject({
      status: 'stopped',
      tags: ['银行'],
      thesis: '观察估值修复'
    })
  })
})
