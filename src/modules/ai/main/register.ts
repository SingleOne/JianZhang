import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { AI_IPC } from '../shared/constants'
import type { AiModuleDependencies, AiSettings } from '../shared/types'
import { AiService } from './service'
import { AiStorage } from './storage'

export interface AiRuntime {
  dispose: () => void
}

export function installAi(dependencies: AiModuleDependencies): AiRuntime {
  const service = new AiService(
    new AiStorage(join(app.getPath('userData'), 'modules', 'ai')),
    dependencies,
    (webContents, channel, payload) => webContents.send(channel, payload)
  )
  ipcMain.handle(AI_IPC.statusGet, () => service.getStatus())
  ipcMain.handle(AI_IPC.settingsGet, () => service.getSettings())
  ipcMain.handle(AI_IPC.settingsSave, (_event, settings: AiSettings) => service.saveSettings(settings))
  ipcMain.handle(AI_IPC.credentialSet, (_event, providerId: 'openai' | 'deepseek', apiKey: string) => service.setCredential(providerId, apiKey))
  ipcMain.handle(AI_IPC.credentialClear, (_event, providerId: 'openai' | 'deepseek') => service.clearCredential(providerId))
  ipcMain.handle(AI_IPC.connectionTest, (_event, providerId: 'openai' | 'deepseek') => service.testConnection(providerId))
  ipcMain.handle(AI_IPC.conversationsList, (_event, query?: string) => service.listConversations(query))
  ipcMain.handle(AI_IPC.conversationGet, (_event, conversationId: string) => service.getConversation(conversationId))
  ipcMain.handle(AI_IPC.conversationCreate, (_event, input) => service.createConversation(input))
  ipcMain.handle(AI_IPC.conversationRename, (_event, conversationId: string, title: string) => service.renameConversation(conversationId, title))
  ipcMain.handle(AI_IPC.conversationDelete, (_event, conversationId: string) => service.deleteConversation(conversationId))
  ipcMain.handle(AI_IPC.conversationsClear, () => service.clearConversations())
  ipcMain.handle(AI_IPC.conversationExport, (_event, conversationId: string) => service.exportConversation(conversationId))
  ipcMain.handle(AI_IPC.conversationsExportAll, () => service.exportAllConversations())
  ipcMain.handle(AI_IPC.chatSend, (event, input) => service.sendChat(event.sender, input))
  ipcMain.handle(AI_IPC.chatCancel, (_event, conversationId: string) => service.cancelChat(conversationId))
  ipcMain.handle(AI_IPC.chatRetry, (event, conversationId: string, messageId: string) => service.retryChat(event.sender, conversationId, messageId))
  ipcMain.handle(AI_IPC.analysisInterpret, (_event, quoteId: string) => service.interpret(quoteId))

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(AI_IPC)) {
        if (!channel.startsWith('ai:chat:') || channel === AI_IPC.chatSend || channel === AI_IPC.chatCancel || channel === AI_IPC.chatRetry) {
          ipcMain.removeHandler(channel)
        }
      }
      ipcMain.removeHandler(AI_IPC.analysisInterpret)
    }
  }
}
