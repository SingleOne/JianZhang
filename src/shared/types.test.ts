import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_GROUPS,
  WATCHLIST_COLUMN_ORDER_VERSION,
  hasLegacyTTradingData,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeStockTrackingProfiles,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  synchronizeTrackingGroupMembership,
  type TTrade,
  type TTradingAccounts
} from './types'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function trade(id: string, tradedAt: string): TTrade {
  return {
    id,
    side: 'buy',
    purpose: 't',
    tradedAt,
    price: 10,
    quantity: 100,
    fees: EMPTY_FEES,
    note: ''
  }
}

describe('watchlist normalization', () => {
  it('normalizes groups and removes duplicate identifiers', () => {
    expect(
      normalizeWatchlistGroups([
        { id: ' group-1 ', name: ' 银行 ' },
        { id: 'group-1', name: '重复分组' },
        { id: '', name: '无效分组' }
      ])
    ).toEqual([...DEFAULT_WATCHLIST_GROUPS, { id: 'group-1', name: '银行' }])
  })

  it('adds the system scan group while preserving an existing group with the same name', () => {
    expect(normalizeWatchlistGroups(undefined)).toEqual(DEFAULT_WATCHLIST_GROUPS)
    expect(normalizeWatchlistGroups([{ id: 'existing-scan-group', name: ' 异动观察 ' }])).toEqual([
      { id: 'existing-scan-group', name: '异动观察' },
      DEFAULT_WATCHLIST_GROUPS[1]
    ])
  })

  it('keeps the tracking system group aligned with active profiles', () => {
    const groups = normalizeWatchlistGroups(undefined)
    const profiles = normalizeStockTrackingProfiles({
      '1.600000': {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        marketLabel: '沪A',
        status: 'tracking',
        tags: [' 银行 ', '银行'],
        thesis: ' 低估值 ',
        startedAt: '2026-08-10T08:00:00.000Z',
        updatedAt: '2026-08-10T08:00:00.000Z',
        sources: [],
        entries: []
      }
    })
    const [stock] = synchronizeTrackingGroupMembership(
      [
        {
          code: '600000',
          name: '浦发银行',
          quoteId: '1.600000',
          marketLabel: '沪A',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: true
        }
      ],
      groups,
      profiles
    )

    expect(profiles['1.600000'].tags).toEqual(['银行'])
    expect(profiles['1.600000'].thesis).toBe('低估值')
    expect(stock.groupIds).toContain(DEFAULT_WATCHLIST_GROUPS[1].id)
  })

  it('keeps valid snapshots and makes positions priority stocks', () => {
    const [stock] = normalizeWatchlist([
      {
        code: '600000',
        name: '浦发银行',
        quoteId: '1.600000',
        marketLabel: '沪A',
        showInTaskbar: false,
        isPriority: false,
        showRadarSignals: undefined as unknown as boolean,
        groupIds: ['bank', 'bank'],
        position: { quantity: 100, cost: 10, openedToday: false },
        positionSnapshots: [
          { id: 'valid', name: '初始持仓', createdAt: '2026-07-01', quantity: 100, cost: 10 },
          { id: 'invalid', name: '无效持仓', createdAt: '2026-07-01', quantity: 0, cost: 10 }
        ]
      }
    ])

    expect(stock.isPriority).toBe(true)
    expect(stock.showRadarSignals).toBe(true)
    expect(stock.groupIds).toEqual(['bank'])
    expect(stock.positionSnapshots).toHaveLength(1)
  })
})

