import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { MarketInsightSnapshot } from '../../market-insight/shared/types'
import {
  AI_LONG_TERM_PROMPT_VERSION,
  AI_PROMPT_VERSION,
  normalizeOpenAiCodexModelId,
  OPENAI_CODEX_DEFAULT_MODEL
} from '../shared/constants'
import type {
  AiChatSendInput,
  AiChatStartResult,
  AiAnalysisProgressEvent,
  AiApiKeyProviderId,
  AiCodexAccountStatus,
  AiConnectionResult,
  AiContextRef,
  AiConversation,
  AiCreateConversationInput,
  AiInterpretation,
  AiInterpretationResult,
  AiLongTermInterpretation,
  AiLongTermInterpretationResult,
  AiMessage,
  AiModuleDependencies,
  AiProvider,
  AiProviderDescriptor,
  AiProviderId,
  AiSettings,
  AiStockMention,
  AiStatus,
  AiStructuredTaskRequest,
  AiStructuredTaskResult
} from '../shared/types'
import {
  compactMarketSnapshot,
  toProviderMessages,
  type AiChatStockContext,
  type CompactMarketSnapshot
} from './conversations/context-builder'
import { createConversationTitle } from './conversations/title-generator'
import { MARKET_INTERPRETATION_PROMPT } from '../prompts/market-interpretation'
import { LONG_TERM_VALUE_PROMPT } from '../prompts/long-term-value'
import { buildLongTermContext, type CompactLongTermContext } from './analysis/long-term-context'
import { parseLongTermInterpretation } from './analysis/long-term-interpretation'
import { DeepSeekProvider } from './providers/deepseek'
import { OpenAiApiProvider } from './providers/openai-api'
import { OpenAiCodexProvider } from './providers/openai-codex'
import { AiSecrets } from './secrets'
import { AiStorage } from './storage'

const PROVIDERS: AiProviderDescriptor[] = [
  {
    id: 'openai',
    label: 'OpenAI API Key',
    billingHint: '使用 OpenAI Platform API 余额，与 ChatGPT/Codex 订阅分开计费。',
    defaultModel: 'gpt-5.6',
    authMode: 'apiKey',
    capabilities: { streaming: true, marketInterpretation: true }
  },
  {
    id: 'openai-codex',
    label: 'OpenAI Codex 账号登录',
    billingHint: '通过官方 Codex 运行时登录 ChatGPT，使用当前账号的 Codex 权限与额度。',
    defaultModel: OPENAI_CODEX_DEFAULT_MODEL,
    authMode: 'codexAccount',
    capabilities: { streaming: true, marketInterpretation: true }
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API Key',
    billingHint: '使用 DeepSeek Platform API Key 和对应平台额度。',
    defaultModel: 'deepseek-v4-flash',
    authMode: 'apiKey',
    capabilities: { streaming: true, marketInterpretation: true }
  }
]

const MAX_MENTIONED_STOCKS = 5

function messageContextRefs(message: AiMessage): AiContextRef[] {
  if (message.contextRefs?.length) return message.contextRefs
  return message.contextRef ? [message.contextRef] : []
}

function uniqueMentions(mentions: readonly AiStockMention[] = []): AiStockMention[] {
  const unique = new Map<string, AiStockMention>()
  for (const mention of mentions) {
    if (!unique.has(mention.quoteId)) unique.set(mention.quoteId, mention)
    if (unique.size === MAX_MENTIONED_STOCKS) break
  }
  return [...unique.values()]
}

