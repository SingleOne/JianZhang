import { contextBridge, ipcRenderer } from 'electron'
import type { AiTAdviceApi, AiTAdviceProgressEvent } from '../shared/types'

const PROGRESS_CHANNEL = 'ai-t:advice:progress'

export function installAiTAdvicePreload(): void {
  const api: AiTAdviceApi = {
    getStatus: () => ipcRenderer.invoke('ai-t:status:get'),
    getSettings: () => ipcRenderer.invoke('ai-t:settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('ai-t:settings:update', settings),
    generate: (quoteId) => ipcRenderer.invoke('ai-t:advice:generate', quoteId),
    cancel: (quoteId) => ipcRenderer.invoke('ai-t:advice:cancel', quoteId),
    listHistory: (quoteId) => ipcRenderer.invoke('ai-t:advice:history', quoteId),
    dismiss: (adviceId) => ipcRenderer.invoke('ai-t:advice:dismiss', adviceId),
    previewApply: (adviceId) => ipcRenderer.invoke('ai-t:advice:preview-apply', adviceId),
    confirmApply: (previewId) => ipcRenderer.invoke('ai-t:advice:confirm-apply', previewId),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AiTAdviceProgressEvent): void => listener(payload)
      ipcRenderer.on(PROGRESS_CHANNEL, handler)
      return () => ipcRenderer.removeListener(PROGRESS_CHANNEL, handler)
    }
  }
  contextBridge.exposeInMainWorld('aiTAdviceApi', api)
}
