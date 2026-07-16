import {
  normalizeWatchlistColumnOrder,
  type AppSettings,
  type AppState,
  type WatchStock
} from './types'

export const JIANZHANG_CONFIG_FORMAT = 'jianzhang-config'
export const JIANZHANG_CONFIG_VERSION = 1

export interface JianzhangConfigDocument {
  format: typeof JIANZHANG_CONFIG_FORMAT
  formatVersion: typeof JIANZHANG_CONFIG_VERSION
  applicationVersion: string
  exportedAt: string
  state: AppState
  source?: {
    application: string
    version?: string
    skippedStocks?: Array<{ name: string; code: string; type: string }>
  }
}

export function createConfigDocument(state: AppState, applicationVersion: string): JianzhangConfigDocument {
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
  return typeof stock.code === 'string'
    && typeof stock.name === 'string'
    && typeof stock.quoteId === 'string'
    && typeof stock.marketLabel === 'string'
    && typeof stock.showInTaskbar === 'boolean'
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<AppSettings>
  return typeof settings.refreshSeconds === 'number'
    && typeof settings.startWithWindows === 'boolean'
    && typeof settings.minimizeToTray === 'boolean'
    && typeof settings.showTaskbarTicker === 'boolean'
    && typeof settings.taskbarPositionPercent === 'number'
}

export function parseConfigDocument(value: unknown): AppState {
  if (!value || typeof value !== 'object') throw new Error('文件不是有效的见涨配置')
  const document = value as Partial<JianzhangConfigDocument>
  if (document.format !== JIANZHANG_CONFIG_FORMAT || document.formatVersion !== JIANZHANG_CONFIG_VERSION) {
    throw new Error('配置格式或版本不受支持')
  }

  const importedState = document.state
  if (!importedState || !Array.isArray(importedState.watchlist) || !isAppSettings(importedState.settings)) {
    throw new Error('配置内容不完整')
  }
  if (!importedState.watchlist.every(isWatchStock)) throw new Error('配置中的股票信息无效')

  return {
    watchlist: importedState.watchlist,
    settings: {
      ...importedState.settings,
      refreshSeconds: Math.min(300, Math.max(3, importedState.settings.refreshSeconds)),
      taskbarPositionPercent: Math.min(100, Math.max(0, importedState.settings.taskbarPositionPercent))
    },
    columnOrder: normalizeWatchlistColumnOrder(
      Array.isArray(importedState.columnOrder) ? importedState.columnOrder : undefined
    )
  }
}