function now(): string {
  return new Date().toISOString()
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseInterpretation(content: string, generatedAt: string, snapshot: CompactMarketSnapshot): AiInterpretation {
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('模型没有返回符合要求的解读格式，请重试')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模型解读格式无效，请重试')
  const record = raw as Record<string, unknown>
  const summary = asText(record.summary)
  if (!summary) throw new Error('模型解读缺少摘要，请重试')
  const validSourceIds = new Set(snapshot.news.map((item) => item.id))
  const indicatorFacts = Array.isArray(record.indicatorFacts)
    ? record.indicatorFacts.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const fact = item as Record<string, unknown>
      const name = asText(fact.name)
      const interpretation = asText(fact.interpretation)
      const evidence = Array.isArray(fact.evidence)
        ? fact.evidence.flatMap((entry) => asText(entry) ? [asText(entry) as string] : [])
        : []
      return name && interpretation ? [{ name, interpretation, evidence }] : []
    })
    : []
  const newsReferences = Array.isArray(record.newsReferences)
    ? record.newsReferences.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const reference = item as Record<string, unknown>
      const sourceId = asText(reference.sourceId)
      const relevance = asText(reference.relevance)
      const itemSummary = asText(reference.summary)
      return sourceId && relevance && itemSummary && validSourceIds.has(sourceId)
        ? [{ sourceId, relevance, summary: itemSummary }]
        : []
    })
    : []
  const uncertainties = Array.isArray(record.uncertainties)
    ? record.uncertainties.flatMap((item) => asText(item) ? [asText(item) as string] : [])
    : []
  return { summary, indicatorFacts, newsReferences, uncertainties, generatedAt }
}

export class AiService {
  private readonly secrets: AiSecrets
  private readonly codexProvider: OpenAiCodexProvider
  private readonly providers: Map<string, AiProvider>
  private readonly activeChats = new Map<string, AbortController>()

  constructor(
    private readonly storage: AiStorage,
    private readonly dependencies: AiModuleDependencies,
    private readonly send: (webContents: WebContents, channel: string, payload: unknown) => void
  ) {
    this.secrets = new AiSecrets(storage.rootDirectory)
    this.codexProvider = new OpenAiCodexProvider(storage.rootDirectory)
    this.providers = new Map<string, AiProvider>([
      ['openai', new OpenAiApiProvider()],
      ['openai-codex', this.codexProvider],
      ['deepseek', new DeepSeekProvider()]
    ])
  }

  async getStatus(): Promise<AiStatus> {
    const settings = this.storage.getSettings()
    return {
      enabled: settings.enabled,
      providers: PROVIDERS,
      credentials: {
        openai: this.secrets.getStatus('openai'),
        deepseek: this.secrets.getStatus('deepseek')
      },
      codexAccount: await this.codexProvider.getAccountStatus()
    }
  }

  getSettings(): AiSettings {
    return this.storage.getSettings()
  }

  saveSettings(input: AiSettings): AiSettings {
    const provider = PROVIDERS.find((item) => item.id === input.providerId)
    if (!provider) throw new Error('不支持的 AI Provider')
    const settings: AiSettings = {
      enabled: input.enabled,
      providerId: input.providerId,
      model: input.providerId === 'openai-codex'
        ? normalizeOpenAiCodexModelId(input.model.trim() || provider.defaultModel)
        : input.model.trim() || provider.defaultModel,
      maxContextMessages: Math.max(4, Math.min(40, Math.round(input.maxContextMessages)))
    }
    const saved = this.storage.saveSettings(settings)
    if (!saved.enabled) {
      for (const controller of this.activeChats.values()) controller.abort()
    }
    return saved
  }

  setCredential(providerId: AiApiKeyProviderId, apiKey: string) {
    this.requireProvider(providerId)
    return this.secrets.set(providerId, apiKey)
  }

  clearCredential(providerId: AiApiKeyProviderId): void {
    this.requireProvider(providerId)
    this.secrets.clear(providerId)
  }

  loginCodexAccount(): Promise<AiCodexAccountStatus> {
    return this.codexProvider.login()
  }

  logoutCodexAccount(): Promise<AiCodexAccountStatus> {
    return this.codexProvider.logout()
  }

  async testConnection(providerId: AiProviderId): Promise<AiConnectionResult> {
    return this.requireProvider(providerId).testConnection(this.getCredential(providerId))
  }

  listConversations(query?: string): AiConversation[] {
    const normalizedQuery = query?.trim().toLocaleLowerCase()
    if (!normalizedQuery) return this.storage.listConversations()
    return this.storage.listConversations().filter((conversation) => (
      conversation.title.toLocaleLowerCase().includes(normalizedQuery)
      || this.storage.getMessages(conversation.id).some((message) => message.content.toLocaleLowerCase().includes(normalizedQuery))
    ))
  }

  getConversation(conversationId: string): { conversation: AiConversation; messages: AiMessage[] } | null {
    const conversation = this.storage.getConversation(conversationId)
    return conversation ? { conversation, messages: this.storage.getMessages(conversationId) } : null
  }

