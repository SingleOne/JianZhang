import { contextBridge, ipcRenderer } from 'electron'
import { AI_IPC } from '../shared/constants'
import type { AiApi } from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export function installAiPreload(): void {
  let ready: Promise<void> | null = null
  const invoke = (channel: string, ...args: unknown[]) =>
    (ready ??= ipcRenderer.invoke('app:optional-module:wait', 'ai')).then(() =>
      ipcRenderer.invoke(channel, ...args)
    )
  const api: AiApi = {
    getStatus: () => invoke(AI_IPC.statusGet),
    getSettings: () => invoke(AI_IPC.settingsGet),
    saveSettings: (settings) => invoke(AI_IPC.settingsSave, settings),
    setCredential: (providerId, apiKey) => invoke(AI_IPC.credentialSet, providerId, apiKey),
    clearCredential: (providerId) => invoke(AI_IPC.credentialClear, providerId),
    loginCodexAccount: () => invoke(AI_IPC.codexLogin),
    logoutCodexAccount: () => invoke(AI_IPC.codexLogout),
    testConnection: (providerId) => invoke(AI_IPC.connectionTest, providerId),
    listConversations: (query) => invoke(AI_IPC.conversationsList, query),
    getConversation: (conversationId) => invoke(AI_IPC.conversationGet, conversationId),
    createConversation: (input) => invoke(AI_IPC.conversationCreate, input),
    renameConversation: (conversationId, title) =>
      invoke(AI_IPC.conversationRename, conversationId, title),
    deleteConversation: (conversationId) => invoke(AI_IPC.conversationDelete, conversationId),
    clearConversations: () => invoke(AI_IPC.conversationsClear),
    exportConversation: (conversationId) => invoke(AI_IPC.conversationExport, conversationId),
    exportAllConversations: () => invoke(AI_IPC.conversationsExportAll),
    sendChat: (input) => invoke(AI_IPC.chatSend, input),
    cancelChat: (conversationId) => invoke(AI_IPC.chatCancel, conversationId),
    retryChat: (conversationId, messageId) => invoke(AI_IPC.chatRetry, conversationId, messageId),
    getLatestInterpretation: (quoteId) => invoke(AI_IPC.analysisLatestGet, quoteId),
    interpret: (quoteId) => invoke(AI_IPC.analysisInterpret, quoteId),
    getLatestLongTermInterpretation: (quoteId) => invoke(AI_IPC.analysisLongTermLatestGet, quoteId),
    interpretLongTerm: (quoteId) => invoke(AI_IPC.analysisLongTermInterpret, quoteId),
    onAnalysisProgress: (listener) => subscribe(AI_IPC.analysisProgress, listener),
    onChatDelta: (listener) => subscribe(AI_IPC.chatDelta, listener),
    onChatCompleted: (listener) => subscribe(AI_IPC.chatCompleted, listener),
    onChatError: (listener) => subscribe(AI_IPC.chatError, listener)
  }
  contextBridge.exposeInMainWorld('aiApi', api)
}
