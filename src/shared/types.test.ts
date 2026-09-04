import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_GROUPS,
  WATCHLIST_COLUMN_ORDER_VERSION,
  getMarketIndexStocks,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeStockTrackingProfiles,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  normalizeWatchlistGroups,
  synchronizeWatchlistGroupMemberships,
  type TTrade
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
      DEFAULT_WATCHLIST_GROUPS[1],
      DEFAULT_WATCHLIST_GROUPS[2]
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
        entries: [],
        metricSnapshots: []
      }
    })
    const [stock] = synchronizeWatchlistGroupMemberships(
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

  it('keeps the holding system group aligned with positive position quantity', () => {
    const groups = normalizeWatchlistGroups(undefined)
    const holdingGroupId = DEFAULT_WATCHLIST_GROUPS[2].id
    const stocks = synchronizeWatchlistGroupMemberships(
      [
        {
          code: '600000',
          name: '浦发银行',
          quoteId: '1.600000',
          marketLabel: '沪A',
          showInTaskbar: false,
          isPriority: true,
          showRadarSignals: true,
          position: { quantity: 100, cost: 10, openedToday: false }
        },
        {
          code: '000001',
          name: '平安银行',
          quoteId: '0.000001',
          marketLabel: '深A',
          showInTaskbar: false,
          isPriority: false,
          showRadarSignals: true,
          groupIds: [holdingGroupId],
          position: { quantity: 0, cost: 10, openedToday: false }
        }
      ],
      groups,
      {}
    )

    expect(stocks[0].groupIds).toContain(holdingGroupId)
    expect(stocks[1].groupIds).not.toContain(holdingGroupId)
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
          {
            id: 'negative',
            name: '负成本持仓',
            createdAt: '2026-08-28',
            quantity: 100,
            cost: -0.9378
          },
          { id: 'invalid', name: '无效持仓', createdAt: '2026-07-01', quantity: 0, cost: 10 }
        ]
      }
    ])

    expect(stock.isPriority).toBe(true)
    expect(stock.showRadarSignals).toBe(true)
    expect(stock.groupIds).toEqual(['bank'])
    expect(stock.positionSnapshots).toHaveLength(2)
    expect(stock.positionSnapshots?.[1]?.cost).toBe(-0.9378)
  })
})

