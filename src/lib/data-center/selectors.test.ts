import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, DEFAULT_WATCHLIST_COLUMN_ORDER } from '../../shared/types'
import type { AppDataSnapshot } from './center'
import { selectSettings, selectStockTradingBook, shallowEqual } from './selectors'
import { createSnapshotStore } from './store'
import { changeSettings, prepareStateMutation } from './mutations'

function fixture(): AppDataSnapshot {
  return {
    state: {
      revision: 1,
      watchlist: [],
      watchlistGroups: [],
      stockTrackingProfiles: {},
      stockTradingBooks: {
        A: { quoteId: 'A', accounts: {} },
        B: { quoteId: 'B', accounts: {} }
      },
      corporateActionApplications: {},
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER]
    },
    quotes: [],
    quotesById: new Map(),
    trackingArchiveIndex: {},
    writes: { pendingCount: 0, activeOperation: null, lastError: null }
  }
}

describe('business subscription boundaries', () => {
  it('does not notify the watchlist when an optimistic setting change leaves membership intact', () => {
    const initial = fixture()
    initial.state.watchlist = [
      {
        quoteId: 'A',
        code: 'A',
        name: 'A',
        marketLabel: '沪A',
        groupIds: [],
        showInTaskbar: false,
        isPriority: false,
        showRadarSignals: false
      }
    ]
    const store = createSnapshotStore(initial)
    const watchlist = store.select((snapshot) => snapshot.state.watchlist)
    const notified = vi.fn()
    watchlist.subscribe(notified)
    const state = prepareStateMutation(initial.state, changeSettings({ theme: 'dark' }))
    store.publish({ ...initial, state })
    expect(notified).not.toHaveBeenCalled()
    expect(watchlist.getSnapshot()).toBe(initial.state.watchlist)
    expect(state.settings.theme).toBe('dark')
  })
  it('keeps fee settings stable through theme, write-status and archive updates', () => {
    const initial = fixture()
    const store = createSnapshotStore(initial)
    const selection = store.select(
      (snapshot) => selectSettings(snapshot, ['tTradingFees', 'marketTradeFees']),
      shallowEqual
    )
    const before = selection.getSnapshot()
    const notified = vi.fn()
    selection.subscribe(notified)
    store.publish({ ...initial, writes: { ...initial.writes, pendingCount: 1 } })
    const themed = {
      ...initial,
      state: { ...initial.state, settings: { ...initial.state.settings, theme: 'dark' as const } }
    }
    store.publish(themed)
    store.publish({ ...themed, trackingArchiveIndex: {} })
    expect(notified).not.toHaveBeenCalled()
    expect(selection.getSnapshot()).toBe(before)
    const fees = { ...initial.state.settings.tTradingFees, minimumCommissionBundle: 8 }
    store.publish({
      ...themed,
      state: { ...themed.state, settings: { ...themed.state.settings, tTradingFees: fees } }
    })
    expect(notified).toHaveBeenCalledOnce()
    expect(selection.getSnapshot().tTradingFees).toBe(fees)
  })

  it('notifies only the affected stock book and keeps references through rollback', () => {
    const initial = fixture()
    const store = createSnapshotStore(initial)
    const a = store.select((snapshot) => selectStockTradingBook(snapshot, 'A'))
    const b = store.select((snapshot) => selectStockTradingBook(snapshot, 'B'))
    const changedA = vi.fn()
    const changedB = vi.fn()
    a.subscribe(changedA)
    b.subscribe(changedB)
    const updatedA = { quoteId: 'A', accounts: {}, boardLotSize: 100 }
    store.publish({
      ...initial,
      state: {
        ...initial.state,
        stockTradingBooks: { ...initial.state.stockTradingBooks, A: updatedA }
      }
    })
    expect(changedA).toHaveBeenCalledOnce()
    expect(changedB).not.toHaveBeenCalled()
    expect(a.getSnapshot()).toBe(updatedA)
    store.publish(initial)
    expect(changedA).toHaveBeenCalledTimes(2)
    expect(changedB).not.toHaveBeenCalled()
    expect(a.getSnapshot()).toBe(initial.state.stockTradingBooks.A)
  })
})