  createConversation(input: AiCreateConversationInput = {}): AiConversation {
    const settings = this.storage.getSettings()
    const createdAt = now()
    const conversation: AiConversation = {
      id: randomUUID(),
      title: input.scope === 'stock' && input.quoteName ? `${input.quoteName} · AI 对话` : '新对话',
      scope: input.scope === 'stock' ? 'stock' : 'general',
      quoteId: input.scope === 'stock' ? input.quoteId : undefined,
      quoteName: input.scope === 'stock' ? input.quoteName : undefined,
      createdAt,
      updatedAt: createdAt,
      providerId: settings.providerId,
      model: settings.model,
      messageCount: 0
    }
    return this.storage.saveConversation(conversation)
  }

  renameConversation(conversationId: string, title: string): AiConversation {
    const conversation = this.requireConversation(conversationId)
    const nextTitle = title.trim()
    if (!nextTitle) throw new Error('会话标题不能为空')
    return this.storage.saveConversation({ ...conversation, title: nextTitle.slice(0, 80), updatedAt: now() })
  }

  deleteConversation(conversationId: string): void {
    this.activeChats.get(conversationId)?.abort()
    this.storage.deleteConversation(conversationId)
  }

  clearConversations(): void {
    for (const controller of this.activeChats.values()) controller.abort()
    this.storage.clearConversations()
  }

  exportConversation(conversationId: string) {
    return this.storage.exportConversation(conversationId)
  }

  exportAllConversations() {
    return this.storage.listConversations().map((conversation) => this.storage.exportConversation(conversation.id))
  }

