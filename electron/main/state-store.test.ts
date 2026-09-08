import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_GROUPS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState,
  type StockTrackingProfile
} from '../../src/shared/types'
import {
  LAST_GOOD_STATE_MANIFEST_FILE_NAME,
  LEGACY_LAST_GOOD_STATE_FILE_NAME,
  LEGACY_STATE_FILE_NAME,
  STATE_DIRECTORY_NAME,
  STATE_FILE_NAME,
  STATE_HISTORY_DIRECTORY_NAME,
  STATE_MANIFEST_FILE_NAME,
  StateStore,
  StateStoreRevisionConflictError,
  type StateManifestV1
} from './state-store'

function makeState(name = '浦发银行'): AppState {
  return {
    watchlist: [
      {
        code: '600000',
        name,
        quoteId: '1.600000',
        marketLabel: '沪A',
        showInTaskbar: false,
        isPriority: false,
        showRadarSignals: true,
        groupIds: [],
        positionSnapshots: [],
        alertRules: []
      }
    ],
    watchlistGroups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group })),
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: {},
    corporateActionRecords: {},
    portfolioPerformanceAdjustments: {}
  }
}

function makeTrackingProfile(): StockTrackingProfile {
  return {
    quoteId: '1.600000',
    code: '600000',
    name: '浦发银行',
    marketLabel: '沪A',
    status: 'tracking',
    tags: [],
    thesis: '',
    startedAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    sources: [],
    entries: [],
    metricSnapshots: []
  }
}

function statePath(directory: string, fileName: string): string {
  return join(directory, STATE_DIRECTORY_NAME, fileName)
}

function readManifest(directory: string, fileName = STATE_MANIFEST_FILE_NAME): StateManifestV1 {
  return JSON.parse(readFileSync(statePath(directory, fileName), 'utf8')) as StateManifestV1
}

