export const AI_IPC = {
  statusGet: 'ai:status:get',
  settingsGet: 'ai:settings:get',
  settingsSave: 'ai:settings:update',
  credentialSet: 'ai:credential:set',
  credentialClear: 'ai:credential:clear',
  codexLogin: 'ai:codex:login',
  codexLogout: 'ai:codex:logout',
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
  analysisInterpret: 'ai:analysis:interpret'
} as const

export const AI_PROMPT_VERSION = '2026-07-21.1'

export const OPENAI_CODEX_DEFAULT_MODEL = 'gpt-5.6-sol'

export function normalizeOpenAiCodexModelId(model: string): string {
  return model.trim().toLowerCase().replace(/[\s_]+/g, '-')
}
