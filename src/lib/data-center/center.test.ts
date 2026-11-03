import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState,
  type BootstrapResult,
  type StockDesktopApi,
  type StockQuote
} from '../../shared/types'
import { createDataCenter } from './center'

function quote(quoteId: string, latest: number): StockQuote {
  return {
    quoteId,
    code: quoteId,
    name: quoteId,
    latest,
    change: 0,
    changePercent: 0,
    open: latest,
    high: latest,
    low: latest,
    previousClose: latest,
    volume: 100,
    amount: 1000,
    turnoverRate: 1,
    updatedAt: '2026-11-03 10:00:00'
  }
}

function setup() {
  const state: AppState = {
    revision: 1,
    watchlist: ['A', 'B'].map((quoteId) => ({
      quoteId,
      code: quoteId,
      name: quoteId,
      marketLabel: '沪A',
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: false
    })),
    watchlistGroups: [],
    stockTrackingProfiles: {},
    stockTradingBooks: {},
    corporateActionApplications: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER]
  }
  const bootstrap: BootstrapResult = {
    state,
    quotes: [quote('A', 10), quote('B', 20)],
    trackingArchiveIndex: {},
    source: 'eastmoney'
  }
  let pushState: (state: AppState) => void = () => undefined
  let pushQuotes: (quotes: StockQuote[]) => void = () => undefined
  const stopState = vi.fn()
  const stopQuotes = vi.fn()
  const getBootstrap = vi.fn<StockDesktopApi['getBootstrap']>().mockResolvedValue(bootstrap)
  const saveState = vi.fn<StockDesktopApi['saveState']>()
  const refreshQuotesByIds = vi.fn<StockDesktopApi['refreshQuotesByIds']>()
  const transport = {
    getBootstrap,
    saveState,
    refreshQuotesByIds,
    onStateUpdated: vi.fn((listener: typeof pushState) => {
      pushState = listener
      return stopState
    }),
    onQuotesUpdated: vi.fn((listener: typeof pushQuotes) => {
      pushQuotes = listener
      return stopQuotes
    })
  } as unknown as StockDesktopApi
  const center = createDataCenter(transport, state)
  return {
    center,
    transport,
    state,
    bootstrap,
    getBootstrap,
    saveState,
    refreshQuotesByIds,
    stopState,
    stopQuotes,
    pushState: (value: AppState) => pushState(value),
    pushQuotes: (value: StockQuote[]) => pushQuotes(value)
  }
}

describe('window data center', () => {
  it('does not resurrect removed stocks from a pending refresh response', async () => {
    const fixture = setup()
    await fixture.center.api.getBootstrap()
    let resolve!: (quotes: StockQuote[]) => void
    fixture.refreshQuotesByIds.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const pending = fixture.center.api.refreshQuotesByIds(['A'])
    fixture.pushState({
      ...fixture.state,
      revision: 2,
      watchlist: fixture.state.watchlist.slice(1)
    })
    resolve([quote('A', 12)])
    await pending
    expect(fixture.center.getSnapshot().quotes.map((q) => q.quoteId)).toEqual(['B'])
    expect(fixture.center.getSnapshot().quotesById.has('A')).toBe(false)
  })

  it('filters an old bootstrap snapshot using the latest stock ownership', async () => {
    const fixture = setup()
    let resolve!: (result: BootstrapResult) => void
    fixture.getBootstrap.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const pending = fixture.center.api.getBootstrap()
    fixture.pushState({
      ...fixture.state,
      revision: 2,
      watchlist: fixture.state.watchlist.slice(1)
    })
    resolve(fixture.bootstrap)
    expect((await pending).quotes.map((q) => q.quoteId)).toEqual(['B'])
  })

  it('merges a partial response without changing its legacy return value', async () => {
    const fixture = setup()
    await fixture.center.api.getBootstrap()
    const response = [quote('A', 12)]
    fixture.refreshQuotesByIds.mockResolvedValue(response)
    expect(await fixture.center.api.refreshQuotesByIds(['A'])).toBe(response)
    expect(fixture.center.getSnapshot().quotesById.get('A')?.latest).toBe(12)
    expect(fixture.center.getSnapshot().quotesById.get('B')?.latest).toBe(20)
  })

  it('retains a newer push when a pending manual refresh completes', async () => {
    const fixture = setup()
    let resolve!: (quotes: StockQuote[]) => void
    fixture.refreshQuotesByIds.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const pending = fixture.center.api.refreshQuotesByIds(['A'])
    fixture.pushQuotes([quote('A', 15), quote('B', 20)])
    const response = [quote('A', 12)]
    resolve(response)
    expect(await pending).toBe(response)
    expect(fixture.center.getSnapshot().quotesById.get('A')?.latest).toBe(15)
  })

  it('shares transport subscriptions and preserves unrelated stock references', async () => {
    const fixture = setup()
    const { center, bootstrap, transport } = fixture
    await center.api.getBootstrap()
    const a = center.select((snapshot) => snapshot.quotesById.get('A'))
    const b = center.select((snapshot) => snapshot.quotesById.get('B'))
    const previousB = b.getSnapshot()
    const onA = vi.fn()
    const onB = vi.fn()
    const stopA = a.subscribe(onA)
    b.subscribe(onB)
    center.api.onQuotesUpdated(() => undefined)
    fixture.pushQuotes([quote('A', 11), structuredClone(bootstrap.quotes[1])])
    expect(onA).toHaveBeenCalledOnce()
    expect(onB).not.toHaveBeenCalled()
    expect(b.getSnapshot()).toBe(previousB)
    expect(transport.onQuotesUpdated).toHaveBeenCalledOnce()
    stopA()
    fixture.pushQuotes([quote('A', 12), quote('B', 20)])
    expect(onA).toHaveBeenCalledOnce()
    center.dispose()
    expect(fixture.stopState).toHaveBeenCalledOnce()
    expect(fixture.stopQuotes).toHaveBeenCalledOnce()
  })

  it('does not overwrite pushes received while bootstrap is pending', async () => {
    const fixture = setup()
    let resolve!: (result: BootstrapResult) => void
    fixture.getBootstrap.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const first = fixture.center.api.getBootstrap()
    const second = fixture.center.api.getBootstrap()
    expect(first).toBe(second)
    fixture.pushState({ ...fixture.state, revision: 2 })
    fixture.pushQuotes([quote('A', 13)])
    resolve(fixture.bootstrap)
    const result = await first
    expect(result.state.revision).toBe(2)
    expect(result.quotes[0].latest).toBe(13)
  })

  it('publishes successful saves without changing data on a failed save', async () => {
    const fixture = setup()
    const updated = { ...fixture.state, revision: 2 }
    fixture.saveState.mockResolvedValueOnce(updated)
    await fixture.center.api.saveState(updated)
    expect(fixture.center.getSnapshot().state).toBe(updated)
    fixture.saveState.mockRejectedValueOnce(new Error('保存失败'))
    await expect(fixture.center.api.saveState({ ...updated, revision: 3 })).rejects.toThrow(
      '保存失败'
    )
    expect(fixture.center.getSnapshot().state).toBe(updated)
  })
})
