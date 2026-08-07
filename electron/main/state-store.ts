import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import {
  WATCHLIST_COLUMN_ORDER_VERSION,
  hasLegacyTTradingData,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  normalizeWatchlistGroups,
  type AppState
} from '../../src/shared/types'

export const STATE_FILE_NAME = 'settings.json'
export const LAST_GOOD_STATE_FILE_NAME = 'settings.last-good.json'
export const LEGACY_TRADING_BACKUP_FILE_NAME = 'settings.pre-unified-trades.json'

export interface StateStoreLoadResult {
  state: AppState
  warning?: string
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function invalidStateFileName(now: Date): string {
  const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return `settings.invalid-${timestamp}.json`
}

export class StateStore {
  private readonly statePath: string
  private readonly lastGoodPath: string
  private readonly legacyTradingBackupPath: string

  constructor(
    private readonly directory: string,
    private readonly defaultState: AppState,
    private readonly now: () => Date = () => new Date()
  ) {
    this.statePath = join(directory, STATE_FILE_NAME)
    this.lastGoodPath = join(directory, LAST_GOOD_STATE_FILE_NAME)
    this.legacyTradingBackupPath = join(directory, LEGACY_TRADING_BACKUP_FILE_NAME)
  }

  load(): StateStoreLoadResult {
    if (!existsSync(this.statePath)) {
      const state = structuredClone(this.defaultState)
      this.save(state)
      return { state }
    }

    let saved: AppState
    let state: AppState
    try {
      saved = this.readState(this.statePath)
      state = this.normalizeLoadedState(saved)
    } catch (reason) {
      return this.recoverFromInvalidState(reason)
    }

    const tradingAccountsMigrated =
      JSON.stringify(saved.tTradingAccounts ?? {}) !== JSON.stringify(state.tTradingAccounts)
    const watchlistGroupsMigrated =
      JSON.stringify(saved.watchlistGroups ?? []) !== JSON.stringify(state.watchlistGroups)

    if (
      hasLegacyTTradingData(saved.tTradingAccounts) &&
      !existsSync(this.legacyTradingBackupPath)
    ) {
      this.writeAtomically(this.legacyTradingBackupPath, JSON.stringify(saved, null, 2))
    }

    if (
      saved.columnOrderVersion !== WATCHLIST_COLUMN_ORDER_VERSION
      || tradingAccountsMigrated
      || watchlistGroupsMigrated
    ) {
      this.save(state)
    } else if (!existsSync(this.lastGoodPath)) {
      this.writeAtomically(this.lastGoodPath, JSON.stringify(state, null, 2))
    }

    return { state }
  }

  normalize(state: AppState): AppState {
    return {
      ...state,
      watchlist: normalizeWatchlist(state.watchlist),
      watchlistGroups: normalizeWatchlistGroups(state.watchlistGroups),
      settings: normalizeAppSettings(state.settings),
      columnOrder: normalizeWatchlistColumnOrder(state.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(state.tTradingAccounts)
    }
  }

  save(state: AppState): void {
    const content = JSON.stringify(state, null, 2)
    this.writeAtomically(this.statePath, content)
    this.writeAtomically(this.lastGoodPath, content)
  }

  private normalizeLoadedState(saved: AppState): AppState {
    return {
      watchlist: normalizeWatchlist(saved.watchlist ?? this.defaultState.watchlist),
      watchlistGroups: normalizeWatchlistGroups(saved.watchlistGroups),
      settings: normalizeAppSettings(saved.settings),
      columnOrder: migrateWatchlistColumnOrder(saved.columnOrder, saved.columnOrderVersion),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(saved.tTradingAccounts)
    }
  }

  private loadLastGoodState(): AppState | null {
    if (!existsSync(this.lastGoodPath)) return null
    try {
      return this.normalizeLoadedState(this.readState(this.lastGoodPath))
    } catch {
      return null
    }
  }

  private recoverFromInvalidState(reason: unknown): StateStoreLoadResult {
    const invalidPath = join(this.directory, invalidStateFileName(this.now()))
    copyFileSync(this.statePath, invalidPath)
    const recovered = this.loadLastGoodState()
    if (recovered) {
      this.save(recovered)
      return {
        state: recovered,
        warning: `配置文件读取失败，已从最近备份恢复。原文件已保留为 ${basename(invalidPath)}。`
      }
    }
    throw new Error(
      `配置文件读取失败，且没有可用备份。原文件已保留为 ${basename(invalidPath)}：${errorMessage(reason)}`,
      { cause: reason }
    )
  }

  private readState(path: string): AppState {
    return JSON.parse(readFileSync(path, 'utf8')) as AppState
  }

  private writeAtomically(path: string, content: string): void {
    const temporaryPath = `${path}.tmp`
    let temporaryFileWritten = false
    try {
      writeFileSync(temporaryPath, content, 'utf8')
      temporaryFileWritten = true
      renameSync(temporaryPath, path)
    } catch (reason) {
      if (temporaryFileWritten && existsSync(temporaryPath)) unlinkSync(temporaryPath)
      throw reason
    }
  }
}