function write(directory: string, relativePath: string, content: string): void {
  const path = join(directory, ...relativePath.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

describe('StateStore', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jianzhang-state-store-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates manifest state and a last-good manifest on first launch', () => {
    const defaultState = makeState()
    const result = new StateStore(directory, defaultState).load()

    expect(result.state).toEqual({ ...defaultState, revision: 1 })
    expect(readManifest(directory).revision).toBe(1)
    expect(readManifest(directory, LAST_GOOD_STATE_MANIFEST_FILE_NAME).revision).toBe(1)
    expect(existsSync(join(directory, STATE_FILE_NAME))).toBe(false)
  })

  it('loads a saved manifest state without a warning', () => {
    const store = new StateStore(directory, makeState())
    const saved = store.normalize(makeState('已有配置'))
    store.save(saved)

    const loaded = store.load()
    expect(loaded.warning).toBeUndefined()
    expect(loaded.state.watchlist[0]).toMatchObject({
      name: '已有配置',
      alertRules: [],
      groupIds: [],
      positionSnapshots: []
    })
  })

  it('migrates a legacy settings.json once and keeps recognizable legacy copies', () => {
    write(directory, STATE_FILE_NAME, JSON.stringify({ ...makeState('旧配置'), revision: 12 }))
    write(directory, 'settings.last-good.json', JSON.stringify(makeState('旧备份')))

    const result = new StateStore(directory, makeState()).load()

    expect(result.state.revision).toBe(13)
    expect(result.state.watchlist[0].name).toBe('旧配置')
    expect(existsSync(statePath(directory, STATE_MANIFEST_FILE_NAME))).toBe(true)
    expect(existsSync(join(directory, LEGACY_STATE_FILE_NAME))).toBe(true)
    expect(existsSync(join(directory, LEGACY_LAST_GOOD_STATE_FILE_NAME))).toBe(true)
    expect(existsSync(join(directory, STATE_FILE_NAME))).toBe(false)
  })

  it('migrates from legacy last-good when the current legacy file is damaged', () => {
    write(directory, STATE_FILE_NAME, '{invalid json')
    write(
      directory,
      'settings.last-good.json',
      JSON.stringify({ ...makeState('旧备份'), revision: 8 })
    )

    const result = new StateStore(
      directory,
      makeState(),
      () => new Date('2026-09-08T08:00:00.000Z')
    ).load()

    expect(result.state.revision).toBe(9)
    expect(result.state.watchlist[0].name).toBe('旧备份')
    expect(result.warning).toContain('已从旧版最近备份迁移')
    expect(readdirSync(directory).some((name) => name.startsWith('settings.invalid-'))).toBe(true)
  })

  it('recovers a damaged current manifest from the previous committed manifest', () => {
    const store = new StateStore(directory, makeState())
    store.load()
    store.save(store.normalize(makeState('第一版')))
    store.save(store.normalize(makeState('第二版')))
    writeFileSync(statePath(directory, STATE_MANIFEST_FILE_NAME), '{invalid json', 'utf8')

    const result = store.load()

    expect(result.state.watchlist[0].name).toBe('第一版')
    expect(result.warning).toContain('已从最近可用状态恢复')
    expect(
      readdirSync(join(directory, STATE_DIRECTORY_NAME)).some((name) =>
        name.startsWith('manifest.invalid-')
      )
    ).toBe(true)
  })

  it('recovers when a referenced current document is damaged', () => {
    const store = new StateStore(directory, makeState())
    store.load()
    store.save(store.normalize(makeState('第一版')))
    store.save(store.normalize(makeState('第二版')))
    const manifest = readManifest(directory)
    writeFileSync(
      join(directory, STATE_DIRECTORY_NAME, ...manifest.documents.watchlist.path.split('/')),
      '{invalid json',
      'utf8'
    )

    const result = store.load()

    expect(result.state.watchlist[0].name).toBe('第一版')
    expect(result.warning).toContain('已从最近可用状态恢复')
  })

  it('reports damaged manifest state when no backup is available', () => {
    write(directory, `${STATE_DIRECTORY_NAME}/${STATE_MANIFEST_FILE_NAME}`, '{invalid json')
    const store = new StateStore(directory, makeState(), () => new Date('2026-09-08T08:00:00.000Z'))

    expect(() => store.load()).toThrow('且没有可用备份')
    expect(readFileSync(statePath(directory, STATE_MANIFEST_FILE_NAME), 'utf8')).toBe(
      '{invalid json'
    )
  })

  it('reuses an unchanged tracking document when another domain changes', () => {
    const store = new StateStore(directory, makeState())
    const first = store.normalize({
      ...makeState('第一版'),
      stockTrackingProfiles: { '1.600000': makeTrackingProfile() }
    })
    store.save(first)
    const firstManifest = readManifest(directory)

    store.save(
      store.normalize({
        ...first,
        watchlist: first.watchlist.map((stock) => ({ ...stock, name: '第二版' }))
      })
    )
    const secondManifest = readManifest(directory)

    expect(secondManifest.documents.trackingProfiles['1.600000']).toEqual(
      firstManifest.documents.trackingProfiles['1.600000']
    )
    expect(secondManifest.documents.watchlist).not.toEqual(firstManifest.documents.watchlist)
  })

  it('leaves the previous manifest active when the manifest replacement fails', () => {
    const store = new StateStore(directory, makeState())
    store.save(store.normalize(makeState('原配置')))
    const originalManifest = readFileSync(statePath(directory, STATE_MANIFEST_FILE_NAME), 'utf8')
    mkdirSync(statePath(directory, `${STATE_MANIFEST_FILE_NAME}.tmp`))
    const rejected = store.normalize(makeState('不应写入'))

    expect(() => store.save(rejected)).toThrow()
    expect(readFileSync(statePath(directory, STATE_MANIFEST_FILE_NAME), 'utf8')).toBe(
      originalManifest
    )
    expect(rejected.revision).toBeUndefined()
  })

  it('rejects stale renderer revisions', () => {
    const store = new StateStore(directory, makeState())
    const state = store.normalize(makeState('当前配置'))
    store.save(state)

    expect(() => store.assertRevision({ ...state, revision: 0 })).toThrow('数据已在后台更新')
    expect(() => store.assertRevision(state)).not.toThrow()
  })

  it('rejects a stale instance before it overwrites a newer manifest', () => {
    const firstStore = new StateStore(directory, makeState())
    firstStore.load()
    const staleStore = new StateStore(directory, makeState())
    const staleState = staleStore.load().state
    const firstState = firstStore.load().state

    firstStore.save(
      firstStore.normalize({ ...firstState, watchlist: makeState('磁盘新配置').watchlist })
    )

    expect(() =>
      staleStore.save(
        staleStore.normalize({ ...staleState, watchlist: makeState('旧实例配置').watchlist })
      )
    ).toThrow(StateStoreRevisionConflictError)
    expect(firstStore.load().state.watchlist[0].name).toBe('磁盘新配置')
  })

  it('rejects changed manifest content even when the revision is unchanged', () => {
    const store = new StateStore(directory, makeState())
    const state = store.load().state
    const manifest = readManifest(directory)
    writeFileSync(
      statePath(directory, STATE_MANIFEST_FILE_NAME),
      JSON.stringify({ ...manifest, committedAt: '2026-09-08T09:00:00.000Z' }, null, 2),
      'utf8'
    )

    expect(() => store.save({ ...state, watchlist: makeState('旧实例配置').watchlist })).toThrow(
      StateStoreRevisionConflictError
    )
  })

  it('keeps timestamped manifest history snapshots', () => {
    let current = new Date('2026-09-08T00:00:00.000Z')
    const store = new StateStore(directory, makeState(), () => current)
    store.save(store.normalize(makeState('第一次保存')))
    current = new Date('2026-09-08T00:16:00.000Z')
    store.save(store.normalize(makeState('第二次保存')))

    const history = readdirSync(join(directory, STATE_HISTORY_DIRECTORY_NAME)).filter((name) =>
      name.startsWith('manifest-')
    )
    expect(history).toHaveLength(1)
  })
})
