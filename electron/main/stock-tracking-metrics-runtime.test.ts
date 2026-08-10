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
    tTradingAccounts: {}
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
  it('captures active tracking profiles and persists one state update', async () => {
    let currentState = state()
    const persistState = vi.fn()
    const sendStateUpdated = vi.fn()
    const notifyPriceVolumeDivergence = vi.fn()
    const getDailyKline = vi.fn(async (quoteId: string) => ({
      quoteId,
      name: '浦发银行',
      tradingDate: '2026-07-21',
      bars: bars()
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

    await runtime.capture(true)

    expect(getDailyKline).toHaveBeenCalledWith('1.600000', 500)
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots).toHaveLength(1)
    expect(currentState.stockTrackingProfiles['1.600000'].metricSnapshots[0].metrics).toMatchObject(
      {
        close: 10,
        volume: 200,
        volumeRatio5d: 2,
        volumeRatio10d: 2,
        volumeRatio20d: 2
      }
    )
    expect(persistState).toHaveBeenCalledOnce()
    expect(sendStateUpdated).toHaveBeenCalledWith(currentState)
    expect(notifyPriceVolumeDivergence).not.toHaveBeenCalled()
  })

  it('records and notifies a new three-session divergence only once', async () => {
    let currentState = state()
    const divergentBars = bars()
    divergentBars.splice(
      17,
      4,
      { ...divergentBars[17], close: 10, volume: 140 },
      { ...divergentBars[18], close: 11, volume: 130 },
      { ...divergentBars[19], close: 12, volume: 120 },
      { ...divergentBars[20], close: 13, volume: 110 }
    )
    const notifyPriceVolumeDivergence = vi.fn()
    const runtime = new StockTrackingMetricsRuntime({
      getState: () => currentState,
      setState: (nextState) => {
        currentState = nextState
      },
      persistState: vi.fn(),
      sendStateUpdated: vi.fn(),
      getDailyKline: async (quoteId) => ({
        quoteId,
        name: '浦发银行',
        tradingDate: '2026-07-21',
        bars: divergentBars
      }),
      notifyPriceVolumeDivergence,
      now: () => new Date('2026-07-21T08:00:00.000Z')
    })

    await runtime.capture(true)
    await runtime.capture(true)

    expect(currentState.stockTrackingProfiles['1.600000'].entries[0]).toMatchObject({
      id: 'tracking:price-volume-divergence:2026-07-21:priceRiseVolumeFall',
      type: 'system',
      content: '量价背离提醒：连续三日价升量减'
    })
    expect(notifyPriceVolumeDivergence).toHaveBeenCalledOnce()
  })
})
