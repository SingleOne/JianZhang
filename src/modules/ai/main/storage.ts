import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJsonSync } from '../../../../electron/main/file-storage'
import { AI_DEFAULT_MODELS } from '../shared/constants'
import type {
  AiConversation,
  AiConversationExport,
  AiMessage,
  AiProviderId,
  AiSettings
} from '../shared/types'
import { AI_PROVIDER_IDS } from '../shared/types'

const DEFAULT_SETTINGS: AiSettings = {
  enabled: true,
  providerId: 'openai',
  model: AI_DEFAULT_MODELS.openai,
  maxContextMessages: 16
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function messageSnapshotIds(message: AiMessage): string[] {
  if (message.contextRefs?.length) return message.contextRefs.map((item) => item.snapshotId)
  return message.contextRef ? [message.contextRef.snapshotId] : []
}

export class AiStorage {
  readonly conversationsDirectory: string
  readonly snapshotsDirectory: string
  readonly cacheDirectory: string

  constructor(readonly rootDirectory: string) {
    this.conversationsDirectory = join(rootDirectory, 'conversations')
    this.snapshotsDirectory = join(rootDirectory, 'snapshots')
    this.cacheDirectory = join(rootDirectory, 'cache')
    for (const directory of [
      rootDirectory,
      this.conversationsDirectory,
      this.snapshotsDirectory,
      this.cacheDirectory
    ]) {
      mkdirSync(directory, { recursive: true })
    }
  }

  getSettings(): AiSettings {
    const saved = readJson<Partial<AiSettings>>(join(this.rootDirectory, 'settings.json'), {})
    const providerId: AiProviderId = AI_PROVIDER_IDS.includes(saved.providerId as AiProviderId)
      ? (saved.providerId as AiProviderId)
      : 'openai'
    const defaultModel = AI_DEFAULT_MODELS[providerId]
    const savedModel =
      typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim() : defaultModel
    return {
      enabled: saved.enabled !== false,
      providerId,
      model: savedModel,
      maxContextMessages:
        typeof saved.maxContextMessages === 'number'
          ? Math.max(4, Math.min(40, Math.round(saved.maxContextMessages)))
          : DEFAULT_SETTINGS.maxContextMessages
    }
  }

  saveSettings(settings: AiSettings): AiSettings {
    atomicWriteJsonSync(join(this.rootDirectory, 'settings.json'), settings)
    return settings
  }

  private indexPath(): string {
    return join(this.conversationsDirectory, 'index.json')
  }

  private messagePath(conversationId: string): string {
    return join(this.conversationsDirectory, `conversation-${conversationId}.jsonl`)
  }

  private snapshotPath(snapshotId: string): string {
    return join(this.snapshotsDirectory, `snapshot-${encodeURIComponent(snapshotId)}.json`)
  }

  listConversations(): AiConversation[] {
    return readJson<AiConversation[]>(this.indexPath(), []).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  saveConversations(conversations: AiConversation[]): void {
    atomicWriteJsonSync(this.indexPath(), conversations)
  }

  getConversation(conversationId: string): AiConversation | null {
    return this.listConversations().find((item) => item.id === conversationId) ?? null
  }

  saveConversation(conversation: AiConversation): AiConversation {
    const conversations = this.listConversations()
    const index = conversations.findIndex((item) => item.id === conversation.id)
    if (index === -1) conversations.push(conversation)
    else conversations[index] = conversation
    this.saveConversations(conversations)
    return conversation
  }

  getMessages(conversationId: string): AiMessage[] {
    const filePath = this.messagePath(conversationId)
    if (!existsSync(filePath)) return []
    return readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AiMessage]
        } catch {
          return []
        }
      })
  }

  appendMessage(message: AiMessage): void {
    appendFileSync(this.messagePath(message.conversationId), `${JSON.stringify(message)}\n`, 'utf8')
  }

  deleteConversation(conversationId: string): void {
    const deletedSnapshotIds = new Set(this.getMessages(conversationId).flatMap(messageSnapshotIds))
    const conversations = this.listConversations().filter((item) => item.id !== conversationId)
    this.saveConversations(conversations)
    const filePath = this.messagePath(conversationId)
    if (existsSync(filePath)) rmSync(filePath)
    const referencedSnapshotIds = new Set(
      conversations.flatMap((conversation) =>
        this.getMessages(conversation.id).flatMap(messageSnapshotIds)
      )
    )
    for (const snapshotId of deletedSnapshotIds) {
      const snapshotPath = this.snapshotPath(snapshotId)
      if (!referencedSnapshotIds.has(snapshotId) && existsSync(snapshotPath)) rmSync(snapshotPath)
    }
  }

  clearConversations(): void {
    for (const conversation of this.listConversations()) this.deleteConversation(conversation.id)
  }

  exportConversation(conversationId: string): AiConversationExport {
    const conversation = this.getConversation(conversationId)
    if (!conversation) throw new Error('未找到要导出的对话')
    return {
      conversation,
      messages: this.getMessages(conversationId),
      exportedAt: new Date().toISOString()
    }
  }

  saveSnapshot(snapshotId: string, snapshot: unknown): void {
    atomicWriteJsonSync(this.snapshotPath(snapshotId), snapshot)
  }

  getInterpretation<T>(cacheKey: string): T | null {
    const cache = readJson<Record<string, T>>(join(this.cacheDirectory, 'interpretations.json'), {})
    return cache[cacheKey] ?? null
  }

  saveInterpretation<T>(cacheKey: string, value: T): void {
    const cachePath = join(this.cacheDirectory, 'interpretations.json')
    const cache = readJson<Record<string, T>>(cachePath, {})
    cache[cacheKey] = value
    atomicWriteJsonSync(cachePath, cache)
  }

  getLatestInterpretation<T>(quoteId: string): T | null {
    const latest = readJson<Record<string, T>>(
      join(this.cacheDirectory, 'latest-interpretations.json'),
      {}
    )
    return latest[quoteId] ?? null
  }

  saveLatestInterpretation<T>(quoteId: string, value: T): void {
    const latestPath = join(this.cacheDirectory, 'latest-interpretations.json')
    const latest = readJson<Record<string, T>>(latestPath, {})
    latest[quoteId] = value
    atomicWriteJsonSync(latestPath, latest)
  }
}
