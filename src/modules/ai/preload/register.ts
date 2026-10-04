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
    listModels: (providerId) => invoke(AI_IPC.modelsList, providerId),
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
    prepareTradeImport: (input) => invoke(AI_IPC.tradeImportPrepare, input),
    commitTradeImport: (input) => invoke(AI_IPC.tradeImportCommit, input),
    openSource: (url) => invoke(AI_IPC.sourceOpen, url),
    getLatestInterpretation: (quoteId) => invoke(AI_IPC.analysisLatestGet, quoteId),
    interpret: (quoteId) => invoke(AI_IPC.analysisInterpret, quoteId),
    getLatestLongTermInterpretation: (quoteId) => invoke(AI_IPC.analysisLongTermLatestGet, quoteId),
    interpretLongTerm: (quoteId) => invoke(AI_IPC.analysisLongTermInterpret, quoteId),
    onAnalysisProgress: (listener) => subscribe(AI_IPC.analysisProgress, listener),
    onChatDelta: (listener) => subscribe(AI_IPC.chatDelta, listener),
    onChatCompleted: (listener) => subscribe(AI_IPC.chatCompleted, listener),
    onChatError: (listener) => subscribe(AI_IPC.chatError, listener),
    getMemoryStatus: () => invoke(AI_IPC.memoryStatus),
    connectMemory: (name, url, token) => invoke(AI_IPC.memoryConnect, name, url, token),
    selectMemory: (profileId) => invoke(AI_IPC.memorySelect, profileId),
    enableConversationMemory: (conversationId) =>
      invoke(AI_IPC.memoryConversationEnable, conversationId),
    setConversationMemoryHistory: (conversationId, visible) =>
      invoke(AI_IPC.memoryConversationHistory, conversationId, visible),
    setConversationMemoryLibraries: (conversationId, libraryIds) =>
      invoke(AI_IPC.memoryConversationLibraries, conversationId, libraryIds),
    listMemoryFacts: (query) => invoke(AI_IPC.memoryFactsList, query),
    getMemoryMaintenanceStatus: (conversationId) =>
      invoke(AI_IPC.memoryMaintenanceStatus, conversationId),
    setMemoryMaintenanceEnabled: (enabled) => invoke(AI_IPC.memoryMaintenanceEnabled, enabled),
    listMemoryCandidates: () => invoke(AI_IPC.memoryCandidatesList),
    decideMemoryCandidate: (id, decision, expectedRevision, expectedFactRevision) =>
      invoke(AI_IPC.memoryCandidateDecide, id, decision, expectedRevision, expectedFactRevision),
    retryMemoryMaintenance: (conversationId) =>
      invoke(AI_IPC.memoryMaintenanceRetry, conversationId),
    saveMemoryFact: (input) => invoke(AI_IPC.memoryFactSave, input),
    deleteMemoryFact: (id, revision) => invoke(AI_IPC.memoryFactDelete, id, revision),
    searchMemory: (query) => invoke(AI_IPC.memorySearch, query),
    readMemorySource: (kind, sourceId) => invoke(AI_IPC.memorySourceRead, kind, sourceId),
    readChatMemorySource: (conversationId, messageId, citationId) =>
      invoke(AI_IPC.memoryChatSourceRead, conversationId, messageId, citationId),
    onMemorySourcesChanged: (listener) => subscribe(AI_IPC.memorySourcesChanged, listener),
    listMemoryLibraries: () => invoke(AI_IPC.memoryLibrariesList),
    createMemoryLibrary: (name) => invoke(AI_IPC.memoryLibraryCreate, name),
    renameMemoryLibrary: (id, name, revision) =>
      invoke(AI_IPC.memoryLibraryRename, id, name, revision),
    deleteMemoryLibrary: (id, revision) => invoke(AI_IPC.memoryLibraryDelete, id, revision),
    listMemoryDocuments: (libraryId) => invoke(AI_IPC.memoryDocumentsList, libraryId),
    uploadMemoryDocument: (name, bytes, libraryId, existing) =>
      invoke(AI_IPC.memoryDocumentUpload, name, bytes, libraryId, existing),
    publishMemoryDocumentKeyword: (documentId, versionId, revision) =>
      invoke(AI_IPC.memoryDocumentPublishKeyword, documentId, versionId, revision),
    deleteMemoryDocument: (id, revision) => invoke(AI_IPC.memoryDocumentDelete, id, revision),
    listMemoryDocumentJobs: (documentId) => invoke(AI_IPC.memoryDocumentJobsList, documentId),
    getMemoryDocumentJob: (jobId) => invoke(AI_IPC.memoryDocumentJobGet, jobId),
    createMemoryDocumentJob: (documentId, versionId, revision, kind, options) =>
      invoke(AI_IPC.memoryDocumentJobCreate, documentId, versionId, revision, kind, options),
    retryMemoryDocumentJob: (job) => invoke(AI_IPC.memoryDocumentJobRetry, job),
    cancelMemoryDocumentJob: (job) => invoke(AI_IPC.memoryDocumentJobCancel, job),
    publishMemoryDocumentJob: (job, options) =>
      invoke(AI_IPC.memoryDocumentJobPublish, job, options)
  }
  contextBridge.exposeInMainWorld('aiApi', api)
}