  async sendChat(webContents: WebContents, input: AiChatSendInput): Promise<AiChatStartResult> {
    const settings = this.storage.getSettings()
    if (!settings.enabled) throw new Error('AI 助手当前已关闭')
    const conversation = this.requireConversation(input.conversationId)
    const content = input.content.trim()
    if (!content) throw new Error('请输入消息')
    if (this.activeChats.has(conversation.id)) throw new Error('当前会话正在生成，请先停止')

    const contexts = await this.getConversationContexts(
      conversation,
      input.includeStockContext !== false,
      uniqueMentions(input.mentionedStocks)
    )
    const contextRefs: AiContextRef[] = contexts.map((context) => ({
      quoteId: context.snapshot.quoteId,
      quoteName: context.quoteName,
      code: context.code,
      marketLabel: context.marketLabel,
      snapshotId: context.snapshot.snapshotId,
      source: context.source
    }))
    const createdAt = now()
    const userMessage: AiMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user',
      content,
      status: 'completed',
      createdAt,
      contextRefs: contextRefs.length > 0 ? contextRefs : undefined
    }
    const assistantMessage: AiMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      status: 'pending',
      createdAt,
      providerId: settings.providerId,
      model: settings.model,
      contextRefs: userMessage.contextRefs
    }
    this.storage.appendMessage(userMessage)
    this.storage.saveConversation({
      ...conversation,
      title: conversation.title === '新对话' ? createConversationTitle(content) : conversation.title,
      updatedAt: createdAt,
      providerId: settings.providerId,
      model: settings.model,
      messageCount: conversation.messageCount + 1
    })

    void this.runChat(webContents, assistantMessage, contexts)
    return { userMessage, assistantMessage }
  }

  async cancelChat(conversationId: string): Promise<void> {
    this.activeChats.get(conversationId)?.abort()
  }

  async retryChat(webContents: WebContents, conversationId: string, messageId: string): Promise<AiChatStartResult> {
    const messages = this.storage.getMessages(conversationId)
    const messageIndex = messages.findIndex((message) => message.id === messageId)
    if (messageIndex === -1) throw new Error('未找到要重试的消息')
    const userMessage = [...messages.slice(0, messageIndex)].reverse().find((message) => message.role === 'user')
    if (!userMessage) throw new Error('未找到可重试的提问')
    const conversation = this.requireConversation(conversationId)
    const contextRefs = messageContextRefs(userMessage)
    return this.sendChat(webContents, {
      conversationId,
      content: userMessage.content,
      includeStockContext: contextRefs.some((context) => (
        context.source === 'conversation'
        || (!context.source && conversation.scope === 'stock' && context.quoteId === conversation.quoteId)
      )),
      mentionedStocks: contextRefs
        .filter((context) => context.source === 'mention')
        .map((context) => ({
          quoteId: context.quoteId,
          code: context.code ?? '',
          name: context.quoteName ?? context.quoteId,
          marketLabel: context.marketLabel ?? ''
        }))
    })
  }

  async interpret(
    quoteId: string,
    onProgress: (progress: AiAnalysisProgressEvent) => void = () => undefined
  ): Promise<AiInterpretationResult> {
    const report = (phase: AiAnalysisProgressEvent['phase'], message: string, detail: string) => {
      onProgress({ quoteId, analysisType: 'short-term', phase, message, detail, updatedAt: now() })
    }
    report('preparing', '正在检查 AI 配置', '确认功能开关、模型与账号凭据。')
    const settings = this.storage.getSettings()
    if (!settings.enabled) throw new Error('AI 助手当前已关闭')
    const credential = this.getCredential(settings.providerId)
    report('loading-snapshot', '正在读取市场观察快照', '加载当前股票的指标、新闻、客观观察事件与最后一次筹码分布。')
    const snapshot = await this.dependencies.getMarketInsightSnapshot(quoteId)
    if (!snapshot) throw new Error('当前还没有可解读的市场观察快照，请先打开市场观察并刷新')
    const compact = this.persistCompactSnapshot(snapshot)
    const cacheKey = `${compact.snapshotId}:${settings.providerId}:${settings.model}:${AI_PROMPT_VERSION}`
    report('checking-cache', '正在检查已有分析', '相同快照和模型已有结果时将直接使用本地缓存。')
    const cached = this.storage.getInterpretation<AiInterpretation>(cacheKey)
    const sources = compact.news.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url
    }))
    if (cached) {
      const cachedResult: AiInterpretationResult = {
        snapshotId: compact.snapshotId,
        snapshotGeneratedAt: compact.generatedAt,
        interpretation: cached,
        cached: true,
        sources
      }
      this.storage.saveLatestInterpretation(quoteId, cachedResult)
      return cachedResult
    }
    const provider = this.requireProvider(settings.providerId)
    const controller = new AbortController()
    report('analyzing', 'AI 正在生成快照解读', `正在调用 ${settings.model} 分析指标、新闻、观察事件与筹码分布。`)
    const result = await provider.streamChat(credential, {
      model: settings.model,
      messages: [
        { role: 'system', content: MARKET_INTERPRETATION_PROMPT },
        { role: 'user', content: JSON.stringify(compact) }
      ]
    }, () => undefined, controller.signal)
    report('validating', 'AI 已返回，正在校验结果', '检查解读结构、引用来源并保存本次结果。')
    const interpretation = parseInterpretation(result.content, now(), compact)
    this.storage.saveInterpretation(cacheKey, interpretation)
    const interpretationResult: AiInterpretationResult = {
      snapshotId: compact.snapshotId,
      snapshotGeneratedAt: compact.generatedAt,
      interpretation,
      cached: false,
      sources
    }
    this.storage.saveLatestInterpretation(quoteId, interpretationResult)
    return interpretationResult
  }

  getLatestInterpretation(quoteId: string): AiInterpretationResult | null {
    return this.storage.getLatestInterpretation<AiInterpretationResult>(quoteId)
  }

  async interpretLongTerm(
    quoteId: string,
    onProgress: (progress: AiAnalysisProgressEvent) => void = () => undefined
  ): Promise<AiLongTermInterpretationResult> {
    const report = (phase: AiAnalysisProgressEvent['phase'], message: string, detail: string) => {
      onProgress({ quoteId, analysisType: 'long-term', phase, message, detail, updatedAt: now() })
    }
    report('preparing', '正在检查 AI 配置', '确认功能开关、模型与账号凭据。')
    const settings = this.storage.getSettings()
    if (!settings.enabled) throw new Error('AI 助手当前已关闭')
    const credential = this.getCredential(settings.providerId)
    report('loading-snapshot', '正在读取长期价值数据', '加载五年财务、分红融资、当前估值和长期价格强弱。')
    const fundamentalSnapshot = this.dependencies.getFundamentalSnapshot()
    const dividendSnapshot = this.dependencies.getDividendFinancingSnapshot()
    if (!fundamentalSnapshot && !dividendSnapshot) {
      throw new Error('当前还没有基本面或分红融资快照，长期价值分析暂不可用')
    }
    let dailyKline = null
    try {
      dailyKline = await this.dependencies.getDailyKline(quoteId, 270)
    } catch {
      dailyKline = null
    }
    const context: CompactLongTermContext = buildLongTermContext({
      quoteId,
      quote: this.dependencies.getLatestQuote(quoteId),
      dailyKline,
      fundamentalSnapshot,
      fundamentalState: this.dependencies.getFundamentalState(),
      dividendSnapshot,
      dividendState: this.dependencies.getDividendFinancingState(),
      generatedAt: now()
    })
    this.storage.saveSnapshot(context.snapshotId, context)
    const cacheKey = `${context.snapshotId}:${settings.providerId}:${settings.model}:${AI_LONG_TERM_PROMPT_VERSION}`
    report('checking-cache', '正在检查长期分析缓存', '财务、估值和价格强弱均相同时直接使用本地结果。')
    const cached = this.storage.getInterpretation<AiLongTermInterpretation>(cacheKey)
    if (cached) {
      const cachedResult: AiLongTermInterpretationResult = {
        snapshotId: context.snapshotId,
        generatedAt: context.generatedAt,
        fundamentalSnapshotDate: context.fundamental.snapshotDate,
        dividendSnapshotDate: context.dividendFinancing.snapshotDate,
        priceDataAt: context.priceStrength.dataAt,
        interpretation: cached,
        cached: true
      }
      this.storage.saveLatestInterpretation(`${quoteId}:long-term`, cachedResult)
      return cachedResult
    }
    const provider = this.requireProvider(settings.providerId)
    const controller = new AbortController()
    report('analyzing', 'AI 正在分析长期价值', `正在调用 ${settings.model} 分析经营质量、估值与价格时机。`)
    const result = await provider.streamChat(credential, {
      model: settings.model,
      messages: [
        { role: 'system', content: LONG_TERM_VALUE_PROMPT },
        { role: 'user', content: JSON.stringify(context) }
      ]
    }, () => undefined, controller.signal)
    report('validating', 'AI 已返回，正在校验结果', '检查长期价值维度、证据和风险边界并保存结果。')
    const interpretation = parseLongTermInterpretation(result.content, now())
    this.storage.saveInterpretation(cacheKey, interpretation)
    const interpretationResult: AiLongTermInterpretationResult = {
      snapshotId: context.snapshotId,
      generatedAt: context.generatedAt,
      fundamentalSnapshotDate: context.fundamental.snapshotDate,
      dividendSnapshotDate: context.dividendFinancing.snapshotDate,
      priceDataAt: context.priceStrength.dataAt,
      interpretation,
      cached: false
    }
    this.storage.saveLatestInterpretation(`${quoteId}:long-term`, interpretationResult)
    return interpretationResult
  }

  getLatestLongTermInterpretation(quoteId: string): AiLongTermInterpretationResult | null {
    return this.storage.getLatestInterpretation<AiLongTermInterpretationResult>(`${quoteId}:long-term`)
  }

  async runStructuredTask(
    request: AiStructuredTaskRequest,
    signal: AbortSignal
  ): Promise<AiStructuredTaskResult> {
    const settings = this.storage.getSettings()
    if (!settings.enabled) throw new Error('AI 助手当前已关闭')
    const result = await this.requireProvider(settings.providerId).streamChat(
      this.getCredential(settings.providerId),
      {
        model: settings.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userContent }
        ]
      },
      () => undefined,
      signal
    )
    return {
      ...result,
      providerId: settings.providerId,
      model: settings.model
    }
  }

  dispose(): void {
    for (const controller of this.activeChats.values()) controller.abort()
    this.activeChats.clear()
    this.codexProvider.dispose()
  }

  private async runChat(
    webContents: WebContents,
    pendingMessage: AiMessage,
    contexts: AiChatStockContext[]
  ): Promise<void> {
    const settings = this.storage.getSettings()
    const controller = new AbortController()
    this.activeChats.set(pendingMessage.conversationId, controller)
    let streamedContent = ''
    try {
      const credential = this.getCredential(settings.providerId)
      const messages = this.storage.getMessages(pendingMessage.conversationId).slice(-settings.maxContextMessages)
      const result = await this.requireProvider(settings.providerId).streamChat(credential, {
        model: settings.model,
        messages: toProviderMessages(messages, contexts)
      }, (delta) => {
        streamedContent = `${streamedContent}${delta}`
        this.send(webContents, 'ai:chat:delta', {
          conversationId: pendingMessage.conversationId,
          messageId: pendingMessage.id,
          delta
        })
      }, controller.signal)
      const content = result.content.trim() || '模型未返回可显示的内容。'
      this.completeMessage(webContents, {
        ...pendingMessage,
        content,
        status: 'completed',
        providerResponseId: result.responseId
      })
    } catch (error) {
      const stopped = isAbortError(error, controller.signal)
      const message: AiMessage = {
        ...pendingMessage,
        content: streamedContent || (stopped ? '已停止生成。' : ''),
        status: stopped ? 'stopped' : 'error',
        errorMessage: stopped ? undefined : error instanceof Error ? error.message : 'AI 生成失败'
      }
      this.storage.appendMessage(message)
      this.touchConversation(message.conversationId)
      this.send(webContents, 'ai:chat:error', { conversationId: message.conversationId, message })
    } finally {
      if (this.activeChats.get(pendingMessage.conversationId) === controller) {
        this.activeChats.delete(pendingMessage.conversationId)
      }
    }
  }

  private completeMessage(webContents: WebContents, message: AiMessage): void {
    this.storage.appendMessage(message)
    this.touchConversation(message.conversationId)
    this.send(webContents, 'ai:chat:completed', { conversationId: message.conversationId, message })
  }

  private touchConversation(conversationId: string): void {
    const conversation = this.storage.getConversation(conversationId)
    if (!conversation) return
    this.storage.saveConversation({ ...conversation, updatedAt: now(), messageCount: conversation.messageCount + 1 })
  }

  private async getConversationContexts(
    conversation: AiConversation,
    includeStockContext: boolean,
    mentionedStocks: AiStockMention[]
  ): Promise<AiChatStockContext[]> {
    const requested = new Map<string, {
      source: AiChatStockContext['source']
      quoteId: string
      quoteName?: string
      code?: string
      marketLabel?: string
    }>()
    if (includeStockContext && conversation.scope === 'stock' && conversation.quoteId) {
      requested.set(conversation.quoteId, {
        source: 'conversation',
        quoteId: conversation.quoteId,
        quoteName: conversation.quoteName
      })
    }
    for (const stock of mentionedStocks) {
      requested.set(stock.quoteId, {
        source: 'mention',
        quoteId: stock.quoteId,
        quoteName: stock.name,
        code: stock.code,
        marketLabel: stock.marketLabel
      })
    }

    const contexts = await Promise.all([...requested.values()].map(async (request): Promise<AiChatStockContext | null> => {
      let snapshot = await this.dependencies.getMarketInsightSnapshot(request.quoteId)
      if (!snapshot && request.source === 'mention') {
        snapshot = await this.dependencies.refreshMarketInsightSnapshot(request.quoteId)
      }
      if (!snapshot) {
        if (request.source === 'mention') throw new Error(`暂时无法取得 @${request.quoteName ?? request.quoteId} 的市场快照`)
        return null
      }
      return {
        source: request.source,
        quoteName: request.quoteName,
        code: request.code,
        marketLabel: request.marketLabel,
        snapshot: this.persistCompactSnapshot(snapshot)
      }
    }))
    return contexts.filter((context): context is AiChatStockContext => context !== null)
  }

  private persistCompactSnapshot(snapshot: MarketInsightSnapshot): CompactMarketSnapshot {
    const compact = compactMarketSnapshot(
      snapshot,
      this.dependencies.getChipDistributionCache(snapshot.quoteId)
    )
    this.storage.saveSnapshot(compact.snapshotId, compact)
    return compact
  }

  private requireConversation(conversationId: string): AiConversation {
    const conversation = this.storage.getConversation(conversationId)
    if (!conversation) throw new Error('未找到对话')
    return conversation
  }

  private requireProvider(providerId: string): AiProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error('不支持的 AI Provider')
    return provider
  }

  private getCredential(providerId: AiProviderId): string | undefined {
    return providerId === 'openai-codex' ? undefined : this.secrets.get(providerId) ?? undefined
  }
}
