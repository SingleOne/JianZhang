import {
  WATCHLIST_COLUMN_ORDER_VERSION,
  WATCHLIST_PERFORMANCE_BASELINE_VERSION,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeCorporateActionRecords,
  normalizePortfolioPerformanceAdjustments,
  normalizeStockTrackingProfiles,
  normalizeTradingAccountsForWatchlist,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  synchronizeTrackingGroupMembership,
  type AppSettings,
  type AppState,
  type WatchStock
} from './types'

export const JIANZHANG_CONFIG_FORMAT = 'jianzhang-config'
export const JIANZHANG_CONFIG_VERSION = 3

export interface JianzhangConfigDocument {
  format: typeof JIANZHANG_CONFIG_FORMAT
  formatVersion: number
  applicationVersion: string
  exportedAt: string
  state: AppState
  source?: {
    application: string
    version?: string
    skippedStocks?: Array<{ name: string; code: string; type: string }>
  }
}

export function createConfigDocument(
  state: AppState,
  applicationVersion: string
): JianzhangConfigDocument {
  return {
    format: JIANZHANG_CONFIG_FORMAT,
    formatVersion: JIANZHANG_CONFIG_VERSION,
    applicationVersion,
    exportedAt: new Date().toISOString(),
    state
  }
}

function isWatchStock(value: unknown): value is WatchStock {
  if (!value || typeof value !== 'object') return false
  const stock = value as Partial<WatchStock>
  return (
    typeof stock.code === 'string' &&
    typeof stock.name === 'string' &&
    typeof stock.quoteId === 'string' &&
    typeof stock.marketLabel === 'string' &&
    typeof stock.showInTaskbar === 'boolean'
  )
}

function isCompatibleAppSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<AppSettings> & { refreshSeconds?: number }
  const hasRefreshSettings =
    (typeof settings.priorityRefreshSeconds === 'number' &&
      typeof settings.regularRefreshSeconds === 'number') ||
    typeof settings.refreshSeconds === 'number'
  return (
    hasRefreshSettings &&
    typeof settings.startWithWindows === 'boolean' &&
    typeof settings.minimizeToTray === 'boolean' &&
    typeof settings.showTaskbarTicker === 'boolean' &&
    typeof settings.taskbarPositionPercent === 'number'
  )
}

export function parseConfigDocument(value: unknown): AppState {
  if (!value || typeof value !== 'object') throw new Error('文件不是有效的见涨配置')
  const document = value as Partial<JianzhangConfigDocument>
  if (
    document.format !== JIANZHANG_CONFIG_FORMAT ||
    ![1, 2, JIANZHANG_CONFIG_VERSION].includes(document.formatVersion ?? 0)
  ) {
    throw new Error('配置格式或版本不受支持')
  }

  return parseImportedAppState(document.state)
}

export function parseImportedAppState(value: unknown): AppState {
  const importedState = value as Partial<AppState> | undefined
  if (
    !importedState ||
    !Array.isArray(importedState.watchlist) ||
    !isCompatibleAppSettings(importedState.settings)
  ) {
    throw new Error('配置内容不完整')
  }
  if (!importedState.watchlist.every(isWatchStock)) throw new Error('配置中的股票信息无效')

  const watchlistGroups = normalizeWatchlistGroups(importedState.watchlistGroups)
  const stockTrackingProfiles = normalizeStockTrackingProfiles(importedState.stockTrackingProfiles)
  const watchlist = synchronizeTrackingGroupMembership(
    normalizeWatchlist(importedState.watchlist),
    watchlistGroups,
    stockTrackingProfiles
  )
  return {
    revision: undefined,
    watchlist,
    watchlistGroups,
    stockTrackingProfiles,
    settings: normalizeAppSettings(importedState.settings),
    columnOrder: migrateWatchlistColumnOrder(
      Array.isArray(importedState.columnOrder) ? importedState.columnOrder : undefined,
      importedState.columnOrderVersion
    ),
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: normalizeTradingAccountsForWatchlist(
      watchlist,
      importedState.tTradingAccounts
    ),
    corporateActionRecords: normalizeCorporateActionRecords(importedState.corporateActionRecords),
    portfolioPerformanceAdjustments: normalizePortfolioPerformanceAdjustments(
      importedState.portfolioPerformanceAdjustments,
      watchlist
    ),
    ...(importedState.performanceBaselineMigrationVersion === WATCHLIST_PERFORMANCE_BASELINE_VERSION
      ? { performanceBaselineMigrationVersion: WATCHLIST_PERFORMANCE_BASELINE_VERSION }
      : {})
  }
}
