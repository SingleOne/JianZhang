import { contextBridge, ipcRenderer } from 'electron'
import type { AiTAdviceApi, AiTAdviceProgressEvent } from '../shared/types'

const PROGRESS_CHANNEL = 'ai-t:advice:progress'

export function installAiTAdvicePreload(): void {
  let ready: Promise<void> | null = null
  const invoke = (channel: string, ...args: unknown[]) =>
    (ready ??= ipcRenderer.invoke('app:optional-module:wait', 'aiTAdvice')).then(() =>
      ipcRenderer.invoke(channel, ...args)
    )
  const api: AiTAdviceApi = {
    getStatus: () => invoke('ai-t:status:get'),
    getSettings: () => invoke('ai-t:settings:get'),
    saveSettings: (settings) => invoke('ai-t:settings:update', settings),
    generate: (quoteId) => invoke('ai-t:advice:generate', quoteId),
    cancel: (quoteId) => invoke('ai-t:advice:cancel', quoteId),
    listHistory: (quoteId) => invoke('ai-t:advice:history', quoteId),
    dismiss: (adviceId) => invoke('ai-t:advice:dismiss', adviceId),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AiTAdviceProgressEvent): void =>
        listener(payload)
      ipcRenderer.on(PROGRESS_CHANNEL, handler)
      return () => ipcRenderer.removeListener(PROGRESS_CHANNEL, handler)
    }
  }
  contextBridge.exposeInMainWorld('aiTAdviceApi', api)
}
