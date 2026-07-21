import { contextBridge, ipcRenderer } from 'electron'
import type { AiTAdviceApi } from '../shared/types'

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
    confirmApply: (previewId) => ipcRenderer.invoke('ai-t:advice:confirm-apply', previewId)
  }
  contextBridge.exposeInMainWorld('aiTAdviceApi', api)
}
