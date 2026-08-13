import type { AiApiKeyProviderId } from '../modules/ai/shared/types'
import { parseImportedAppState } from './config'
import type { AppState } from './types'

export const JIANZHANG_USER_DATA_BACKUP_FORMAT = 'jianzhang-user-data-backup'
export const JIANZHANG_USER_DATA_BACKUP_VERSION = 1

export type UserDataBackupApiKeys = Partial<Record<AiApiKeyProviderId, string>>

export interface UserDataBackupFile {
  path: string
  content: string
}

export interface JianzhangUserDataBackupDocument {
  format: typeof JIANZHANG_USER_DATA_BACKUP_FORMAT
  formatVersion: typeof JIANZHANG_USER_DATA_BACKUP_VERSION
  applicationVersion: string
  exportedAt: string
  state: AppState
  files: UserDataBackupFile[]
  aiApiKeys: UserDataBackupApiKeys
}

const BACKUP_SINGLE_FILES = new Set([
  'modules/market-insight/settings.json',
  'modules/market-insight/events.json',
  'modules/ai/settings.json',
  'modules/ai-t-advice/settings.json',
  'modules/ai-t-advice/advice-history.jsonl',
  'company-reports/summaries.json',
  'completion-notifications.json'
])

const BACKUP_DIRECTORY_PREFIXES = [
  'modules/ai/conversations/',
  'modules/ai/snapshots/',
  'modules/ai/cache/'
] as const

export const USER_DATA_BACKUP_SINGLE_FILES = [...BACKUP_SINGLE_FILES]
export const USER_DATA_BACKUP_DIRECTORIES = BACKUP_DIRECTORY_PREFIXES.map((path) =>
  path.slice(0, -1)
)

export function isUserDataBackupPath(path: string): boolean {
  const segments = path.split('/')
  if (
    path.includes('\\') ||
    path.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return false
  }
  return (
    BACKUP_SINGLE_FILES.has(path) ||
    BACKUP_DIRECTORY_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

export function createUserDataBackupDocument(
  state: AppState,
  applicationVersion: string,
  files: UserDataBackupFile[],
  aiApiKeys: UserDataBackupApiKeys
): JianzhangUserDataBackupDocument {
  return {
    format: JIANZHANG_USER_DATA_BACKUP_FORMAT,
    formatVersion: JIANZHANG_USER_DATA_BACKUP_VERSION,
    applicationVersion,
    exportedAt: new Date().toISOString(),
    state,
    files,
    aiApiKeys
  }
}

function parseFiles(value: unknown): UserDataBackupFile[] {
  if (!Array.isArray(value)) throw new Error('备份文件列表不完整')
  const paths = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('备份中的文件信息无效')
    const file = entry as Partial<UserDataBackupFile>
    if (
      typeof file.path !== 'string' ||
      !isUserDataBackupPath(file.path) ||
      typeof file.content !== 'string' ||
      paths.has(file.path)
    ) {
      throw new Error('备份中的文件信息无效')
    }
    paths.add(file.path)
    return { path: file.path, content: file.content }
  })
}

function parseApiKeys(value: unknown): UserDataBackupApiKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('备份中的 AI API Key 信息无效')
  }
  const saved = value as Record<string, unknown>
  const apiKeys: UserDataBackupApiKeys = {}
  for (const providerId of ['openai', 'deepseek'] as const) {
    const apiKey = saved[providerId]
    if (apiKey === undefined) continue
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('备份中的 AI API Key 信息无效')
    }
    apiKeys[providerId] = apiKey
  }
  return apiKeys
}

export function parseUserDataBackupDocument(value: unknown): JianzhangUserDataBackupDocument {
  if (!value || typeof value !== 'object') throw new Error('文件不是有效的见涨用户数据备份')
  const document = value as Partial<JianzhangUserDataBackupDocument>
  if (
    document.format !== JIANZHANG_USER_DATA_BACKUP_FORMAT ||
    document.formatVersion !== JIANZHANG_USER_DATA_BACKUP_VERSION ||
    typeof document.applicationVersion !== 'string' ||
    typeof document.exportedAt !== 'string'
  ) {
    throw new Error('用户数据备份格式或版本不受支持')
  }
  return {
    format: JIANZHANG_USER_DATA_BACKUP_FORMAT,
    formatVersion: JIANZHANG_USER_DATA_BACKUP_VERSION,
    applicationVersion: document.applicationVersion,
    exportedAt: document.exportedAt,
    state: parseImportedAppState(document.state),
    files: parseFiles(document.files),
    aiApiKeys: parseApiKeys(document.aiApiKeys)
  }
}
