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
  appendPortfolioLedgerEntries,
  withLedgerTradeRecords,
  type AppState,
  type StockPosition,
  type TTrade,
  type TTradeRecord,
  type TTradingAccount
} from '../../src/shared/types'
import { calculatePortfolioLedgerPosition } from '../../src/lib/portfolio-ledger'
import {
  LAST_GOOD_STATE_FILE_NAME,
  LEGACY_TRADING_BACKUP_FILE_NAME,
  STATE_FILE_NAME,
  STATE_HISTORY_DIRECTORY_NAME,
  StateStore,
  StateStoreRevisionConflictError
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
    tTradingAccounts: {},
    corporateActionRecords: {}
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

function portfolioTrade(
  id: string,
  tradedAt: string,
  price: number,
  quantity: number,
  origin: TTradeRecord['origin'] = 'execution'
): TTradeRecord {
  return {
    id,
    side: 'buy',
    purpose: 'base',
    tradedAt,
    price,
    quantity,
    fees: EMPTY_FEES,
    market: 'CN',
    currency: 'CNY',
    marketDate: tradedAt.slice(0, 10),
    exchangeRate: 1,
    origin,
    note: origin === 'opening-balance' ? '初始持仓' : ''
  }
}

function portfolioAccount(
  quoteId: string,
  code: string,
  name: string,
  records: readonly TTradeRecord[]
): TTradingAccount {
  return withLedgerTradeRecords(
    {
      quoteId,
      code,
      name,
      market: 'CN',
      currency: 'CNY',
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    },
    records
  )
}

function knownCorruptedPortfolioState(): AppState {
  const state = makeState()
  const changanPosition: StockPosition = {
    quantity: 1_000,
    cost: 7.4287,
    openedToday: false,
    openedOn: '2026-07-16',
    currency: 'CNY',
    costExchangeRate: 1,
    costExchangeRateDate: '2026-07-16'
  }
  const crecPosition: StockPosition = {
    quantity: 100,
    cost: -0.9383,
    openedToday: false,
    openedOn: '2026-07-01',
    currency: 'CNY',
    costExchangeRate: 1,
    costExchangeRateDate: '2026-07-01'
  }
  state.watchlist.push(
    {
      code: '000625',
      name: '长安汽车',
      quoteId: '0.000625',
      marketLabel: '深A',
      showInTaskbar: true,
      isPriority: true,
      showRadarSignals: true,
      position: changanPosition
    },
    {
      code: '601390',
      name: '中国中铁',
      quoteId: '1.601390',
      marketLabel: '沪A',
      showInTaskbar: true,
      isPriority: true,
      showRadarSignals: true,
      position: crecPosition
    }
  )

  const changanAccount = portfolioAccount('0.000625', '000625', '长安汽车', [
    portfolioTrade('changan-real-trade', '2026-07-16T09:30', 7.1934, 500),
    portfolioTrade('opening-balance:0.000625', '2026-07-16T00:00', 7.8245, 500, 'opening-balance')
  ])
  const crecAccount = appendPortfolioLedgerEntries(
    portfolioAccount('1.601390', '601390', '中国中铁', [
      portfolioTrade('crec-real-trade', '2026-07-01T09:30', 4.347_195_681_341_718, 100),
      portfolioTrade(
        'opening-balance:1.601390',
        '2026-07-01T00:00',
        -0.9383,
        100,
        'opening-balance'
      )
    ]),
    [
      {
        id: 'position-adjustment:ac1c7447-57b4-4724-9d5d-7f2932f14396',
        accountId: '1.601390',
        quoteId: '1.601390',
        occurredAt: '2026-08-30T21:56:57.908',
        marketDate: '2026-08-30',
        recordedAt: '2026-08-30T13:56:57.908Z',
        source: 'manual',
        currency: 'CNY',
        exchangeRate: 1,
        exchangeRateDate: '2026-07-01',
        note: '修改持仓',
        kind: 'positionAdjustment',
        quantityBefore: 200,
        quantityAfter: 100,
        costBefore: 4.348_537_067_646_157,
        costAfter: -0.9383,
        openedOnBefore: '2026-07-01',
        openedOnAfter: '2026-07-01'
      }
    ]
  )
  state.tTradingAccounts = {
    '0.000625': changanAccount,
    '1.601390': crecAccount
  }
  state.portfolioPerformanceAdjustments = {
    '1.600000': 62.94,
    '0.000625': 362.25,
    '1.601390': -1_049.79
  }
  return state
}

function knownCleanedPortfolioState(): AppState {
  const state = knownCorruptedPortfolioState()
  state.watchlist = state.watchlist.map((stock) =>
    stock.quoteId === '0.000625'
      ? {
          ...stock,
          position: {
            quantity: 500,
            cost: 7.8245,
            openedToday: false,
            openedOn: '2026-07-16',
            currency: 'CNY',
            costExchangeRate: 1,
            costExchangeRateDate: '2026-07-16'
          }
        }
      : stock
  )
  state.tTradingAccounts['0.000625'] = portfolioAccount('0.000625', '000625', '长安汽车', [
    portfolioTrade('changan-real-trade', '2026-07-16T09:30', 7.8245, 500)
  ])
  state.tTradingAccounts['1.601390'] = {
    ...state.tTradingAccounts['1.601390'],
    tradeRecords: state.tTradingAccounts['1.601390'].tradeRecords.filter(
      (record) => record.id !== 'opening-balance:1.601390'
    ),
    ledger: {
      ...state.tTradingAccounts['1.601390'].ledger,
      entries: state.tTradingAccounts['1.601390'].ledger.entries.filter(
        (entry) => entry.id !== 'trade:opening-balance:1.601390'
      )
    }
  }
  state.portfolioPerformanceAdjustments = {}
  return state
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

  it('rejects a stale instance before it overwrites a newer disk revision', () => {
    const firstStore = new StateStore(directory, makeState())
    firstStore.load()
    const staleStore = new StateStore(directory, makeState())
    const staleState = staleStore.load().state
    const firstState = firstStore.load().state

    firstStore.save({ ...firstState, watchlist: makeState('磁盘新配置').watchlist })

    expect(() =>
      staleStore.save({ ...staleState, watchlist: makeState('旧实例配置').watchlist })
    ).toThrow(StateStoreRevisionConflictError)
    expect(readState(join(directory, STATE_FILE_NAME)).watchlist[0].name).toBe('磁盘新配置')
    expect(staleStore.load().state.watchlist[0].name).toBe('磁盘新配置')
  })

  it('rejects changed disk content even when the revision is unchanged', () => {
    const store = new StateStore(directory, makeState())
    const staleState = store.load().state
    const sameRevisionDiskState = {
      ...staleState,
      watchlist: makeState('同修订号新配置').watchlist
    }
    writeFileSync(
      join(directory, STATE_FILE_NAME),
      JSON.stringify(sameRevisionDiskState, null, 2),
      'utf8'
    )

    expect(() =>
      store.save({ ...staleState, watchlist: makeState('旧实例配置').watchlist })
    ).toThrow(StateStoreRevisionConflictError)
    expect(readState(join(directory, STATE_FILE_NAME)).watchlist[0].name).toBe('同修订号新配置')
    expect(store.load().state.watchlist[0].name).toBe('同修订号新配置')
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

  it('repairs the known stale portfolio data and persists the repaired state', () => {
    const corrupted = knownCorruptedPortfolioState()
    writeFileSync(join(directory, STATE_FILE_NAME), JSON.stringify(corrupted, null, 2), 'utf8')

    const result = new StateStore(
      directory,
      makeState(),
      () => new Date('2026-08-31T12:00:00.000Z')
    ).load()
    const changanAccount = result.state.tTradingAccounts['0.000625']
    const crecAccount = result.state.tTradingAccounts['1.601390']
    const changanPosition = calculatePortfolioLedgerPosition(changanAccount, 'CN', 'CNY').position

    expect(result.state.portfolioPerformanceAdjustments).toEqual({})
    expect(result.state.watchlist.find((stock) => stock.quoteId === '0.000625')?.position).toEqual({
      quantity: 500,
      cost: 7.8245,
      openedToday: false,
      openedOn: '2026-07-16',
      currency: 'CNY',
      costExchangeRate: 1,
      costExchangeRateDate: '2026-07-16'
    })
    expect(changanAccount.tradeRecords.map((record) => record.id)).toEqual(['changan-real-trade'])
    expect(crecAccount.tradeRecords.map((record) => record.id)).toEqual(['crec-real-trade'])
    expect(changanAccount.ledger.entries.some((entry) => entry.kind === 'positionAdjustment')).toBe(
      true
    )
    expect(
      crecAccount.ledger.entries.filter((entry) => entry.kind === 'positionAdjustment')
    ).toEqual([
      expect.objectContaining({
        id: 'position-adjustment:ac1c7447-57b4-4724-9d5d-7f2932f14396',
        resetsPerformance: true
      })
    ])
    expect(changanPosition).toMatchObject({
      quantity: 500,
      cost: 7.8245,
      openedOn: '2026-07-16'
    })
    expect(readState(join(directory, STATE_FILE_NAME))).toEqual(result.state)
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME))).toEqual(result.state)
  })

  it('marks the existing CREC calibration as a performance reset after stale data was cleaned', () => {
    const state = knownCleanedPortfolioState()
    writeFileSync(join(directory, STATE_FILE_NAME), JSON.stringify(state, null, 2), 'utf8')

    const result = new StateStore(directory, makeState()).load()
    const adjustment = result.state.tTradingAccounts['1.601390'].ledger.entries.find(
      (entry) => entry.id === 'position-adjustment:ac1c7447-57b4-4724-9d5d-7f2932f14396'
    )

    expect(adjustment).toMatchObject({
      kind: 'positionAdjustment',
      resetsPerformance: true
    })
    expect(readState(join(directory, STATE_FILE_NAME))).toEqual(result.state)
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME))).toEqual(result.state)
  })

  it('upgrades the CREC performance reset when recovering an old last-good state', () => {
    const state = knownCleanedPortfolioState()
    writeFileSync(join(directory, STATE_FILE_NAME), '{invalid json', 'utf8')
    writeFileSync(
      join(directory, LAST_GOOD_STATE_FILE_NAME),
      JSON.stringify(state, null, 2),
      'utf8'
    )

    const result = new StateStore(directory, makeState()).load()
    const adjustment = result.state.tTradingAccounts['1.601390'].ledger.entries.find(
      (entry) => entry.id === 'position-adjustment:ac1c7447-57b4-4724-9d5d-7f2932f14396'
    )

    expect(result.warning).toContain('已从最近备份恢复')
    expect(adjustment).toMatchObject({ resetsPerformance: true })
    expect(readState(join(directory, STATE_FILE_NAME))).toEqual(result.state)
    expect(readState(join(directory, LAST_GOOD_STATE_FILE_NAME))).toEqual(result.state)
  })

  it('does not repair a portfolio state that only partially matches the known corruption', () => {
    const state = knownCorruptedPortfolioState()
    state.portfolioPerformanceAdjustments = {
      ...state.portfolioPerformanceAdjustments,
      '0.000625': 362.24
    }
    writeFileSync(join(directory, STATE_FILE_NAME), JSON.stringify(state, null, 2), 'utf8')

    const result = new StateStore(directory, makeState()).load()

    expect(result.state.portfolioPerformanceAdjustments?.['0.000625']).toBe(362.24)
    expect(
      result.state.tTradingAccounts['0.000625'].tradeRecords.some(
        (record) => record.id === 'opening-balance:0.000625'
      )
    ).toBe(true)
  })
})
