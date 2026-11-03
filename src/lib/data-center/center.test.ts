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
import { startStockTracking, createStockTrackingSource } from '../stock-tracking'
import { changeStock, changeSettings, removeWatchStock, withUnchangedData } from './mutations'

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
  const archiveStockTrackingCycle = vi.fn<StockDesktopApi['archiveStockTrackingCycle']>()
  const deleteAllStockTrackingArchives = vi.fn<StockDesktopApi['deleteAllStockTrackingArchives']>()
  const refreshQuotesByIds = vi.fn<StockDesktopApi['refreshQuotesByIds']>()
  const transport = {
    getBootstrap,
    saveState,
    archiveStockTrackingCycle,
    deleteAllStockTrackingArchives,
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
    archiveStockTrackingCycle,
    deleteAllStockTrackingArchives,
    refreshQuotesByIds,
    stopState,
    stopQuotes,
    pushState: (value: AppState) => pushState(value),
    pushQuotes: (value: StockQuote[]) => pushQuotes(value)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('window data center', () => {
  it('queues archive and archive deletion with ordinary state writes', async () => {
    const f = setup()
    const save = deferred<AppState>()
    const archive = deferred<Awaited<ReturnType<StockDesktopApi['archiveStockTrackingCycle']>>>()
    const archiveStarted = deferred<void>()
    f.saveState.mockReturnValueOnce(save.promise)
    f.archiveStockTrackingCycle.mockImplementationOnce(() => {
      archiveStarted.resolve()
      return archive.promise
    })
    f.deleteAllStockTrackingArchives.mockResolvedValue({})
    const first = f.center.commands.update(
      changeStock('A', (stock) => ({ ...stock, isPriority: true }))
    )
    const profile = startStockTracking(
      undefined,
      f.state.watchlist[0],
      createStockTrackingSource('manual', {}),
      undefined
    )
    const second = f.center.commands.archive((current) => ({
      state: current,
      profile,
      deletePreviousArchives: false
    }))
    const third = f.center.api.deleteAllStockTrackingArchives('A')
    await Promise.resolve()
    expect(f.archiveStockTrackingCycle).not.toHaveBeenCalled()
    save.resolve({ ...f.saveState.mock.calls[0][0], revision: 2 })
    await first
    await archiveStarted.promise
    expect(f.archiveStockTrackingCycle.mock.calls[0][0].revision).toBe(2)
    expect(f.archiveStockTrackingCycle.mock.calls[0][0].watchlist[0].isPriority).toBe(true)
    expect(f.deleteAllStockTrackingArchives).not.toHaveBeenCalled()
    const archiveIndex = {
      A: { quoteId: 'A', code: 'A', name: 'A', marketLabel: '沪A', cycles: [] }
    }
    archive.resolve({
      state: { ...f.archiveStockTrackingCycle.mock.calls[0][0], revision: 3 },
      archiveIndex
    })
    await second
    expect(f.center.getSnapshot().trackingArchiveIndex).toBe(archiveIndex)
    await third
    expect(f.center.getSnapshot().trackingArchiveIndex).toEqual({})
  })

  it('serializes commands against the previous confirmed result', async () => {
    const f = setup()
    const firstSave = deferred<AppState>()
    f.saveState
      .mockReturnValueOnce(firstSave.promise)
      .mockImplementationOnce(async (next) => ({ ...next, revision: 3 }))
    const first = f.center.commands.update(
      changeStock('A', (stock) => ({ ...stock, showInTaskbar: true }))
    )
    const second = f.center.commands.update(
      changeStock('B', (stock) => ({ ...stock, isPriority: true }))
    )
    await Promise.resolve()
    expect(f.saveState).toHaveBeenCalledTimes(1)
    expect(f.center.getSnapshot().writes.pendingCount).toBe(2)
    firstSave.resolve({ ...f.saveState.mock.calls[0][0], revision: 2 })
    await Promise.all([first, second])
    expect(f.saveState.mock.calls[1][0].revision).toBe(2)
    expect(f.center.getSnapshot().state.watchlist[0].showInTaskbar).toBe(true)
    expect(f.center.getSnapshot().state.watchlist[1].isPriority).toBe(true)
    expect(f.center.getSnapshot().writes.pendingCount).toBe(0)
  })

  it('retains quotes through optimistic deletion and restores on failure', async () => {
    const f = setup()
    await f.center.api.getBootstrap()
    const save = deferred<AppState>()
    f.saveState.mockReturnValueOnce(save.promise)
    const pending = f.center.commands.update(removeWatchStock('A'))
    const rejected = expect(pending).rejects.toThrow('failed')
    await Promise.resolve()
    expect(f.center.getSnapshot().state.watchlist.some((stock) => stock.quoteId === 'A')).toBe(
      false
    )
    expect(f.center.getSnapshot().quotesById.has('A')).toBe(true)
    save.reject(new Error('failed'))
    await rejected
    expect(f.center.getSnapshot().state).toBe(f.state)
    expect(f.center.getSnapshot().quotesById.has('A')).toBe(true)
  })

  it('keeps newer background changes and runs the next command without replaying a failed write', async () => {
    const f = setup()
    const save = deferred<AppState>()
    f.saveState
      .mockReturnValueOnce(save.promise)
      .mockImplementationOnce(async (next) => ({ ...next, revision: 3 }))
    const first = f.center.commands.update(
      changeStock('A', (stock) => ({ ...stock, showInTaskbar: true }))
    )
    const rejected = expect(first).rejects.toThrow('conflict')
    const second = f.center.commands.update(
      changeStock('B', (stock) => ({ ...stock, isPriority: true }))
    )
    await Promise.resolve()
    f.pushState({ ...f.state, revision: 2, columnOrder: [] })
    save.reject(new Error('conflict'))
    await rejected
    await second
    expect(f.saveState).toHaveBeenCalledTimes(2)
    expect(f.center.getSnapshot().state.columnOrder).toEqual([])
    expect(f.center.getSnapshot().state.watchlist[0].showInTaskbar).toBe(false)
    expect(f.center.getSnapshot().state.watchlist[1].isPriority).toBe(true)
  })

  it('blocks queued writes while recovery fails and resumes after synchronization', async () => {
    const f = setup()
    f.saveState
      .mockRejectedValueOnce(new Error('save failed'))
      .mockImplementationOnce(async (next) => ({ ...next, revision: 2 }))
    f.getBootstrap.mockRejectedValue(new Error('offline'))
    await expect(f.center.commands.update(changeSettings({ theme: 'dark' }))).rejects.toThrow(
      'save failed'
    )
    await expect(f.center.commands.update(changeSettings({ theme: 'light' }))).rejects.toThrow(
      'offline'
    )
    expect(f.saveState).toHaveBeenCalledTimes(1)
    f.getBootstrap.mockResolvedValue(f.bootstrap)
    await f.center.commands.update(changeSettings({ theme: 'dark' }))
    expect(f.saveState).toHaveBeenCalledTimes(2)
    expect(f.center.getSnapshot().writes.lastError).toBeNull()
  })

  it('rejects a draft if its selected data changes while queued', async () => {
    const f = setup()
    const save = deferred<AppState>()
    f.saveState.mockReturnValueOnce(save.promise)
    const first = f.center.commands.update(
      changeStock('A', (stock) => ({ ...stock, showInTaskbar: true }))
    )
    const second = f.center.commands.update(
      withUnchangedData(
        f.state,
        (state) => state.watchlist[0],
        changeStock('A', (stock) => ({ ...stock, isPriority: true }))
      )
    )
    const rejected = expect(second).rejects.toThrow('相关数据已更新')
    await Promise.resolve()
    save.resolve({ ...f.saveState.mock.calls[0][0], revision: 2 })
    await first
    await rejected
    expect(f.saveState).toHaveBeenCalledTimes(1)
    expect(f.center.getSnapshot().state.watchlist[0].showInTaskbar).toBe(true)
  })

  it('rejects obsolete full-state saves without calling the transport', async () => {
    const f = setup()
    f.pushState({ ...f.state, revision: 2 })
    await expect(f.center.api.saveState(f.state)).rejects.toThrow('数据已在后台更新')
    expect(f.saveState).not.toHaveBeenCalled()
  })

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
    await fixture.center.commands.update((current) => ({ ...current, columnOrder: [] }))
    expect(fixture.center.getSnapshot().state).toBe(updated)
    fixture.saveState.mockRejectedValueOnce(new Error('保存失败'))
    await expect(
      fixture.center.commands.update((current) => ({ ...current, columnOrder: [] }))
    ).rejects.toThrow('保存失败')
    expect(fixture.center.getSnapshot().state).toBe(updated)
  })
})
