import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type KlineBar,
  type StockTrackingProfile
} from '../../src/shared/types'
import { StockTrackingMetricsRuntime } from './stock-tracking-metrics-runtime'

function trackedProfile(): StockTrackingProfile {
  return {
    cycleId: 'cycle-1',
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    marketLabel: '沪A',
    status: 'tracking',
    tags: [],
    thesis: '',
    startedAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    sources: [],
    entries: [],
    metricSnapshots: []
  }
}

function state(): AppState {
  const profile = trackedProfile()
  return {
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: { [profile.quoteId]: profile },
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: {},
    corporateActionRecords: {}
  }
}

function bars(): KlineBar[] {
  return Array.from({ length: 21 }, (_, index) => ({
    time: `2026-07-${String(index + 1).padStart(2, '0')}`,
    open: 10,
    close: 10,
    high: 10,
    low: 10,
    volume: index === 20 ? 200 : 100,
    amount: 1_000
  }))
}

describe('StockTrackingMetricsRuntime', () => {
  it('requests and stores the completed tracking-start date once', async () => {
    let currentState = state()
    const persistState = vi.fn()
    const sendStateUpdated = vi.fn()
    const notifyPriceVolumeDivergence = vi.fn()
    const getDailyKline = vi.fn(async (quoteId: string) => ({
      quoteId,
      name: '浦发银行',
      tradingDate: '2026-07-21',
      bars: [bars().at(-1)!]
    }))
    const runtime = new StockTrackingMetricsRuntime({
      getState: () => currentState,
      setState: (nextState) => {
        currentState = nextState
      },
      persistState,
      sendStateUpdated,
      getDailyKline,
      notifyPriceVolumeDivergence,
      now: () => new Date('2026-07-21T08:00:00.000Z')
    })

    await runtime.capture()
    await runtime.capture()

    expect(getDailyKline).toHaveBeenCalledOnce()
    expect(getDailyKline).toHaveBeenCalledWith('1.600000', {
      startDate: '2026-07-21',
      endDate: '2026-07-21'
    })
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots).toHaveLength(1)
    expect(currentState.stockTrackingProfiles['1.600000'].lastCompletedKlineDate).toBe('2026-07-21')
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots[0].metrics).toMatchObject(
      {
        close: 10,
        volume: 200
      }
    )
    expect(persistState).toHaveBeenCalledOnce()
    expect(sendStateUpdated).toHaveBeenCalledWith(currentState)
    expect(notifyPriceVolumeDivergence).not.toHaveBeenCalled()
  })

  it('does not request or write the tracking-start date before the market closes', async () => {
    let currentState = state()
    const getDailyKline = vi.fn()
    const persistState = vi.fn()
    const runtime = new StockTrackingMetricsRuntime({
      getState: () => currentState,
      setState: (nextState) => {
        currentState = nextState
      },
      persistState,
      sendStateUpdated: vi.fn(),
      getDailyKline,
      notifyPriceVolumeDivergence: vi.fn(),
      now: () => new Date('2026-07-21T01:00:00.000Z')
    })

    await runtime.capture()

    expect(getDailyKline).not.toHaveBeenCalled()
    expect(persistState).not.toHaveBeenCalled()
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots).toEqual([])
  })

  it.each([
    {
      name: 'weekend',
      startedAt: '2026-07-25T02:00:00.000Z',
      closedDate: undefined,
      expectedDate: '2026-07-24'
    },
    {
      name: 'market holiday',
      startedAt: '2026-07-22T02:00:00.000Z',
      closedDate: '2026-07-22',
      expectedDate: '2026-07-21'
    }
  ])(
    'stores the latest completed trading date when tracking starts on a $name',
    async ({ startedAt, closedDate, expectedDate }) => {
      let currentState = state()
      currentState.stockTrackingProfiles['1.600000'] = {
        ...trackedProfile(),
        startedAt,
        updatedAt: startedAt
      }
      if (closedDate) {
        currentState.settings.tradingCalendar.markets.CN.closedDates.push(closedDate)
      }
      const getDailyKline = vi.fn(async (quoteId: string) => ({
        quoteId,
        name: '浦发银行',
        tradingDate: expectedDate,
        bars: [
          {
            time: expectedDate,
            open: 10,
            close: 10,
            high: 10,
            low: 10,
            volume: 100,
            amount: 1_000
          }
        ]
      }))
      const runtime = new StockTrackingMetricsRuntime({
        getState: () => currentState,
        setState: (nextState) => {
          currentState = nextState
        },
        persistState: vi.fn(),
        sendStateUpdated: vi.fn(),
        getDailyKline,
        notifyPriceVolumeDivergence: vi.fn(),
        now: () => new Date(startedAt)
      })

      await runtime.capture()

      expect(getDailyKline).toHaveBeenCalledWith('1.600000', {
        startDate: expectedDate,
        endDate: expectedDate
      })
      expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots).toEqual([
        expect.objectContaining({ tradingDate: expectedDate })
      ])
      expect(currentState.stockTrackingProfiles['1.600000'].lastCompletedKlineDate).toBe(
        expectedDate
      )
    }
  )

  it('requests only dates after the completion marker and never rewrites them', async () => {
    let currentState = state()
    const previousBars = [
      { ...bars()[17], close: 10, volume: 140 },
      { ...bars()[18], close: 11, volume: 130 },
      { ...bars()[19], close: 12, volume: 120 }
    ]
    currentState.stockTrackingProfiles['1.600000'] = {
      ...trackedProfile(),
      lastCompletedKlineDate: '2026-07-20',
      metricSnapshots: previousBars.map((bar) => ({
        tradingDate: bar.time,
        capturedAt: `${bar.time}T08:00:00.000Z`,
        metrics: { close: bar.close, volume: bar.volume, amount: bar.amount }
      }))
    }
    const notifyPriceVolumeDivergence = vi.fn()
    const getDailyKline = vi.fn(async (quoteId: string) => ({
      quoteId,
      name: '浦发银行',
      tradingDate: '2026-07-21',
      bars: [{ ...bars()[20], close: 13, volume: 110 }]
    }))
    const runtime = new StockTrackingMetricsRuntime({
      getState: () => currentState,
      setState: (nextState) => {
        currentState = nextState
      },
      persistState: vi.fn(),
      sendStateUpdated: vi.fn(),
      getDailyKline,
      notifyPriceVolumeDivergence,
      now: () => new Date('2026-07-21T08:00:00.000Z')
    })

    await runtime.capture()
    const completedSnapshot = currentState.stockTrackingProfiles['1.600000'].metricSnapshots.at(-1)
    await runtime.capture()

    expect(getDailyKline).toHaveBeenCalledOnce()
    expect(getDailyKline).toHaveBeenCalledWith('1.600000', {
      startDate: '2026-07-21',
      endDate: '2026-07-21'
    })
    expect(currentState.stockTrackingProfiles['1.600000'].lastCompletedKlineDate).toBe('2026-07-21')
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots.at(-1)).toBe(
      completedSnapshot
    )
    expect(currentState.stockTrackingProfiles['1.600000'].entries[0]).toMatchObject({
      id: 'tracking:price-volume-divergence:2026-07-21:priceRiseVolumeFall',
      type: 'system',
      content: '量价背离提醒：连续三日价升量减'
    })
    expect(notifyPriceVolumeDivergence).toHaveBeenCalledOnce()
  })
})
