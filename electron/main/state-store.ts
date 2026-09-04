import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  WATCHLIST_COLUMN_ORDER_VERSION,
  normalizeAppSettings,
  normalizeCorporateActionRecords,
  normalizePortfolioPerformanceAdjustments,
  normalizeStockTrackingProfiles,
  normalizeTTradingAccounts,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  normalizeWatchlistGroups,
  synchronizeWatchlistGroupMemberships,
  type AppState
} from '../../src/shared/types'
import { atomicWriteFileSync } from './file-storage'

export const STATE_FILE_NAME = 'settings.json'
export const LAST_GOOD_STATE_FILE_NAME = 'settings.last-good.json'
export const STATE_HISTORY_DIRECTORY_NAME = 'state-history'
const STATE_HISTORY_LIMIT = 20
const STATE_HISTORY_MIN_INTERVAL_MILLISECONDS = 15 * 60 * 1000

export class StateStoreRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super('磁盘配置已由另一个应用实例更新，已重新加载最新数据，请重试刚才的操作')
    this.name = 'StateStoreRevisionConflictError'
  }
}

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
  private revision = 0
  private loadedContent: string | null = null
  private lastHistoryAt = 0

  constructor(
    private readonly directory: string,
    private readonly defaultState: AppState,
    private readonly now: () => Date = () => new Date()
  ) {
    this.statePath = join(directory, STATE_FILE_NAME)
    this.lastGoodPath = join(directory, LAST_GOOD_STATE_FILE_NAME)
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
      const savedContent = readFileSync(this.statePath, 'utf8')
      saved = JSON.parse(savedContent) as AppState
      state = this.normalizeLoadedState(saved)
      this.revision = state.revision ?? 0
      this.loadedContent = savedContent
    } catch (reason) {
      return this.recoverFromInvalidState(reason)
    }

    const tradingAccountsMigrated =
      JSON.stringify(saved.tTradingAccounts ?? {}) !== JSON.stringify(state.tTradingAccounts)
    const watchlistGroupsMigrated =
      JSON.stringify(saved.watchlistGroups ?? []) !== JSON.stringify(state.watchlistGroups)
    const stockTrackingProfilesMigrated =
      JSON.stringify(saved.stockTrackingProfiles ?? {}) !==
      JSON.stringify(state.stockTrackingProfiles)
    const portfolioPerformanceAdjustmentsMigrated =
      JSON.stringify(saved.portfolioPerformanceAdjustments ?? {}) !==
      JSON.stringify(state.portfolioPerformanceAdjustments)

    if (
      saved.columnOrderVersion !== WATCHLIST_COLUMN_ORDER_VERSION ||
      tradingAccountsMigrated ||
      watchlistGroupsMigrated ||
      stockTrackingProfilesMigrated ||
      portfolioPerformanceAdjustmentsMigrated
    ) {
      this.save(state)
    } else if (!existsSync(this.lastGoodPath)) {
      this.writeAtomically(this.lastGoodPath, JSON.stringify(state, null, 2))
    }

    return { state }
  }

  assertRevision(state: AppState): void {
    if (state.revision === undefined) return
    if (state.revision !== this.revision) {
      throw new Error('数据已在后台更新，请重试刚才的操作')
    }
  }

  normalize(state: AppState): AppState {
    const watchlistGroups = normalizeWatchlistGroups(state.watchlistGroups)
    const stockTrackingProfiles = normalizeStockTrackingProfiles(state.stockTrackingProfiles)
    const watchlist = synchronizeWatchlistGroupMemberships(
      normalizeWatchlist(state.watchlist),
      watchlistGroups,
      stockTrackingProfiles
    )
    return {
      ...state,
      revision: state.revision,
      watchlist,
      watchlistGroups,
      stockTrackingProfiles,
      settings: normalizeAppSettings(state.settings),
      columnOrder: normalizeWatchlistColumnOrder(state.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(state.tTradingAccounts),
      corporateActionRecords: normalizeCorporateActionRecords(state.corporateActionRecords),
      portfolioPerformanceAdjustments: normalizePortfolioPerformanceAdjustments(
        state.portfolioPerformanceAdjustments,
        watchlist
      )
    }
  }

  save(state: AppState): void {
    const previousContent = existsSync(this.statePath) ? readFileSync(this.statePath, 'utf8') : null
    const diskRevision = previousContent ? this.readRevision(previousContent) : undefined
    const diskContentChanged =
      previousContent !== null &&
      this.loadedContent !== null &&
      previousContent !== this.loadedContent
    if (diskRevision !== undefined && (diskRevision !== this.revision || diskContentChanged)) {
      throw new StateStoreRevisionConflictError(this.revision, diskRevision)
    }
    if (previousContent && this.revision > 0) this.saveHistorySnapshot(previousContent)
    this.revision += 1
    state.revision = this.revision
    const content = JSON.stringify(state, null, 2)
    try {
      this.writeAtomically(this.statePath, content)
      this.writeAtomically(this.lastGoodPath, content)
      this.loadedContent = content
    } catch (reason) {
      this.revision -= 1
      state.revision = this.revision
      if (previousContent && readFileSync(this.statePath, 'utf8') !== previousContent) {
        this.writeAtomically(this.statePath, previousContent)
      }
      throw reason
    }
  }

  saveImported(state: AppState): AppState {
    const normalized = this.normalize({ ...state, revision: this.revision })
    this.save(normalized)
    return normalized
  }

  private normalizeLoadedState(saved: AppState): AppState {
    const watchlistGroups = normalizeWatchlistGroups(saved.watchlistGroups)
    const stockTrackingProfiles = normalizeStockTrackingProfiles(saved.stockTrackingProfiles)
    const watchlist = synchronizeWatchlistGroupMemberships(
      normalizeWatchlist(saved.watchlist ?? this.defaultState.watchlist),
      watchlistGroups,
      stockTrackingProfiles
    )
    return {
      revision:
        typeof saved.revision === 'number' && Number.isInteger(saved.revision)
          ? Math.max(0, saved.revision)
          : 0,
      watchlist,
      watchlistGroups,
      stockTrackingProfiles,
      settings: normalizeAppSettings(saved.settings),
      columnOrder: normalizeWatchlistColumnOrder(saved.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(saved.tTradingAccounts),
      corporateActionRecords: normalizeCorporateActionRecords(saved.corporateActionRecords),
      portfolioPerformanceAdjustments: normalizePortfolioPerformanceAdjustments(
        saved.portfolioPerformanceAdjustments,
        watchlist
      )
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
      this.revision = recovered.revision ?? 0
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

  private readRevision(content: string): number | undefined {
    try {
      const revision = (JSON.parse(content) as { revision?: unknown }).revision
      return typeof revision === 'number' && Number.isInteger(revision) ? Math.max(0, revision) : 0
    } catch {
      return undefined
    }
  }

  private writeAtomically(path: string, content: string): void {
    atomicWriteFileSync(path, content)
  }

  private saveHistorySnapshot(content: string): void {
    const now = this.now()
    if (now.getTime() - this.lastHistoryAt < STATE_HISTORY_MIN_INTERVAL_MILLISECONDS) return
    const historyDirectory = join(this.directory, STATE_HISTORY_DIRECTORY_NAME)
    const timestamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const historyPath = join(historyDirectory, `settings-${timestamp}-r${this.revision}.json`)
    atomicWriteFileSync(historyPath, content)
    this.lastHistoryAt = now.getTime()
    const historyFiles = readdirSync(historyDirectory)
      .filter((name) => name.startsWith('settings-') && name.endsWith('.json'))
      .sort()
    for (const name of historyFiles.slice(0, -STATE_HISTORY_LIMIT)) {
      rmSync(join(historyDirectory, name), { force: true })
    }
  }
}
