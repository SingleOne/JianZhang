import { existsSync, readFileSync, rmSync } from 'node:fs'
import { safeStorage } from 'electron'
import { join } from 'node:path'
import type { AiApiKeyProviderId, AiCredentialStatus } from '../shared/types'
import { atomicWriteFileSync } from '../../../../electron/main/file-storage'

export type AiApiKeyDocument = Partial<Record<AiApiKeyProviderId, string>>

export class AiSecrets {
  private readonly filePath: string

  constructor(rootDirectory: string) {
    this.filePath = join(rootDirectory, 'credentials.bin')
  }

  private readEncrypted(): AiApiKeyDocument {
    if (!existsSync(this.filePath)) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全加密 AI API Key')
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(this.filePath))) as AiApiKeyDocument
    } catch {
      throw new Error('AI 凭证无法解密，请重新配置 API Key')
    }
  }

  private writeEncrypted(credentials: AiApiKeyDocument): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全加密 AI API Key')
    atomicWriteFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(credentials)))
  }

  get(providerId: AiApiKeyProviderId): string | null {
    return this.readEncrypted()[providerId] ?? null
  }

  getStatus(providerId: AiApiKeyProviderId): AiCredentialStatus {
    const key = this.get(providerId)
    return key ? { configured: true, maskedSuffix: key.slice(-4) } : { configured: false }
  }

  set(providerId: AiApiKeyProviderId, apiKey: string): AiCredentialStatus {
    const value = apiKey.trim()
    if (!value) throw new Error('API Key 不能为空')
    const credentials = this.readEncrypted()
    credentials[providerId] = value
    this.writeEncrypted(credentials)
    return { configured: true, maskedSuffix: value.slice(-4) }
  }

  clear(providerId: AiApiKeyProviderId): void {
    const credentials = this.readEncrypted()
    delete credentials[providerId]
    if (Object.keys(credentials).length === 0) {
      if (existsSync(this.filePath)) rmSync(this.filePath)
      return
    }
    this.writeEncrypted(credentials)
  }

  exportAll(): AiApiKeyDocument {
    return this.readEncrypted()
  }

  replaceAll(credentials: AiApiKeyDocument): void {
    const saved: AiApiKeyDocument = {}
    for (const providerId of ['openai', 'deepseek'] as const) {
      const apiKey = credentials[providerId]?.trim()
      if (apiKey) saved[providerId] = apiKey
    }
    if (Object.keys(saved).length === 0) {
      if (existsSync(this.filePath)) rmSync(this.filePath)
      return
    }
    this.writeEncrypted(saved)
  }
}
