import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'
import { join } from 'node:path'
import type { AiCredentialStatus, AiProviderId } from '../shared/types'

type CredentialDocument = Partial<Record<AiProviderId, string>>

export class AiSecrets {
  private readonly filePath: string

  constructor(rootDirectory: string) {
    this.filePath = join(rootDirectory, 'credentials.bin')
  }

  private readEncrypted(): CredentialDocument {
    if (!existsSync(this.filePath)) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全加密 AI API Key')
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(this.filePath))) as CredentialDocument
    } catch {
      throw new Error('AI 凭证无法解密，请重新配置 API Key')
    }
  }

  private writeEncrypted(credentials: CredentialDocument): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全加密 AI API Key')
    writeFileSync(this.filePath, safeStorage.encryptString(JSON.stringify(credentials)))
  }

  get(providerId: AiProviderId): string | null {
    return this.readEncrypted()[providerId] ?? null
  }

  getStatus(providerId: AiProviderId): AiCredentialStatus {
    const key = this.get(providerId)
    return key ? { configured: true, maskedSuffix: key.slice(-4) } : { configured: false }
  }

  set(providerId: AiProviderId, apiKey: string): AiCredentialStatus {
    const value = apiKey.trim()
    if (!value) throw new Error('API Key 不能为空')
    const credentials = this.readEncrypted()
    credentials[providerId] = value
    this.writeEncrypted(credentials)
    return { configured: true, maskedSuffix: value.slice(-4) }
  }

  clear(providerId: AiProviderId): void {
    const credentials = this.readEncrypted()
    delete credentials[providerId]
    if (Object.keys(credentials).length === 0) {
      if (existsSync(this.filePath)) rmSync(this.filePath)
      return
    }
    this.writeEncrypted(credentials)
  }
}
