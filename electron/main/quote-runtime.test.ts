import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  DEFAULT_WATCHLIST_GROUPS,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type StockQuote,
  type StockTrackingProfile,
  type WatchStock
} from '../../src/shared/types'
import { fetchQuotes } from './market'
import { QuoteRuntime } from './quote-runtime'

vi.mock('./market', () => ({ fetchQuotes: vi.fn() }))

function trackingProfile(): StockTrackingProfile {
  return {
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    marketLabel: '沪A',
    status: 'tracking',
    tags: [],
    thesis: '',
    startedAt: '2026-08-01T01:30:00.000Z',
    updatedAt: '2026-08-01T01:30:00.000Z',
    sources: [],
    entries: [],
    metricSnapshots: []
  }
}

function appState(profile: StockTrackingProfile): AppState {
  return {
    revision: 0,
    watchlist: [],
    watchlistGroups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group })),
    stockTrackingProfiles: { [profile.quoteId]: profile },
    settings: { ...DEFAULT_APP_SETTINGS },
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: {}
  }
}

function watchStock(code: string, isPriority: boolean): WatchStock {
  return {
    code,
    name: `测试${code}`,
    quoteId: `1.${code}`,
    marketLabel: '沪A',
    showInTaskbar: false,
    isPriority,
    showRadarSignals: true
  }
}

function stockQuote(stock: WatchStock): StockQuote {
  return {
    code: stock.code,
    name: stock.name,
    quoteId: stock.quoteId,
    latest: 12,
    change: 0.2,
    changePercent: 1.69,
    open: 11.8,
    high: 12.1,
    low: 11.7,
    previousClose: 11.8,
    volume: 100,
    amount: 1_200,
    turnoverRate: 1,
    updatedAt: '2026-08-14T07:00:00.000Z'
  }
}

function createRuntime(state: AppState, publishQuotes = vi.fn()): QuoteRuntime {
  return new QuoteRuntime({
    getState: () => state,
    setState: vi.fn(),
    persistState: vi.fn(),
    sendToWindows: vi.fn(),
    updateWindowSurfaces: vi.fn(),
    publishQuotes,
    showStockAlertNotification: vi.fn(),
    showTFloatingProfitAlertNotification: vi.fn(),
    orderBookHub: {} as never,
    sectorMarketCache: {
      dueBoardStocks: () => [],
      saveQuotes: vi.fn(),
      sectorQuote: () => undefined,
      prime: async () => false
    } as never,
    marketRequestLogger: { logQuoteCycle: vi.fn() } as never
  })
}

describe('QuoteRuntime tracking review quotes', () => {
  beforeEach(() => {
    vi.mocked(fetchQuotes).mockReset()
  })

  it('refreshes and retains a tracked stock that is no longer in the watchlist', async () => {
    const profile = trackingProfile()
    const state = appState(profile)
    const quote: StockQuote = {
      code: profile.code,
      name: profile.name,
      quoteId: profile.quoteId,
      latest: 12,
      change: 0.2,
      changePercent: 1.69,
      open: 11.8,
      high: 12.1,
      low: 11.7,
      previousClose: 11.8,
      volume: 100,
      amount: 1_200,
      turnoverRate: 1,
      updatedAt: '2026-08-14T07:00:00.000Z'
    }
    vi.mocked(fetchQuotes).mockResolvedValue({
      quotes: [quote],
      source: 'eastmoney-primary'
    })
    const publishQuotes = vi.fn()
    const runtime = createRuntime(state, publishQuotes)

    const quotes = await runtime.refreshStocks([profile.quoteId], 'tracking-review')

    expect(fetchQuotes).toHaveBeenCalledWith(
      [expect.objectContaining({ quoteId: profile.quoteId, showRadarSignals: false })],
      [],
      'quote-cycle:tracking-review',
      expect.any(Function)
    )
    expect(quotes).toEqual([quote])
    expect(publishQuotes).toHaveBeenCalledWith([quote])
  })

  it('uses the complete enabled watchlist for radar refreshes and refreshes all rows after an update', async () => {
    const profile = trackingProfile()
    const priority = watchStock('600010', true)
    const regular = watchStock('600011', false)
    const state = appState(profile)
    state.watchlist = [priority, regular]
    vi.mocked(fetchQuotes).mockImplementation(async (stocks) => ({
      quotes: stocks.map(stockQuote),
      source: 'eastmoney-primary'
    }))
    const runtime = createRuntime(state)

    await runtime.refreshStock(priority.quoteId, 'priority-only')

    expect(fetchQuotes).toHaveBeenNthCalledWith(
      1,
      [priority],
      [priority, regular],
      'quote-cycle:priority-only',
      expect.any(Function)
    )

    const onRadarSignalsUpdated = vi.mocked(fetchQuotes).mock.calls[0][3]
    onRadarSignalsUpdated?.()
    await vi.waitFor(() => expect(fetchQuotes).toHaveBeenCalledTimes(2))

    expect(vi.mocked(fetchQuotes).mock.calls[1][0]).toEqual(expect.arrayContaining([
      priority,
      regular
    ]))
    expect(vi.mocked(fetchQuotes).mock.calls[1][1]).toEqual([priority, regular])
    expect(vi.mocked(fetchQuotes).mock.calls[1][2]).toBe('quote-cycle:radar-updated')
  })

  it('retains existing radar signals when a quote refresh has no radar payload', async () => {
    const profile = trackingProfile()
    const stock = watchStock('600012', false)
    const state = appState(profile)
    state.watchlist = [stock]
    const withRadar: StockQuote = {
      ...stockQuote(stock),
      radarSignals: [{
        type: '8201',
        label: '火箭发射',
        date: '20260818',
        time: '10:15:30',
        info: '快速拉升',
        direction: 'up'
      }]
    }
    vi.mocked(fetchQuotes)
      .mockResolvedValueOnce({ quotes: [withRadar], source: 'eastmoney-primary' })
      .mockResolvedValueOnce({ quotes: [stockQuote(stock)], source: 'eastmoney-primary' })
    const runtime = createRuntime(state)

    await runtime.refreshStock(stock.quoteId, 'first')
    const refreshed = await runtime.refreshStock(stock.quoteId, 'second')

    expect(refreshed[0].radarSignals).toEqual(withRadar.radarSignals)
  })
})
