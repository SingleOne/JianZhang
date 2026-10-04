import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { atomicWriteFileSync, atomicWriteJsonSync } from '../../../../../electron/main/file-storage'
import type {
  AiConversation,
  AiMessageContextUse,
  ChatCitation,
  StockCitation
} from '../../shared/types'
import type {
  MemoryCandidate,
  MemoryCapabilities,
  MemoryFact,
  MemoryDocument,
  MemoryDocumentJobState,
  MemoryDocumentProcessingJob,
  MemoryIdentity,
  MemoryLibrary,
  MemoryMaintenanceStatus,
  MemoryProfile,
  MemorySearchResult,
  MemorySourceDetail,
  MemoryStatus,
  ChatMemorySourceResult
} from '../../shared/memory-types'
import type { AiStorage } from '../storage'
import type { PreparedMemoryTurn } from '../citations/registry'
import { uploadBytes } from './upload'
import type { MemoryUploadProgress } from '../../shared/memory-types'

type Binding = {
  profileId: string
  serviceId: string
  userId: string
  clientId: string
  generation: number
  sessionId?: string
  pendingDelete: boolean
  historyVisible?: boolean
  libraryIds?: string[]
  messageEvents?: Record<string, { operationId: string; event: Record<string, unknown> }>
}
type State = {
  activeProfileId: string | null
  profiles: MemoryProfile[]
  bindings: Record<string, Binding>
}
function contextUsePayload(use: AiMessageContextUse) {
  const citation = use.citation
  return {
    turnId: use.turnId,
    usage: use.usage,
    kind: citation.kind === 'history' ? 'message' : citation.kind,
    sourceId:
      citation.kind === 'document'
        ? citation.chunkId
        : citation.kind === 'history'
          ? citation.messageId
          : citation.factId,
    textHash: citation.textHash,
    revision: citation.kind === 'document' ? undefined : citation.revision,
    sourceSessionId: citation.kind === 'history' ? citation.sourceSessionId : undefined,
    documentId: citation.kind === 'document' ? citation.documentId : undefined,
    versionId: citation.kind === 'document' ? citation.versionId : undefined,
    generationId: citation.kind === 'document' ? citation.generationId : undefined,
    snapshot: {
      title:
        citation.kind === 'document'
          ? citation.fileName
          : citation.kind === 'history'
            ? citation.title
            : citation.key,
      locator: citation.kind === 'document' ? citation.locator : undefined,
      pageNumber: citation.kind === 'document' ? citation.pageNumber : undefined
    },
    excerpts: citation.providedExcerpts.slice(0, 16)
  }
}
export class MemoryBridge {
  private readonly statePath: string
  private readonly secretsPath: string
  private state: State
  private readonly syncQueues = new Map<string, Promise<unknown>>()

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
            historyVisible: value.historyVisible !== false,
            libraryIds: value.libraryIds ?? []
          }
        ])
      )
    }
  }
  async refreshCapabilities(): Promise<void> {
    const profile = this.active()
    if (!profile) return
    const capabilities = await this.request<MemoryCapabilities>(profile, 'GET', '/v1/capabilities')
    this.assertActiveProfile(profile)
    if (capabilities.apiVersion !== 'v1' || !capabilities.profile || !capabilities.sessions)
      throw new Error('记忆服务版本或能力不兼容')
    profile.capabilities = capabilities
    this.save()
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
    const capabilities = await this.raw<MemoryCapabilities>(
      base,
      token.trim(),
      'GET',
      '/v1/capabilities'
    )
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
      displayName: identity.displayName,
      capabilities
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
      historyVisible: true,
      libraryIds: []
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
    const result = (await response.json()) as T & { error?: string; message?: string }
    if (!response.ok)
      throw Object.assign(
        new Error(`记忆服务 ${response.status}: ${result.message ?? result.error ?? '请求失败'}`),
        { status: response.status }
      )
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
  private assertActiveProfile(profile: MemoryProfile): void {
    if (this.active()?.id !== profile.id) throw new Error('记忆身份已切换，请重新操作')
  }
  private assertConversationBinding(
    conversationId: string,
    profile: MemoryProfile,
    binding: Binding,
    sessionId?: string
  ): void {
    this.assertActiveProfile(profile)
    const current = this.state.bindings[conversationId]
    if (
      current !== binding ||
      current.pendingDelete ||
      current.profileId !== profile.id ||
      current.serviceId !== profile.serviceId ||
      current.userId !== profile.userId ||
      current.clientId !== profile.clientId ||
      (sessionId !== undefined && current.sessionId !== sessionId)
    )
      throw new Error('会话记忆绑定已变化，请重新提问')
  }
  private async assertIdentity(profile: MemoryProfile): Promise<void> {
    const me = await this.request<MemoryIdentity>(profile, 'GET', '/v1/me')
    this.assertActiveProfile(profile)
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
    const result = await this.request<{ id: string; lastSequence: number; libraryIds: string[] }>(
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
    binding.libraryIds = result.libraryIds ?? []
    this.save()
    return result
  }
  private async sync(
    profile: MemoryProfile,
    binding: Binding,
    conversation: AiConversation
  ): Promise<{ id: string; lastSequence: number }> {
    const prior = this.syncQueues.get(conversation.id) ?? Promise.resolve()
    const pending = prior
      .catch(() => undefined)
      .then(() => this.syncUnlocked(profile, binding, conversation))
    this.syncQueues.set(conversation.id, pending)
    try {
      return await pending
    } finally {
      if (this.syncQueues.get(conversation.id) === pending) this.syncQueues.delete(conversation.id)
    }
  }
  private async syncUnlocked(
    profile: MemoryProfile,
    binding: Binding,
    conversation: AiConversation
  ): Promise<{ id: string; lastSequence: number }> {
    this.assertConversationBinding(conversation.id, profile, binding)
    let session = await this.register(profile, binding, conversation)
    this.assertConversationBinding(conversation.id, profile, binding, session.id)
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
      this.assertConversationBinding(conversation.id, profile, binding, session.id)
      binding.messageEvents ??= {}
      const key = String(index + 1)
      const payload = (binding.messageEvents[key] ??= {
        operationId: `message:${conversation.id}:${index + 1}:${message.id}`,
        event: {
          externalMessageId: message.id,
          revision: 1,
          sequence: index + 1,
          role: message.role,
          status: message.status,
          text: message.content,
          occurredAt: message.createdAt,
          ...(profile.capabilities?.contextUses
            ? {
                contextUses: (message.contextUses ?? [])
                  .filter(
                    (use) =>
                      use.citation.serviceProfileId === profile.id &&
                      use.citation.serviceId === profile.serviceId &&
                      use.citation.userId === profile.userId &&
                      use.citation.sessionId === session.id
                  )
                  .map(contextUsePayload)
              }
            : {})
        }
      })
      this.save()
      const result = await this.request<{ lastSequence: number }>(
        profile,
        'POST',
        `/v1/sessions/${session.id}/events`,
        payload
      )
      this.assertConversationBinding(conversation.id, profile, binding, session.id)
      session = { ...session, lastSequence: result.lastSequence }
    }
    if (binding.messageEvents) {
      for (const key of Object.keys(binding.messageEvents))
        if (Number(key) <= session.lastSequence) delete binding.messageEvents[key]
      this.save()
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
  async prepare(
    conversation: AiConversation,
    question: string
  ): Promise<PreparedMemoryTurn | null> {
    const profile = this.active(),
      binding = this.state.bindings[conversation.id]
    if (!profile || !binding || binding.profileId !== profile.id || binding.pendingDelete)
      return null
    try {
      await this.assertIdentity(profile)
      await this.flushDeletes()
      const session = await this.sync(profile, binding, conversation)
      const result = await this.request<{
        profile: MemoryFact[]
        summary: string
        summaryThrough: number
        history: MemorySearchResult[]
        documents: MemorySearchResult[]
      }>(profile, 'POST', `/v1/sessions/${session.id}/prepare-turn`, {
        turnId: randomUUID(),
        question
      })
      this.assertConversationBinding(conversation.id, profile, binding, session.id)
      const profileText = result.profile.map((item) => `- ${item.key}：${item.content}`).join('\n')
      const documents = result.documents ?? []
      return {
        profileText,
        profileSources: result.profile.map((item) => ({
          kind: 'fact',
          sourceId: item.id,
          text: item.content,
          score: 0,
          key: item.key,
          revision: item.revision,
          textHash: createHash('sha256').update(item.content).digest('hex')
        })),
        summaryText: result.summary
          ? `已覆盖至消息序号 ${result.summaryThrough}：\n${result.summary.slice(0, 2000)}`
          : '',
        sources: [...result.history, ...documents],
        identity: {
          profileId: profile.id,
          serviceId: profile.serviceId,
          userId: profile.userId,
          sessionId: session.id
        },
        unavailable: false
      }
    } catch {
      return {
        profileText: '',
        summaryText: '',
        sources: [],
        identity: {
          profileId: profile.id,
          serviceId: profile.serviceId,
          userId: profile.userId,
          sessionId: binding.sessionId ?? ''
        },
        unavailable: true
      }
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
  async setLibraries(conversation: AiConversation, libraryIds: string[]): Promise<void> {
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
    const updated = await this.request<{ libraryIds: string[] }>(
      profile,
      'PATCH',
      `/v1/sessions/${session.id}`,
      { operationId: randomUUID(), expectedRevision: current.revision, libraryIds }
    )
    binding.libraryIds = updated.libraryIds ?? []
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
    if (
      conversationId &&
      (!binding || binding.profileId !== profile.id || binding.pendingDelete || !binding.sessionId)
    )
      throw new Error('此会话未绑定当前记忆身份')
    const sessionId = binding?.sessionId
    const result = await this.request<{ results: MemorySearchResult[] }>(
      profile,
      'POST',
      '/v1/search',
      { query, sessionId }
    )
    if (conversationId && binding)
      this.assertConversationBinding(conversationId, profile, binding, sessionId)
    else this.assertActiveProfile(profile)
    return result.results
  }
  async readSource(
    kind: string,
    sourceId: string,
    conversationId?: string,
    expectedProfileId?: string
  ): Promise<MemorySourceDetail> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    if (expectedProfileId && profile.id !== expectedProfileId)
      throw new Error('记忆身份已切换，请重新提问')
    await this.assertIdentity(profile)
    const binding = conversationId ? this.state.bindings[conversationId] : undefined
    if (
      conversationId &&
      (!binding || binding.profileId !== profile.id || binding.pendingDelete || !binding.sessionId)
    )
      throw new Error('此会话未绑定当前记忆身份')
    const sessionId = binding?.sessionId
    const result = await this.request<MemorySourceDetail>(profile, 'POST', '/v1/sources/read', {
      kind,
      sourceId,
      sessionId
    })
    if (conversationId && binding)
      this.assertConversationBinding(conversationId, profile, binding, sessionId)
    else this.assertActiveProfile(profile)
    return result
  }
  async readChatSource(
    conversationId: string,
    citation: Exclude<ChatCitation, StockCitation>
  ): Promise<ChatMemorySourceResult> {
    const profile = this.active()
    const binding = this.state.bindings[conversationId]
    if (
      !profile ||
      !binding ||
      binding.pendingDelete ||
      !binding.sessionId ||
      profile.id !== citation.serviceProfileId ||
      profile.serviceId !== citation.serviceId ||
      profile.userId !== citation.userId ||
      binding.profileId !== profile.id ||
      binding.sessionId !== citation.sessionId
    )
      return { state: 'identity_mismatch', message: '当前记忆身份或会话绑定与该引用不匹配' }
    if (!profile.capabilities?.chatSourceRead)
      return { state: 'unavailable', message: '当前记忆服务不支持聊天来源回读' }
    const sessionId = binding.sessionId
    const selectedLibraries = binding.libraryIds
    const expected = contextUsePayload({ turnId: 'source-read', usage: 'cited', citation })
    try {
      await this.assertIdentity(profile)
      this.assertConversationBinding(conversationId, profile, binding, sessionId)
      const source = await this.request<MemorySourceDetail>(profile, 'POST', '/v1/sources/read', {
        kind: expected.kind,
        sourceId: expected.sourceId,
        sessionId,
        expected
      })
      this.assertConversationBinding(conversationId, profile, binding, sessionId)
      if (binding.libraryIds !== selectedLibraries)
        return { state: 'invalid', message: '当前会话的资料库选择已变化' }
      if (source.evidenceInvalid) return { state: 'invalid', message: '该历史回答的来源证据已失效' }
      return { state: 'available', source }
    } catch (error) {
      if (
        this.active()?.id !== profile.id ||
        this.state.bindings[conversationId] !== binding ||
        binding.pendingDelete
      )
        return { state: 'identity_mismatch', message: '记忆身份或会话绑定已变化' }
      const status =
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined
      if (status === 409) return { state: 'updated', message: '来源已更新，旧引用正文无法读取' }
      if (status === 404 || status === 410 || status === 403 || status === 401)
        return { state: 'invalid', message: '来源已失效或当前会话无权读取' }
      return { state: 'unavailable', message: '记忆服务暂时不可用，请稍后重试' }
    }
  }
  async listLibraries(): Promise<MemoryLibrary[]> {
    const profile = this.active()
    if (!profile) return []
    await this.assertIdentity(profile)
    const result = await this.request<{ libraries: MemoryLibrary[] }>(
      profile,
      'GET',
      '/v1/libraries'
    )
    return result.libraries
  }
  async createLibrary(name: string): Promise<MemoryLibrary> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    return this.request(profile, 'POST', '/v1/libraries', { operationId: randomUUID(), name })
  }
  async renameLibrary(id: string, name: string, expectedRevision: number): Promise<MemoryLibrary> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    return this.request(profile, 'PATCH', `/v1/libraries/${id}`, {
      operationId: randomUUID(),
      expectedRevision,
      name
    })
  }
  async deleteLibrary(id: string, expectedRevision: number): Promise<void> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    await this.request(profile, 'DELETE', `/v1/libraries/${id}`, {
      operationId: randomUUID(),
      expectedRevision
    })
    for (const binding of Object.values(this.state.bindings))
      if (binding.profileId === profile.id)
        binding.libraryIds = (binding.libraryIds ?? []).filter((item) => item !== id)
    this.save()
  }
  async listDocuments(libraryId: string): Promise<MemoryDocument[]> {
    const profile = this.active()
    if (!profile) return []
    await this.assertIdentity(profile)
    const result = await this.request<{ documents: MemoryDocument[] }>(
      profile,
      'GET',
      `/v1/libraries/${libraryId}/documents`
    )
    return result.documents
  }
  async listDocumentJobs(documentId?: string): Promise<MemoryDocumentProcessingJob[]> {
    const profile = this.active()
    if (!profile) return []
    if (!profile.capabilities?.documentJobs) return []
    await this.assertIdentity(profile)
    const result = await this.request<{ jobs: MemoryDocumentProcessingJob[] }>(
      profile,
      'GET',
      `/v1/document-processing-jobs${documentId ? `?documentId=${encodeURIComponent(documentId)}` : ''}`
    )
    this.assertActiveProfile(profile)
    return result.jobs
  }
  async getDocumentJob(jobId: string): Promise<MemoryDocumentProcessingJob> {
    const profile = this.active()
    if (!profile?.capabilities?.documentJobs) throw new Error('当前记忆服务不支持资料处理任务')
    await this.assertIdentity(profile)
    const result = await this.request<MemoryDocumentProcessingJob>(
      profile,
      'GET',
      `/v1/document-processing-jobs/${jobId}`
    )
    this.assertActiveProfile(profile)
    return result
  }
  async createDocumentJob(
    documentId: string,
    versionId: string,
    expectedRevision: number,
    kind: 'reindex' | 'embed' | 'ocr',
    options: { mode?: 'skip' | 'redo'; languages?: string[] } = {}
  ): Promise<MemoryDocumentProcessingJob> {
    const profile = this.active()
    if (!profile?.capabilities?.documentJobs) throw new Error('当前记忆服务不支持资料处理任务')
    await this.assertIdentity(profile)
    const result = await this.request<MemoryDocumentProcessingJob>(
      profile,
      'POST',
      `/v1/documents/${documentId}/versions/${versionId}/processing-jobs`,
      { operationId: randomUUID(), expectedRevision, kind, options }
    )
    this.assertActiveProfile(profile)
    return result
  }
  private async operateDocumentJob(
    jobId: string,
    action: 'retry' | 'cancel',
    expectedJobRevision: number,
    expectedState: MemoryDocumentJobState
  ): Promise<MemoryDocumentProcessingJob> {
    const profile = this.active()
    if (!profile?.capabilities?.documentJobs) throw new Error('当前记忆服务不支持资料处理任务')
    await this.assertIdentity(profile)
    const result = await this.request<MemoryDocumentProcessingJob>(
      profile,
      'POST',
      `/v1/document-processing-jobs/${jobId}/${action}`,
      { operationId: randomUUID(), expectedJobRevision, expectedState }
    )
    this.assertActiveProfile(profile)
    return result
  }
  retryDocumentJob(job: MemoryDocumentProcessingJob): Promise<MemoryDocumentProcessingJob> {
    return this.operateDocumentJob(job.id, 'retry', job.jobRevision, job.state)
  }
  cancelDocumentJob(job: MemoryDocumentProcessingJob): Promise<MemoryDocumentProcessingJob> {
    return this.operateDocumentJob(job.id, 'cancel', job.jobRevision, job.state)
  }
  async publishDocumentJob(
    job: MemoryDocumentProcessingJob,
    options: { allowPartial: boolean; keywordOnly: boolean }
  ): Promise<MemoryDocumentProcessingJob> {
    const profile = this.active()
    if (!profile?.capabilities?.documentJobs) throw new Error('当前记忆服务不支持资料处理任务')
    await this.assertIdentity(profile)
    const result = await this.request<MemoryDocumentProcessingJob>(
      profile,
      'POST',
      `/v1/document-processing-jobs/${job.id}/publish`,
      {
        operationId: randomUUID(),
        expectedJobRevision: job.jobRevision,
        expectedState: job.state,
        ...options
      }
    )
    this.assertActiveProfile(profile)
    return result
  }
  async uploadDocument(
    name: string,
    bytes: ArrayBuffer,
    libraryId: string,
    existing?: { id: string; revision: number },
    requestedOperationId?: string,
    onProgress?: (progress: MemoryUploadProgress) => void
  ): Promise<MemoryDocument> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    const token = this.tokens()[profile.id]
    if (!token) throw new Error('记忆连接令牌不可用')
    const path = existing
      ? `/v1/documents/${existing.id}/versions`
      : `/v1/libraries/${libraryId}/documents`
    this.assertActiveProfile(profile)
    if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024)
      throw new Error('上传文件须为 1 字节至 12 MB')
    const operationId = requestedOperationId ?? randomUUID()
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) throw new Error('上传操作标识无效')
    const result = await uploadBytes(
      new URL(`${profile.url}${path}?name=${encodeURIComponent(name)}`),
      {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
        'x-operation-id': operationId,
        ...(profile.capabilities?.asyncDocumentUpload ? { prefer: 'respond-async' } : {}),
        ...(existing ? { 'x-expected-revision': String(existing.revision) } : {})
      },
      bytes,
      (sentBytes) => {
        this.assertActiveProfile(profile)
        onProgress?.({ operationId, sentBytes, totalBytes: bytes.byteLength })
      }
    )
    this.assertActiveProfile(profile)
    return result
  }
  async publishDocumentKeyword(
    documentId: string,
    versionId: string,
    expectedRevision: number
  ): Promise<MemoryDocument> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    return this.request(
      profile,
      'POST',
      `/v1/documents/${documentId}/versions/${versionId}/publish-keyword`,
      { operationId: randomUUID(), expectedRevision }
    )
  }
  async deleteDocument(id: string, expectedRevision: number): Promise<void> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    await this.request(profile, 'DELETE', `/v1/documents/${id}`, {
      operationId: randomUUID(),
      expectedRevision
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
  async maintenanceStatus(conversationId?: string): Promise<MemoryMaintenanceStatus> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    const binding = conversationId ? this.state.bindings[conversationId] : undefined
    const sessionId =
      binding?.profileId === profile.id && !binding.pendingDelete ? binding.sessionId : undefined
    return this.request(
      profile,
      'GET',
      `/v1/maintenance/status${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`
    )
  }
  async setMaintenanceEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    return this.request(profile, 'PATCH', '/v1/maintenance/settings', {
      operationId: randomUUID(),
      enabled
    })
  }
  async listCandidates(): Promise<MemoryCandidate[]> {
    const profile = this.active()
    if (!profile) return []
    await this.assertIdentity(profile)
    const result = await this.request<{ candidates: MemoryCandidate[] }>(
      profile,
      'GET',
      '/v1/profile/candidates'
    )
    return result.candidates
  }
  async decideCandidate(
    id: string,
    decision: 'approve' | 'reject',
    expectedRevision: number,
    expectedFactRevision?: number
  ): Promise<void> {
    const profile = this.active()
    if (!profile) throw new Error('记忆功能未启用')
    await this.assertIdentity(profile)
    await this.request(profile, 'POST', `/v1/profile/candidates/${id}/decision`, {
      operationId: randomUUID(),
      decision,
      expectedRevision,
      expectedFactRevision
    })
  }
  async retryMaintenance(conversationId: string): Promise<{ queued: boolean }> {
    const profile = this.active()
    const binding = this.state.bindings[conversationId]
    if (
      !profile ||
      !binding ||
      binding.profileId !== profile.id ||
      !binding.sessionId ||
      binding.pendingDelete
    )
      throw new Error('当前会话尚未同步到记忆服务')
    await this.assertIdentity(profile)
    return this.request(profile, 'POST', '/v1/maintenance/retry', {
      operationId: randomUUID(),
      sessionId: binding.sessionId
    })
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
