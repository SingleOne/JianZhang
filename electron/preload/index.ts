import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  StockDesktopApi,
  StockQuote,
  TaskbarLayout
} from '../../src/shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StockDesktopApi = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  searchStocks: (query) => ipcRenderer.invoke('stocks:search', query),
  refreshQuotes: () => ipcRenderer.invoke('quotes:refresh'),
  getKline: (quoteId, period, limit) => ipcRenderer.invoke('kline:get', quoteId, period, limit),
  getOrderBook: (quoteId) => ipcRenderer.invoke('order-book:get', quoteId),
  getFundsFlow: (quoteId) => ipcRenderer.invoke('funds-flow:get', quoteId),
  getSectorIndex: (quoteId) => ipcRenderer.invoke('sector-index:get', quoteId),
  refreshTradingCalendar: () => ipcRenderer.invoke('trading-calendar:refresh'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  exportConfig: (state) => ipcRenderer.invoke('config:export', state),
  importConfig: () => ipcRenderer.invoke('config:import'),
  hideWindow: () => ipcRenderer.invoke('app:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onQuotesUpdated: (callback) => subscribe<StockQuote[]>('quotes:updated', callback),
  onStateUpdated: (callback) => subscribe<AppState>('state:updated', callback),
  onTaskbarLayout: (callback) => subscribe<TaskbarLayout>('taskbar:layout', callback),
  onTaskbarHoverChanged: (callback) => subscribe<boolean>('taskbar:hover-changed', callback),
  onSelectStock: (callback) => subscribe<string>('stock:selected', callback),
  onDataError: (callback) => subscribe<string>('data:error', callback)
}

contextBridge.exposeInMainWorld('stockApi', api)
