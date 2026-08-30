import { contextBridge, ipcRenderer } from 'electron'
import { MARKET_INSIGHT_IPC } from '../shared/constants'
import type { MarketInsightApi } from './types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export function installMarketInsightPreload(): void {
  let ready: Promise<void> | null = null
  const invoke = (channel: string, ...args: unknown[]) =>
    (ready ??= ipcRenderer.invoke('app:optional-module:wait', 'marketInsight')).then(() =>
      ipcRenderer.invoke(channel, ...args)
    )
  const api: MarketInsightApi = {
    getStatus: () => invoke(MARKET_INSIGHT_IPC.statusGet),
    getSettings: () => invoke(MARKET_INSIGHT_IPC.settingsGet),
    saveSettings: (settings) => invoke(MARKET_INSIGHT_IPC.settingsSave, settings),
    getSnapshot: (quoteId) => invoke(MARKET_INSIGHT_IPC.snapshotGet, quoteId),
    refresh: (quoteId) => invoke(MARKET_INSIGHT_IPC.refresh, quoteId),
    listEvents: (quoteId) => invoke(MARKET_INSIGHT_IPC.eventsList, quoteId),
    acknowledgeEvent: (eventId) => invoke(MARKET_INSIGHT_IPC.eventAcknowledge, eventId),
    clearExpiredEvents: (quoteId) => invoke(MARKET_INSIGHT_IPC.eventsClearExpired, quoteId),
    openSource: (url) => invoke(MARKET_INSIGHT_IPC.sourceOpen, url),
    onUpdated: (listener) => subscribe<string>(MARKET_INSIGHT_IPC.updated, listener)
  }
  contextBridge.exposeInMainWorld('marketInsightApi', api)
}