describe('settings and column migration', () => {
  it('clamps refresh intervals and plan defaults to supported ranges', () => {
    const settings = normalizeAppSettings({
      priorityRefreshSeconds: 1,
      regularRefreshSeconds: 999,
      marketIndexIds: ['shanghai', 'invalid'] as typeof DEFAULT_APP_SETTINGS.marketIndexIds,
      tPlanDefaults: {
        buyLevels: [{ targetPercent: -1, quantity: -100 }],
        sellLevels: [{ targetPercent: 2, quantity: 300 }]
      }
    })

    expect(settings.priorityRefreshSeconds).toBe(3)
    expect(settings.regularRefreshSeconds).toBe(300)
    expect(settings.marketIndexIds).toEqual(['shanghai'])
    expect(settings.tPlanDefaults.buyLevels[0]).toEqual({ targetPercent: 0, quantity: 0 })
    expect(settings.tPlanDefaults.sellLevels[0]).toEqual({ targetPercent: 2, quantity: 300 })
    expect(settings.tPlanDefaults.buyLevels).toHaveLength(5)
    expect(settings.tFloatingProfitAlertDefaultThreshold).toBe(100)
  })

  it('inserts historical columns in their intended positions', () => {
    const migrated = migrateWatchlistColumnOrder(
      ['stock', 'changePercent', 'open', 'totalProfit', 'operation'],
      1
    )

    expect(migrated.indexOf('sectorChangePercent')).toBe(migrated.indexOf('changePercent') + 1)
    expect(migrated.indexOf('dividendFinancingRatio')).toBe(
      migrated.indexOf('sectorChangePercent') + 1
    )
    expect(migrated.indexOf('valueTags')).toBe(migrated.indexOf('dividendFinancingRatio') + 1)
    expect(migrated.indexOf('trading')).toBe(migrated.indexOf('open') + 1)
    expect(migrated.indexOf('todayProfit')).toBe(migrated.indexOf('totalProfit') + 1)
    expect(migrated.at(-1)).toBe('operation')
    expect(WATCHLIST_COLUMN_ORDER_VERSION).toBe(8)
  })

  it('adds the default disabled floating profit alert to old active batches', () => {
    const accounts = normalizeTTradingAccounts({
      '1.600000': {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        activeBatch: {
          id: 'batch-1',
          sequence: 1,
          openedAt: '2026-07-03T09:30:00.000Z',
          sellLevels: []
        },
        history: [],
        tradeRecords: []
      }
    })

    expect(accounts['1.600000'].activeBatch?.floatingProfitAlert).toEqual({
      enabled: false,
      threshold: 100,
      status: 'armed'
    })
  })
})

describe('unified trade record migration', () => {
  it('detects and migrates legacy base and batch trades without duplicates', () => {
    const legacyAccounts = {
      '1.600000': {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        baseTrades: [trade('base', '2026-07-01T09:30:00.000Z')],
        history: [
          {
            id: 'batch-1',
            sequence: 1,
            openedAt: '2026-07-02T09:30:00.000Z',
            sellLevels: [],
            trades: [trade('history', '2026-07-02T09:30:00.000Z')]
          }
        ],
        activeBatch: {
          id: 'batch-2',
          sequence: 2,
          openedAt: '2026-07-03T09:30:00.000Z',
          direction: 'reverse',
          sellLevels: [{ targetPercent: 2, quantity: 100 }],
          trades: [trade('active', '2026-07-03T09:30:00.000Z')]
        },
        tradeRecords: [trade('active', '2026-07-03T09:30:00.000Z')]
      }
    } as unknown as TTradingAccounts

    expect(hasLegacyTTradingData(legacyAccounts)).toBe(true)

    const account = normalizeTTradingAccounts(legacyAccounts)['1.600000']
    expect(account.tradeRecords.map((record) => record.id)).toEqual(['active', 'history', 'base'])
    expect(account.tradeRecords.find((record) => record.id === 'base')?.batchId).toBeUndefined()
    expect(account.tradeRecords.find((record) => record.id === 'history')).toMatchObject({
      batchId: 'batch-1',
      batchSequence: 1,
      batchDirection: 'forward'
    })
    expect(account.tradeRecords.find((record) => record.id === 'active')).toMatchObject({
      batchId: 'batch-2',
      batchSequence: 2,
      batchDirection: 'reverse'
    })
    expect(account.activeBatch).not.toHaveProperty('trades')
    expect(account.history[0]).not.toHaveProperty('trades')
    expect(account.activeBatch?.buyLevels?.[0].targetPercent).toBe(2)
    expect(account.activeBatch?.sellLevels[0].targetPercent).toBe(1)
    expect(hasLegacyTTradingData(normalizeTTradingAccounts(legacyAccounts))).toBe(false)
  })
})
