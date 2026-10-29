import { describe, expect, it, vi } from 'vitest'
import {
  applyAppStateUpdate,
  createAppStateUpdate,
  type AppStateUpdate,
  type BootstrapSyncResult,
  type StockDesktopBridge
} from '../shared/state-changes'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState
} from '../shared/types'
import { createStateClient } from './state-client'

function setup() {
  const state: AppState = {
    revision: 1,
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    stockTradingBooks: {},
    corporateActionApplications: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER]
  }
  const bootstrap = { state, quotes: [], trackingArchiveIndex: {}, source: 'eastmoney' as const }
  let deliver: (update: AppStateUpdate) => void = () => undefined
  const getBootstrap = vi.fn<StockDesktopBridge['getBootstrap']>().mockResolvedValue(bootstrap)
  const saveStateChanges = vi.fn<StockDesktopBridge['saveStateChanges']>()
  const bridge = {
    getBootstrap,
    saveStateChanges,
    onStateChanged: (callback: typeof deliver) => {
      deliver = callback
      return () => undefined
    }
  } as unknown as StockDesktopBridge
  const client = createStateClient(bridge)
  return {
    state,
    bootstrap,
    client,
    getBootstrap,
    saveStateChanges,
    deliver: (update: AppStateUpdate) => deliver(update)
  }
}

describe('desktop incremental state client', () => {
  it('requests no state body when refreshing an already current bootstrap', async () => {
    const { client, getBootstrap, bootstrap } = setup()
    const first = await client.getBootstrap()
    getBootstrap.mockResolvedValueOnce({ ...bootstrap, state: undefined })
    const second = await client.getBootstrap()
    expect(getBootstrap).toHaveBeenLastCalledWith(1)
    expect(second.state).toBe(first.state)
  })

  it('submits only changed fields and skips an unchanged save', async () => {
    const { state, client, saveStateChanges } = setup()
    await client.getBootstrap()
    await client.saveState(state)
    expect(saveStateChanges).not.toHaveBeenCalled()
    saveStateChanges.mockImplementation(async (update) => ({ ...update, revision: 2 }))
    const saved = await client.saveState({
      ...state,
      settings: { ...state.settings, theme: 'dark' }
    })
    expect(saved.settings.theme).toBe('dark')
    expect(saved.stockTrackingProfiles).toBe(state.stockTrackingProfiles)
    expect(JSON.stringify(saveStateChanges.mock.calls[0][0])).not.toContain('stockTradingProfiles')
  })

  it('does not roll back a newer broadcast when an earlier save reply arrives', async () => {
    const { state, client, saveStateChanges, deliver } = setup()
    await client.getBootstrap()
    let resolveSave!: (update: AppStateUpdate) => void
    saveStateChanges.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const next = { ...state, settings: { ...state.settings, theme: 'dark' as const } }
    const saving = client.saveState(next)
    const firstUpdate = createAppStateUpdate(state, { ...next, revision: 2 })
    const second = applyAppStateUpdate(state, firstUpdate)
    const latest = { ...second, revision: 3, columnOrder: [...second.columnOrder].reverse() }
    deliver(firstUpdate)
    deliver(createAppStateUpdate(second, latest))
    resolveSave(firstUpdate)
    const saved = await saving
    expect(saved.revision).toBe(3)
    expect(saved.columnOrder).toEqual(latest.columnOrder)
  })

  it('replays updates arriving while the initial bootstrap is in flight', async () => {
    const { state, bootstrap, client, getBootstrap, deliver } = setup()
    let resolveBootstrap!: (result: BootstrapSyncResult) => void
    getBootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = resolve
        })
    )
    const loading = client.getBootstrap()
    const next = { ...state, revision: 2, settings: { ...state.settings, theme: 'dark' as const } }
    deliver(createAppStateUpdate(state, next))
    resolveBootstrap(bootstrap)
    expect((await loading).state).toEqual(next)
  })

  it('recovers a version gap once and then resumes incremental updates', async () => {
    const { state, client, bootstrap, getBootstrap, deliver } = setup()
    await client.getBootstrap()
    const third = { ...state, revision: 3, settings: { ...state.settings, theme: 'dark' as const } }
    const fourth = { ...third, revision: 4 }
    getBootstrap.mockResolvedValueOnce({ ...bootstrap, state: fourth })
    deliver(createAppStateUpdate(third, fourth))
    const synchronized = await client.getBootstrap()
    expect(synchronized.state.revision).toBe(4)
    expect(getBootstrap).toHaveBeenCalledTimes(2)
    const fifth = {
      ...fourth,
      revision: 5,
      settings: { ...fourth.settings, theme: 'light' as const }
    }
    deliver(createAppStateUpdate(fourth, fifth))
    getBootstrap.mockResolvedValueOnce({ ...bootstrap, state: undefined })
    expect((await client.getBootstrap()).state.settings.theme).toBe('light')
  })
})
