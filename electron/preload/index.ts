import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, StockDesktopApi, StockQuote } from '../../src/shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StockDesktopApi = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  searchStocks: (query) => ipcRenderer.invoke('stocks:search', query),
  refreshQuotes: () => ipcRenderer.invoke('quotes:refresh'),
  getKline: (quoteId) => ipcRenderer.invoke('kline:get', quoteId),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  hideWindow: () => ipcRenderer.invoke('app:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onQuotesUpdated: (callback) => subscribe<StockQuote[]>('quotes:updated', callback),
  onStateUpdated: (callback) => subscribe<AppState>('state:updated', callback),
  onSelectStock: (callback) => subscribe<string>('stock:selected', callback),
  onDataError: (callback) => subscribe<string>('data:error', callback)
}

contextBridge.exposeInMainWorld('stockApi', api)
