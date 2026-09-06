import type { AiProviderId } from './types'

export const AI_IPC = {
  statusGet: 'ai:status:get',
  settingsGet: 'ai:settings:get',
  settingsSave: 'ai:settings:update',
  credentialSet: 'ai:credential:set',
  credentialClear: 'ai:credential:clear',
  modelsList: 'ai:models:list',
  connectionTest: 'ai:connection:test',
  conversationsList: 'ai:conversation:list',
  conversationGet: 'ai:conversation:get',
  conversationCreate: 'ai:conversation:create',
  conversationRename: 'ai:conversation:rename',
  conversationDelete: 'ai:conversation:delete',
  conversationsClear: 'ai:conversation:clear',
  conversationExport: 'ai:conversation:export',
  conversationsExportAll: 'ai:conversation:export-all',
  chatSend: 'ai:chat:send',
  chatCancel: 'ai:chat:cancel',
  chatRetry: 'ai:chat:retry',
  chatDelta: 'ai:chat:delta',
  chatCompleted: 'ai:chat:completed',
  chatError: 'ai:chat:error',
  analysisLatestGet: 'ai:analysis:latest:get',
  analysisInterpret: 'ai:analysis:interpret',
  analysisLongTermLatestGet: 'ai:analysis:long-term:latest:get',
  analysisLongTermInterpret: 'ai:analysis:long-term:interpret',
  analysisProgress: 'ai:analysis:progress'
} as const

export const AI_DEFAULT_MODELS = {
  openai: 'gpt-5.6',
  deepseek: 'deepseek-v4-flash',
  zhipu: 'glm-5.2',
  kimi: 'kimi-k2.5',
  minimax: 'MiniMax-M2.7',
  hunyuan: 'hy4-preview',
  ernie: 'ernie-5.1',
  qwen: 'qwen3.8-max',
  mimo: 'mimo-v2.5-pro',
  grok: 'grok-4.6',
  gemini: 'gemini-3.5-flash',
  anthropic: 'claude-sonnet-5'
} satisfies Record<AiProviderId, string>

export const AI_PROMPT_VERSION = '2026-08-07.1'
export const AI_LONG_TERM_PROMPT_VERSION = '2026-08-07.2'
