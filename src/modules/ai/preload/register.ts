import { contextBridge, ipcRenderer } from 'electron'
import { AI_IPC } from '../shared/constants'
import type { AiApi } from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export function installAiPreload(): void {
  const api: AiApi = {
    getStatus: () => ipcRenderer.invoke(AI_IPC.statusGet),
    getSettings: () => ipcRenderer.invoke(AI_IPC.settingsGet),
    saveSettings: (settings) => ipcRenderer.invoke(AI_IPC.settingsSave, settings),
    setCredential: (providerId, apiKey) => ipcRenderer.invoke(AI_IPC.credentialSet, providerId, apiKey),
    clearCredential: (providerId) => ipcRenderer.invoke(AI_IPC.credentialClear, providerId),
    loginCodexAccount: () => ipcRenderer.invoke(AI_IPC.codexLogin),
    logoutCodexAccount: () => ipcRenderer.invoke(AI_IPC.codexLogout),
    testConnection: (providerId) => ipcRenderer.invoke(AI_IPC.connectionTest, providerId),
    listConversations: (query) => ipcRenderer.invoke(AI_IPC.conversationsList, query),
    getConversation: (conversationId) => ipcRenderer.invoke(AI_IPC.conversationGet, conversationId),
    createConversation: (input) => ipcRenderer.invoke(AI_IPC.conversationCreate, input),
    renameConversation: (conversationId, title) => ipcRenderer.invoke(AI_IPC.conversationRename, conversationId, title),
    deleteConversation: (conversationId) => ipcRenderer.invoke(AI_IPC.conversationDelete, conversationId),
    clearConversations: () => ipcRenderer.invoke(AI_IPC.conversationsClear),
    exportConversation: (conversationId) => ipcRenderer.invoke(AI_IPC.conversationExport, conversationId),
    exportAllConversations: () => ipcRenderer.invoke(AI_IPC.conversationsExportAll),
    sendChat: (input) => ipcRenderer.invoke(AI_IPC.chatSend, input),
    cancelChat: (conversationId) => ipcRenderer.invoke(AI_IPC.chatCancel, conversationId),
    retryChat: (conversationId, messageId) => ipcRenderer.invoke(AI_IPC.chatRetry, conversationId, messageId),
    interpret: (quoteId) => ipcRenderer.invoke(AI_IPC.analysisInterpret, quoteId),
    onChatDelta: (listener) => subscribe(AI_IPC.chatDelta, listener),
    onChatCompleted: (listener) => subscribe(AI_IPC.chatCompleted, listener),
    onChatError: (listener) => subscribe(AI_IPC.chatError, listener)
  }
  contextBridge.exposeInMainWorld('aiApi', api)
}
