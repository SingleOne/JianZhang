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
    tTradingAccounts: {},
    corporateActionRecords: {}
  }
}

describe('configuration tracking profiles', () => {
  it('rejects obsolete configuration formats', () => {
    expect(() =>
      parseConfigDocument({
        format: JIANZHANG_CONFIG_FORMAT,
        formatVersion: 2,
        applicationVersion: '7.10.0',
        exportedAt: '2026-08-10T00:00:00.000Z',
        state: state()
      })
    ).toThrow('配置格式或版本不受支持')
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
      lastCompletedKlineDate: '2026-08-08',
      updatedAt: '2026-08-10T00:00:00.000Z',
      stoppedAt: '2026-08-10T00:00:00.000Z',
      sources: [],
      entries: [],
      metricSnapshots: []
    }
    const document = createConfigDocument(current, '13.0.1')
    const parsed = parseConfigDocument(document)

    expect(document.formatVersion).toBe(JIANZHANG_CONFIG_VERSION)
    expect(parsed.stockTrackingProfiles['1.600000']).toMatchObject({
      status: 'stopped',
      lastCompletedKlineDate: '2026-08-08',
      tags: ['银行'],
      thesis: '观察估值修复'
    })
  })

  it('migrates only legacy snapshots that were captured after their market close', () => {
    const current = state()
    current.stockTrackingProfiles['1.600000'] = {
      quoteId: '1.600000',
      code: '600000',
      name: '浦发银行',
      marketLabel: '沪A',
      status: 'tracking',
      tags: [],
      thesis: '',
      startedAt: '2026-07-20T01:00:00.000Z',
      updatedAt: '2026-07-21T06:00:00.000Z',
      sources: [],
      entries: [],
      metricSnapshots: [
        {
          tradingDate: '2026-07-20',
          capturedAt: '2026-07-20T07:10:00.000Z',
          metrics: { close: 10 }
        },
        {
          tradingDate: '2026-07-21',
          capturedAt: '2026-07-21T06:00:00.000Z',
          metrics: { close: 11 }
        }
      ]
    }

    const parsed = parseConfigDocument(createConfigDocument(current, '13.0.1'))
    const profile = parsed.stockTrackingProfiles['1.600000']

    expect(profile.lastCompletedKlineDate).toBe('2026-07-20')
    expect(profile.metricSnapshots.map((snapshot) => snapshot.tradingDate)).toEqual(['2026-07-20'])
  })
})
