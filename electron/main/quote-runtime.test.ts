import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  DEFAULT_WATCHLIST_GROUPS,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type StockQuote,
  type StockTrackingProfile
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

describe('QuoteRuntime tracking review quotes', () => {
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
    const runtime = new QuoteRuntime({
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

    const quotes = await runtime.refreshStocks([profile.quoteId], 'tracking-review')

    expect(fetchQuotes).toHaveBeenCalledWith(
      [expect.objectContaining({ quoteId: profile.quoteId, showRadarSignals: false })],
      [],
      'quote-cycle:tracking-review'
    )
    expect(quotes).toEqual([quote])
    expect(publishQuotes).toHaveBeenCalledWith([quote])
  })
})
