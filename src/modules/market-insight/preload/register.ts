import { contextBridge, ipcRenderer } from 'electron'
import { MARKET_INSIGHT_IPC } from '../shared/constants'
import type { MarketInsightApi } from './types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export function installMarketInsightPreload(): void {
  const api: MarketInsightApi = {
    getStatus: () => ipcRenderer.invoke(MARKET_INSIGHT_IPC.statusGet),
    getSettings: () => ipcRenderer.invoke(MARKET_INSIGHT_IPC.settingsGet),
    saveSettings: (settings) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.settingsSave, settings),
    getSnapshot: (quoteId) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.snapshotGet, quoteId),
    refresh: (quoteId) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.refresh, quoteId),
    listEvents: (quoteId) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.eventsList, quoteId),
    acknowledgeEvent: (eventId) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.eventAcknowledge, eventId),
    clearExpiredEvents: (quoteId) =>
      ipcRenderer.invoke(MARKET_INSIGHT_IPC.eventsClearExpired, quoteId),
    openSource: (url) => ipcRenderer.invoke(MARKET_INSIGHT_IPC.sourceOpen, url),
    onUpdated: (listener) => subscribe<string>(MARKET_INSIGHT_IPC.updated, listener)
  }
  contextBridge.exposeInMainWorld('marketInsightApi', api)
}
