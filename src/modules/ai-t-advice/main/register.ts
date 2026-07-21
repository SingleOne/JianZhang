import { ipcMain } from 'electron'
import type { AiTAdviceStatus } from '../shared/types'

const STATUS: AiTAdviceStatus = {
  enabled: false,
  message: '做 T 参考尚未进入发行范围；当前模块仅保留独立构建与删除边界。'
}

export interface AiTAdviceRuntime {
  dispose: () => void
}

export function installAiTAdvice(): AiTAdviceRuntime {
  ipcMain.handle('ai-t:status:get', () => STATUS)
  return {
    dispose: () => ipcMain.removeHandler('ai-t:status:get')
  }
}
