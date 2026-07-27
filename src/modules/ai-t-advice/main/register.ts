import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { AiTAdviceSettings } from '../shared/types'
import { AiTAdviceService, type AiTAdviceDependencies } from './service'
import { AiTAdviceStorage } from './storage'

const PROGRESS_CHANNEL = 'ai-t:advice:progress'

const IPC = {
  statusGet: 'ai-t:status:get',
  settingsGet: 'ai-t:settings:get',
  settingsSave: 'ai-t:settings:update',
  generate: 'ai-t:advice:generate',
  cancel: 'ai-t:advice:cancel',
  history: 'ai-t:advice:history',
  dismiss: 'ai-t:advice:dismiss',
  previewApply: 'ai-t:advice:preview-apply',
  confirmApply: 'ai-t:advice:confirm-apply'
} as const

export interface AiTAdviceRuntime {
  dispose: () => void
}

export function installAiTAdvice(dependencies: AiTAdviceDependencies): AiTAdviceRuntime {
  const service = new AiTAdviceService(
    new AiTAdviceStorage(join(app.getPath('userData'), 'modules', 'ai-t-advice')),
    dependencies
  )
  ipcMain.handle(IPC.statusGet, () => service.getStatus())
  ipcMain.handle(IPC.settingsGet, () => service.getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AiTAdviceSettings) => service.saveSettings(settings))
  ipcMain.handle(IPC.generate, (event, quoteId: string) => service.generate(quoteId, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(PROGRESS_CHANNEL, progress)
  }))
  ipcMain.handle(IPC.cancel, (_event, quoteId: string) => service.cancel(quoteId))
  ipcMain.handle(IPC.history, (_event, quoteId: string) => service.listHistory(quoteId))
  ipcMain.handle(IPC.dismiss, (_event, adviceId: string) => service.dismiss(adviceId))
  ipcMain.handle(IPC.previewApply, (_event, adviceId: string) => service.previewApply(adviceId))
  ipcMain.handle(IPC.confirmApply, (_event, previewId: string) => service.confirmApply(previewId))

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(IPC)) ipcMain.removeHandler(channel)
    }
  }
}
