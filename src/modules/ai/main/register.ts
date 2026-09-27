import { app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { AI_IPC } from '../shared/constants'
import type {
  AiApiKeyProviderId,
  AiModuleDependencies,
  AiSettings,
  AiStructuredTaskRequest,
  AiStructuredTaskResult,
  AiTradeImportCommitInput,
  AiTradeImportPrepareInput
} from '../shared/types'
import { AiService } from './service'
import { AiStorage } from './storage'
import { assertOfficialStockSourceUrl } from './official-source'

export { applyTradeImportToState } from './trade-import/commit'

export interface AiRuntime {
  dispose: () => void
  runStructuredTask: (
    request: AiStructuredTaskRequest,
    signal: AbortSignal
  ) => Promise<AiStructuredTaskResult>
}

export function installAi(dependencies: AiModuleDependencies): AiRuntime {
  const service = new AiService(
    new AiStorage(join(app.getPath('userData'), 'modules', 'ai')),
    dependencies,
    (webContents, channel, payload) => webContents.send(channel, payload)
  )
  ipcMain.handle(AI_IPC.statusGet, () => service.getStatus())
  ipcMain.handle(AI_IPC.settingsGet, () => service.getSettings())
  ipcMain.handle(AI_IPC.settingsSave, (_event, settings: AiSettings) =>
    service.saveSettings(settings)
  )
  ipcMain.handle(AI_IPC.credentialSet, (_event, providerId: AiApiKeyProviderId, apiKey: string) =>
    service.setCredential(providerId, apiKey)
  )
  ipcMain.handle(AI_IPC.credentialClear, (_event, providerId: AiApiKeyProviderId) =>
    service.clearCredential(providerId)
  )
  ipcMain.handle(AI_IPC.modelsList, (_event, providerId) => service.listModels(providerId))
  ipcMain.handle(AI_IPC.connectionTest, (_event, providerId) => service.testConnection(providerId))
  ipcMain.handle(AI_IPC.conversationsList, (_event, query?: string) =>
    service.listConversations(query)
  )
  ipcMain.handle(AI_IPC.conversationGet, (_event, conversationId: string) =>
    service.getConversation(conversationId)
  )
  ipcMain.handle(AI_IPC.conversationCreate, (_event, input) => service.createConversation(input))
  ipcMain.handle(AI_IPC.conversationRename, (_event, conversationId: string, title: string) =>
    service.renameConversation(conversationId, title)
  )
  ipcMain.handle(AI_IPC.conversationDelete, (_event, conversationId: string) =>
    service.deleteConversation(conversationId)
  )
  ipcMain.handle(AI_IPC.conversationsClear, () => service.clearConversations())
  ipcMain.handle(AI_IPC.memoryStatus, () => service.getMemoryStatus())
  ipcMain.handle(AI_IPC.memoryConnect, (_event, name: string, url: string, token: string) =>
    service.connectMemory(name, url, token)
  )
  ipcMain.handle(AI_IPC.memorySelect, (_event, profileId: string | null) =>
    service.selectMemory(profileId)
  )
  ipcMain.handle(AI_IPC.memoryConversationEnable, (_event, conversationId: string) =>
    service.enableConversationMemory(conversationId)
  )
  ipcMain.handle(
    AI_IPC.memoryConversationHistory,
    (_event, conversationId: string, visible: boolean) =>
      service.setConversationMemoryHistory(conversationId, visible)
  )
  ipcMain.handle(AI_IPC.memoryFactsList, (_event, query?: string) => service.listMemoryFacts(query))
  ipcMain.handle(AI_IPC.memoryFactSave, (_event, input) => service.saveMemoryFact(input))
  ipcMain.handle(AI_IPC.memoryFactDelete, (_event, id: string, revision: number) =>
    service.deleteMemoryFact(id, revision)
  )
  ipcMain.handle(AI_IPC.memorySearch, (_event, query: string) => service.searchMemory(query))
  ipcMain.handle(AI_IPC.conversationExport, (_event, conversationId: string) =>
    service.exportConversation(conversationId)
  )
  ipcMain.handle(AI_IPC.conversationsExportAll, () => service.exportAllConversations())
  ipcMain.handle(AI_IPC.chatSend, (event, input) => service.sendChat(event.sender, input))
  ipcMain.handle(AI_IPC.chatCancel, (_event, conversationId: string) =>
    service.cancelChat(conversationId)
  )
  ipcMain.handle(AI_IPC.chatRetry, (event, conversationId: string, messageId: string) =>
    service.retryChat(event.sender, conversationId, messageId)
  )
  ipcMain.handle(AI_IPC.tradeImportPrepare, (_event, input: AiTradeImportPrepareInput) =>
    service.prepareTradeImport(input)
  )
  ipcMain.handle(AI_IPC.tradeImportCommit, (_event, input: AiTradeImportCommitInput) =>
    service.commitTradeImport(input)
  )
  ipcMain.handle(AI_IPC.sourceOpen, (_event, url: string) => {
    assertOfficialStockSourceUrl(url)
    return shell.openExternal(url)
  })
  ipcMain.handle(AI_IPC.analysisLatestGet, (_event, quoteId: string) =>
    service.getLatestInterpretation(quoteId)
  )
  ipcMain.handle(AI_IPC.analysisInterpret, (event, quoteId: string) =>
    service.interpret(quoteId, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(AI_IPC.analysisProgress, progress)
    })
  )
  ipcMain.handle(AI_IPC.analysisLongTermLatestGet, (_event, quoteId: string) =>
    service.getLatestLongTermInterpretation(quoteId)
  )
  ipcMain.handle(AI_IPC.analysisLongTermInterpret, (event, quoteId: string) =>
    service.interpretLongTerm(quoteId, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(AI_IPC.analysisProgress, progress)
    })
  )

  return {
    runStructuredTask: (request, signal) => service.runStructuredTask(request, signal),
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(AI_IPC)) {
        if (
          !channel.startsWith('ai:chat:') ||
          channel === AI_IPC.chatSend ||
          channel === AI_IPC.chatCancel ||
          channel === AI_IPC.chatRetry
        ) {
          ipcMain.removeHandler(channel)
        }
      }
    }
  }
}