describe('settings and column migration', () => {
  it('preserves supported themes and defaults legacy or invalid values to system', () => {
    expect(DEFAULT_APP_SETTINGS.theme).toBe('system')
    expect(normalizeAppSettings(undefined).theme).toBe('system')
    expect(normalizeAppSettings({ theme: 'light' }).theme).toBe('light')
    expect(normalizeAppSettings({ theme: 'dark' }).theme).toBe('dark')
    expect(
      normalizeAppSettings({ theme: 'invalid' as typeof DEFAULT_APP_SETTINGS.theme }).theme
    ).toBe('system')
  })

  it('preserves the daily K indicator and migrates the previous BOLL switch', () => {
    expect(DEFAULT_APP_SETTINGS.dailyKlineIndicator).toBe('movingAverage')
    expect(normalizeAppSettings(undefined).dailyKlineIndicator).toBe('movingAverage')
    expect(normalizeAppSettings({ dailyKlineIndicator: 'bollinger' }).dailyKlineIndicator).toBe(
      'bollinger'
    )
    expect(normalizeAppSettings({ dailyKlineIndicator: 'none' }).dailyKlineIndicator).toBe('none')
    expect(normalizeAppSettings({ showBollingerBands: true }).dailyKlineIndicator).toBe('bollinger')
    expect(normalizeAppSettings({ showBollingerBands: false }).dailyKlineIndicator).toBe('none')
  })

  it('uses one default index for each supported market', () => {
    expect(DEFAULT_APP_SETTINGS.marketIndexIds).toEqual(['shanghai', 'hsi', 'nasdaq'])
    expect(getMarketIndexStocks(DEFAULT_APP_SETTINGS.marketIndexIds)).toMatchObject([
      { quoteId: '1.000001', market: 'CN' },
      { quoteId: '100.HSI', market: 'HK' },
      { quoteId: '100.NDX', market: 'US' }
    ])
    expect(normalizeAppSettings(undefined).marketIndexIds).toEqual(
      DEFAULT_APP_SETTINGS.marketIndexIds
    )
  })

  it('preserves every valid saved market index selection, including none', () => {
    expect(
      normalizeAppSettings({
        marketIndexIds: [
          'shanghai',
          'shenzhen',
          'chinext'
        ] as typeof DEFAULT_APP_SETTINGS.marketIndexIds
      }).marketIndexIds
    ).toEqual(['shanghai', 'shenzhen', 'chinext'])
    expect(normalizeAppSettings({ marketIndexIds: [] }).marketIndexIds).toEqual([])
    expect(
      normalizeAppSettings({
        marketIndexIds: ['nasdaq', 'shanghai']
      }).marketIndexIds
    ).toEqual(['nasdaq', 'shanghai'])
  })

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
    expect(settings.marketIndexIds).toEqual(DEFAULT_APP_SETTINGS.marketIndexIds)
    expect(settings.tPlanDefaults.buyLevels[0]).toEqual({ targetPercent: 0, quantity: 0 })
    expect(settings.tPlanDefaults.sellLevels[0]).toEqual({ targetPercent: 2, quantity: 300 })
    expect(settings.tPlanDefaults.buyLevels).toHaveLength(5)
    expect(settings.tFloatingProfitAlertDefaultThreshold).toBe(100)
  })

  it('tracks the current column layout version', () => {
    expect(WATCHLIST_COLUMN_ORDER_VERSION).toBe(11)
  })

  it('keeps the stock column first and removes legacy columns from a saved order', () => {
    const columnOrder = normalizeWatchlistColumnOrder([
      'latest',
      'cost',
      'stock',
      'changePercent',
      'operation'
    ])

    expect(columnOrder[0]).toBe('stock')
    expect(columnOrder.at(-1)).toBe('operation')
    expect(columnOrder).not.toContain('cost')
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
        ledger: { schemaVersion: 1, entries: [] },
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

describe('unified trade records', () => {
  it('normalizes an active batch from the quantity allocated by a cross-batch execution', () => {
    const transitionTrade = {
      ...trade('transition', '2026-08-26T10:00'),
      side: 'sell' as const,
      quantity: 1_000,
      allocations: [
        {
          purpose: 't' as const,
          quantity: 400,
          batchId: 'batch-1',
          batchSequence: 1,
          batchDirection: 'forward' as const
        },
        {
          purpose: 't' as const,
          quantity: 600,
          batchId: 'batch-2',
          batchSequence: 2,
          batchDirection: 'reverse' as const
        }
      ]
    }
    const accounts = normalizeTTradingAccounts({
      '1.600000': {
        quoteId: '1.600000',
        code: '600000',
        name: '浦发银行',
        activeBatch: {
          id: 'batch-2',
          sequence: 2,
          openedAt: transitionTrade.tradedAt,
          direction: 'reverse',
          openingPosition: { quantity: 2_000, cost: 8, openedOn: '2026-07-01' },
          buyLevels: [],
          sellLevels: []
        },
        history: [
          {
            id: 'batch-1',
            sequence: 1,
            openedAt: transitionTrade.tradedAt,
            direction: 'forward',
            buyLevels: [],
            sellLevels: []
          }
        ],
        ledger: { schemaVersion: 1, entries: [] },
        tradeRecords: [transitionTrade]
      }
    })

    expect(
      accounts['1.600000'].activeBatch?.buyLevels?.reduce(
        (total, level) => total + level.quantity,
        0
      )
    ).toBe(600)
    expect(accounts['1.600000'].tradeRecords).toHaveLength(1)
  })
})
