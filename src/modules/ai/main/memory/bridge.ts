import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { atomicWriteFileSync, atomicWriteJsonSync } from '../../../../../electron/main/file-storage'
import type { AiConversation } from '../../shared/types'
import type {
  MemoryFact,
  MemoryIdentity,
  MemoryProfile,
  MemorySearchResult,
  MemoryStatus
} from '../../shared/memory-types'
import type { AiStorage } from '../storage'

type Binding = {
  profileId: string
  serviceId: string
  userId: string
  clientId: string
  generation: number
  sessionId?: string
  pendingDelete: boolean
  historyVisible?: boolean
}
type State = {
  activeProfileId: string | null
  profiles: MemoryProfile[]
  bindings: Record<string, Binding>
}
type Prepared = { text: string; sources: MemorySearchResult[]; unavailable: boolean }

export class MemoryBridge {
  private readonly statePath: string
  private readonly secretsPath: string
  private state: State

  constructor(private readonly storage: AiStorage) {
    this.statePath = join(storage.rootDirectory, 'memory-bridge.json')
    this.secretsPath = join(storage.rootDirectory, 'memory-credentials.bin')
    try {
      this.state = JSON.parse(readFileSync(this.statePath, 'utf8')) as State
    } catch {
      this.state = { activeProfileId: null, profiles: [], bindings: {} }
    }
  }

