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
  type TTrade
} from '../../src/shared/types'
import {
  LAST_GOOD_STATE_FILE_NAME,
  LEGACY_TRADING_BACKUP_FILE_NAME,
  STATE_FILE_NAME,
  STATE_HISTORY_DIRECTORY_NAME,
  StateStore
} from './state-store'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

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
        showRadarSignals: true
      }
    ],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: {}
  }
}

function trade(id: string): TTrade {
  return {
    id,
    side: 'buy',
    purpose: 't',
    tradedAt: '2026-07-31T01:30:00.000Z',
    price: 10,
    quantity: 100,
    fees: EMPTY_FEES,
    note: ''
  }
}

function readState(path: string): AppState {
  return JSON.parse(readFileSync(path, 'utf8')) as AppState
}

describe('StateStore', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jianzhang-state-store-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates the default state and last-good backup on first launch', () => {
    const defaultState = makeState()
    const result = new StateStore(directory, defaultState).load()

    expect(result.state).toEqual({ ...defaultState, revision: 1 })
    expect(readState(join(directory, STATE_FILE_NAME))).toEqual(result.state)
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME))).toEqual(result.state)
  })

  it('loads an existing current-version state without a warning', () => {
    const store = new StateStore(directory, makeState())
    const saved = makeState('已有配置')
    store.save(saved)

    const loaded = store.load()
    expect(loaded.warning).toBeUndefined()
    expect(loaded.state.watchlist[0]).toMatchObject({
      name: '已有配置',
      alertRules: [],
      groupIds: [],
      positionSnapshots: []
    })
    expect(loaded.state.watchlistGroups).toEqual(DEFAULT_WATCHLIST_GROUPS)
    expect(readState(join(directory, STATE_FILE_NAME)).watchlistGroups).toEqual(
      DEFAULT_WATCHLIST_GROUPS
    )
  })

  it('normalizes legacy trades and keeps an untouched migration backup', () => {
    const legacy = {
      ...makeState(),
      columnOrderVersion: 1,
      tTradingAccounts: {
        '1.600000': {
          quoteId: '1.600000',
          code: '600000',
          name: '浦发银行',
          baseTrades: [trade('base')],
          history: [],
          activeBatch: {
            id: 'batch-1',
            sequence: 1,
            openedAt: '2026-07-31T01:30:00.000Z',
            sellLevels: [],
            trades: [trade('active')]
          }
        }
      }
    }
    writeFileSync(join(directory, STATE_FILE_NAME), JSON.stringify(legacy, null, 2), 'utf8')

    const result = new StateStore(directory, makeState()).load()
    const saved = readState(join(directory, STATE_FILE_NAME))
    const migrationBackup = JSON.parse(
      readFileSync(join(directory, LEGACY_TRADING_BACKUP_FILE_NAME), 'utf8')
    ) as typeof legacy

    expect(result.state.columnOrderVersion).toBe(WATCHLIST_COLUMN_ORDER_VERSION)
    expect(result.state.tTradingAccounts['1.600000'].tradeRecords).toHaveLength(2)
    expect(saved.tTradingAccounts['1.600000'].activeBatch).not.toHaveProperty('trades')
    expect(migrationBackup.tTradingAccounts['1.600000'].activeBatch).toHaveProperty('trades')
  })

  it('recovers a damaged configuration from the last-good backup', () => {
    const store = new StateStore(directory, makeState(), () => new Date('2026-07-31T08:00:00.000Z'))
    const backupState = makeState('备份股票')
    store.save(backupState)
    writeFileSync(join(directory, STATE_FILE_NAME), '{invalid json', 'utf8')

    const result = store.load()
    const invalidFiles = readdirSync(directory).filter((name) =>
      name.startsWith('settings.invalid-')
    )

    expect(result.state.watchlist[0].name).toBe('备份股票')
    expect(result.warning).toContain('已从最近备份恢复')
    expect(invalidFiles).toHaveLength(1)
    expect(readState(join(directory, STATE_FILE_NAME)).watchlist[0].name).toBe('备份股票')
    expect(readFileSync(join(directory, invalidFiles[0]), 'utf8')).toBe('{invalid json')
  })

  it('reports a damaged configuration when no backup is available', () => {
    writeFileSync(join(directory, STATE_FILE_NAME), '{invalid json', 'utf8')
    const store = new StateStore(directory, makeState(), () => new Date('2026-07-31T08:00:00.000Z'))

    expect(() => store.load()).toThrow('且没有可用备份')
    expect(readFileSync(join(directory, STATE_FILE_NAME), 'utf8')).toBe('{invalid json')
    expect(
      readdirSync(directory).filter((name) => name.startsWith('settings.invalid-'))
    ).toHaveLength(1)
  })

  it('replaces both state files after a successful save', () => {
    const store = new StateStore(directory, makeState())
    store.save(makeState('第一次保存'))
    store.save(makeState('第二次保存'))

    expect(readState(join(directory, STATE_FILE_NAME)).watchlist[0].name).toBe('第二次保存')
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME)).watchlist[0].name).toBe(
      '第二次保存'
    )
    expect(existsSync(join(directory, `${STATE_FILE_NAME}.tmp`))).toBe(false)
  })

  it('leaves the previous state intact when the temporary write fails', () => {
    const store = new StateStore(directory, makeState())
    store.save(makeState('原配置'))
    mkdirSync(join(directory, `${STATE_FILE_NAME}.tmp`))

    expect(() => store.save(makeState('不应写入'))).toThrow()
    expect(readState(join(directory, STATE_FILE_NAME)).watchlist[0].name).toBe('原配置')
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME)).watchlist[0].name).toBe('原配置')
  })

  it('rejects stale renderer revisions', () => {
    const store = new StateStore(directory, makeState())
    const state = makeState('当前配置')
    store.save(state)

    expect(() => store.assertRevision({ ...state, revision: 0 })).toThrow('数据已在后台更新')
    expect(() => store.assertRevision(state)).not.toThrow()
  })

  it('keeps timestamped state history snapshots', () => {
    let current = new Date('2026-08-13T00:00:00.000Z')
    const store = new StateStore(directory, makeState(), () => current)
    store.save(makeState('第一次保存'))
    current = new Date('2026-08-13T00:16:00.000Z')
    store.save(makeState('第二次保存'))

    const history = readdirSync(join(directory, STATE_HISTORY_DIRECTORY_NAME))
    expect(history).toHaveLength(1)
  })
})
