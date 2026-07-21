import { contextBridge, ipcRenderer } from 'electron'
import type { AiTAdviceApi } from '../shared/types'

export function installAiTAdvicePreload(): void {
  const api: AiTAdviceApi = {
    getStatus: () => ipcRenderer.invoke('ai-t:status:get')
  }
  contextBridge.exposeInMainWorld('aiTAdviceApi', api)
}