  private save(): void {
    atomicWriteJsonSync(this.statePath, this.state)
  }
  private tokens(): Record<string, string> {
    if (!existsSync(this.secretsPath)) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统无法解密记忆连接令牌')
    return JSON.parse(safeStorage.decryptString(readFileSync(this.secretsPath))) as Record<
      string,
      string
    >
  }
  private saveTokens(tokens: Record<string, string>): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统无法安全保存记忆连接令牌')
    atomicWriteFileSync(this.secretsPath, safeStorage.encryptString(JSON.stringify(tokens)))
  }
  private active(): MemoryProfile | null {
    return this.state.profiles.find((profile) => profile.id === this.state.activeProfileId) ?? null
  }
  getStatus(): MemoryStatus {
    return {
      activeProfileId: this.state.activeProfileId,
      profiles: this.state.profiles,
      pendingDeletes: Object.values(this.state.bindings).filter((binding) => binding.pendingDelete)
        .length,
      bindings: Object.fromEntries(
        Object.entries(this.state.bindings).map(([key, value]) => [
          key,
          {
            profileId: value.profileId,
            pendingDelete: value.pendingDelete,
            historyVisible: value.historyVisible !== false
          }
        ])
      )
    }
  }
  async connect(name: string, address: string, token: string): Promise<MemoryProfile> {
    const url = new URL(address)
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('当前版本只支持本机 HTTP 记忆服务地址')
    const base = url.origin
    const identity = await this.raw<MemoryIdentity>(base, token.trim(), 'GET', '/v1/me')
    const capabilities = await this.raw<{
      apiVersion: string
      profile: boolean
      sessions: boolean
    }>(base, token.trim(), 'GET', '/v1/capabilities')
    if (capabilities.apiVersion !== 'v1' || !capabilities.profile || !capabilities.sessions)
      throw new Error('记忆服务版本或能力不兼容')
    const old = this.state.profiles.find(
      (profile) =>
        profile.url === base &&
        profile.serviceId === identity.serviceId &&
        profile.userId === identity.userId &&
        profile.clientId === identity.clientId
    )
    const profile: MemoryProfile = {
      id: old?.id ?? randomUUID(),
      name: name.trim() || identity.displayName,
      url: base,
      serviceId: identity.serviceId,
      userId: identity.userId,
      clientId: identity.clientId,
      displayName: identity.displayName
    }
    const tokens = this.tokens()
    tokens[profile.id] = token.trim()
    this.saveTokens(tokens)
    this.state.profiles = [...this.state.profiles.filter((item) => item.id !== profile.id), profile]
    this.state.activeProfileId = profile.id
    this.save()
    await this.flushDeletes().catch(() => undefined)
    return profile
  }
  select(profileId: string | null): MemoryStatus {
    if (profileId && !this.state.profiles.some((profile) => profile.id === profileId))
      throw new Error('记忆连接不存在')
    this.state.activeProfileId = profileId
    this.save()
    return this.getStatus()
  }
  bindConversation(conversationId: string): void {
    const profile = this.active()
    if (!profile) throw new Error('请先连接记忆服务')
    const existing = this.state.bindings[conversationId]
    if (existing) {
      if (existing.profileId !== profile.id)
        throw new Error('此会话已绑定另一位记忆用户，请切回原连接或新建会话')
      return
    }
    this.state.bindings[conversationId] = {
      profileId: profile.id,
      serviceId: profile.serviceId,
      userId: profile.userId,
      clientId: profile.clientId,
      generation: 1,
      pendingDelete: false,
      historyVisible: true
    }
    this.save()
  }
  bindNewConversation(conversationId: string): void {
    if (this.active()) this.bindConversation(conversationId)
  }
  markDelete(conversationId: string): void {
    const binding = this.state.bindings[conversationId]
    if (!binding) return
    binding.pendingDelete = true
    this.save()
  }
  async flushDeletes(): Promise<void> {
    const profile = this.active()
    if (!profile) return
    await this.assertIdentity(profile)
    for (const [conversationId, binding] of Object.entries(this.state.bindings)) {
      if (!binding.pendingDelete || binding.profileId !== profile.id) continue
      try {
        const session = await this.register(profile, binding, {
          id: conversationId,
          title: '已删除会话'
        } as AiConversation)
        await this.request(profile, 'DELETE', `/v1/sessions/${session.id}`, {
          operationId: `delete:${conversationId}:${binding.generation}`
        })
        delete this.state.bindings[conversationId]
        this.save()
      } catch (error) {
        if (error instanceof Error && error.message.includes('410')) {
          delete this.state.bindings[conversationId]
          this.save()
          continue
        }
        throw error
      }
    }
  }
  private async raw<T>(
    url: string,
    token: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3500),
      redirect: 'error'
    })
    const result = (await response.json()) as T & { error?: string }
    if (!response.ok) throw new Error(`记忆服务 ${response.status}: ${result.error ?? '请求失败'}`)
    return result
  }
  private request<T>(
    profile: MemoryProfile,
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = this.tokens()[profile.id]
    if (!token) throw new Error('记忆连接令牌不可用')
    return this.raw<T>(profile.url, token, method, path, body)
  }
  private async assertIdentity(profile: MemoryProfile): Promise<void> {
    const me = await this.request<MemoryIdentity>(profile, 'GET', '/v1/me')
    if (
      me.serviceId !== profile.serviceId ||
      me.userId !== profile.userId ||
      me.clientId !== profile.clientId
    )
      throw new Error('记忆服务实例或用户身份已改变，已暂停同步')
  }
  private async register(
    profile: MemoryProfile,
    binding: Binding,
    conversation: AiConversation
  ): Promise<{ id: string; lastSequence: number }> {
    const result = await this.request<{ id: string; lastSequence: number }>(
      profile,
      'POST',
      '/v1/sessions',
      {
        operationId: `register:${conversation.id}:${binding.generation}`,
        externalSessionId: conversation.id,
        generation: binding.generation,
        title: conversation.title
      }
    )
    binding.sessionId = result.id
    this.save()
    return result
  }
  private async sync(
    profile: MemoryProfile,
    binding: Binding,
    conversation: AiConversation
  ): Promise<{ id: string; lastSequence: number }> {
    let session = await this.register(profile, binding, conversation)
    const messages = this.storage
      .getMessages(conversation.id)
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          ['completed', 'stopped', 'error'].includes(message.status)
      )
    if (session.lastSequence > messages.length)
      throw new Error('记忆服务消息水位超过本地会话，请检查数据恢复状态')
    for (let index = session.lastSequence; index < messages.length; index++) {
      const message = messages[index]
      const result = await this.request<{ lastSequence: number }>(
        profile,
        'POST',
        `/v1/sessions/${session.id}/events`,
        {
          operationId: `message:${conversation.id}:${index + 1}:${message.id}`,
          event: {
            externalMessageId: message.id,
            revision: 1,
            sequence: index + 1,
            role: message.role,
            status: message.status,
            text: message.content,
            occurredAt: message.createdAt
          }
        }
      )
      session = { ...session, lastSequence: result.lastSequence }
    }
    return session
  }
  async syncConversation(conversation: AiConversation): Promise<void> {
    const profile = this.active()
    const binding = this.state.bindings[conversation.id]
    if (!profile || !binding || binding.profileId !== profile.id || binding.pendingDelete) return
    await this.assertIdentity(profile)
    await this.flushDeletes()
    await this.sync(profile, binding, conversation)
  }
  async prepare(conversation: AiConversation, question: string): Promise<Prepared | null> {
    const profile = this.active(),
      binding = this.state.bindings[conversation.id]
    if (!profile || !binding || binding.profileId !== profile.id || binding.pendingDelete)
      return null
    try {
      await this.assertIdentity(profile)
      await this.flushDeletes()
      const session = await this.sync(profile, binding, conversation)
      const result = await this.request<{ profile: MemoryFact[]; history: MemorySearchResult[] }>(
        profile,
        'POST',
        `/v1/sessions/${session.id}/prepare-turn`,
        { turnId: randomUUID(), question }
      )
      const profileText = result.profile
        .map((item) => `- ${item.key}：${item.content} [M:${item.id}]`)
        .join('\n')
      const historyText = result.history
        .map(
          (item) =>
            `- ${item.title ?? '历史会话'} / ${item.occurredAt ?? ''}：${item.text} [M:${item.sourceId}]`
        )
        .join('\n')
      return {
        text: [
          profileText && `用户偏好与事实：\n${profileText}`,
          historyText && `相关先前对话：\n${historyText}`
        ]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 12000),
        sources: result.history,
        unavailable: false
      }
    } catch {
      return { text: '', sources: [], unavailable: true }
    }
  }
  async setHistoryVisible(conversation: AiConversation, visible: boolean): Promise<void> {
    const profile = this.active()
    const binding = this.state.bindings[conversation.id]
    if (!profile || !binding || binding.profileId !== profile.id || binding.pendingDelete)
      throw new Error('此会话未绑定当前记忆身份')
    await this.assertIdentity(profile)
    const session = await this.register(profile, binding, conversation)
    const current = await this.request<{ revision: number }>(
      profile,
      'GET',
      `/v1/sessions/${session.id}`
    )
    await this.request(profile, 'PATCH', `/v1/sessions/${session.id}`, {
      operationId: randomUUID(),
      expectedRevision: current.revision,
      historyVisible: visible
    })
    binding.historyVisible = visible
    this.save()
  }
  async search(
    query: string,
    conversationId?: string,
    expectedProfileId?: string
  ): Promise<MemorySearchResult[]> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    if (expectedProfileId && profile.id !== expectedProfileId)
      throw new Error('记忆身份已切换，请重新提问')
    await this.assertIdentity(profile)
    const binding = conversationId ? this.state.bindings[conversationId] : undefined
    const result = await this.request<{ results: MemorySearchResult[] }>(
      profile,
      'POST',
      '/v1/search',
      { query, sessionId: binding?.sessionId }
    )
    return result.results
  }
  async readSource(
    kind: string,
    sourceId: string,
    conversationId?: string,
    expectedProfileId?: string
  ): Promise<{ text: string }> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    if (expectedProfileId && profile.id !== expectedProfileId)
      throw new Error('记忆身份已切换，请重新提问')
    await this.assertIdentity(profile)
    const binding = conversationId ? this.state.bindings[conversationId] : undefined
    return this.request(profile, 'POST', '/v1/sources/read', {
      kind,
      sourceId,
      sessionId: binding?.sessionId
    })
  }
  async listFacts(query = ''): Promise<MemoryFact[]> {
    const profile = this.active()
    if (!profile) return []
    await this.assertIdentity(profile)
    const result = await this.request<{ facts: MemoryFact[] }>(
      profile,
      'GET',
      `/v1/profile/facts?q=${encodeURIComponent(query)}`
    )
    return result.facts
  }
  async saveFact(
    input: {
      key: string
      content: string
      category?: string
      pinned?: boolean
      id?: string
      expectedRevision?: number
    },
    expectedProfileId?: string
  ): Promise<MemoryFact> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    if (expectedProfileId && profile.id !== expectedProfileId)
      throw new Error('记忆身份已切换，请重新提问')
    await this.assertIdentity(profile)
    return this.request(
      profile,
      input.id ? 'PATCH' : 'POST',
      input.id ? `/v1/profile/facts/${input.id}` : '/v1/profile/facts',
      { ...input, operationId: randomUUID() }
    )
  }
  async deleteFact(
    id: string,
    expectedRevision: number,
    expectedProfileId?: string
  ): Promise<void> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    if (expectedProfileId && profile.id !== expectedProfileId)
      throw new Error('记忆身份已切换，请重新提问')
    await this.assertIdentity(profile)
    await this.request(profile, 'DELETE', `/v1/profile/facts/${id}`, {
      operationId: randomUUID(),
      expectedRevision
    })
  }
}
