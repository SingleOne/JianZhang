import type { MarketInsightSnapshot } from '../../market-insight/shared/types'
import type {
  ChipDistributionCacheEntry,
  CompanyReportSummary,
  DataSnapshotRuntimeState,
  DividendFinancingSnapshot,
  FundamentalSnapshot,
  KlineResult,
  StockQuote,
  StockValuationHistory
} from '../../../shared/types'

export type AiProviderId = 'openai' | 'openai-codex' | 'deepseek'
export type AiApiKeyProviderId = Exclude<AiProviderId, 'openai-codex'>
export type AiMessageRole = 'user' | 'assistant' | 'system'
export type AiMessageStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'error'

export interface AiProviderCapabilities {
  streaming: boolean
  marketInterpretation: boolean
}

export interface AiProviderDescriptor {
  id: AiProviderId
  label: string
  billingHint: string
  defaultModel: string
  authMode: 'apiKey' | 'codexAccount'
  capabilities: AiProviderCapabilities
}

export interface AiCredentialStatus {
  configured: boolean
  maskedSuffix?: string
}

export interface AiCodexAccountStatus {
  runtimeAvailable: boolean
  loggedIn: boolean
  email?: string
  planType?: string
  message?: string
}

export interface AiSettings {
  enabled: boolean
  providerId: AiProviderId
  model: string
  maxContextMessages: number
}

export interface AiStatus {
  enabled: boolean
  providers: AiProviderDescriptor[]
  credentials: Record<AiApiKeyProviderId, AiCredentialStatus>
  codexAccount: AiCodexAccountStatus
}

export interface AiConnectionResult {
  ok: boolean
  kind: 'success' | 'authentication' | 'rate_limit' | 'network' | 'provider'
  message: string
}

export interface AiConversation {
  id: string
  title: string
  scope: 'general' | 'stock'
  quoteId?: string
  quoteName?: string
  createdAt: string
  updatedAt: string
  providerId: AiProviderId
  model: string
  messageCount: number
}

export interface AiContextRef {
  quoteId: string
  quoteName?: string
  code?: string
  marketLabel?: string
  snapshotId: string
  source?: 'conversation' | 'mention'
}

export interface AiStockMention {
  quoteId: string
  code: string
  name: string
  marketLabel: string
}

export interface AiMessage {
  id: string
  conversationId: string
  role: AiMessageRole
  content: string
  status: AiMessageStatus
  createdAt: string
  providerId?: AiProviderId
  model?: string
  providerResponseId?: string
  contextRef?: AiContextRef
  contextRefs?: AiContextRef[]
  sourceIds?: string[]
  errorMessage?: string
}

export interface AiCreateConversationInput {
  scope?: AiConversation['scope']
  quoteId?: string
  quoteName?: string
}

export interface AiChatSendInput {
  conversationId: string
  content: string
  includeStockContext?: boolean
  mentionedStocks?: AiStockMention[]
}

export interface AiChatStartResult {
  userMessage: AiMessage
  assistantMessage: AiMessage
}

export interface AiChatDeltaEvent {
  conversationId: string
  messageId: string
  delta: string
}

export interface AiChatCompletedEvent {
  conversationId: string
  message: AiMessage
}

export interface AiChatErrorEvent {
  conversationId: string
  message: AiMessage
}

export interface AiConversationExport {
  conversation: AiConversation
  messages: AiMessage[]
  exportedAt: string
}

export interface AiInterpretation {
  summary: string
  indicatorFacts: Array<{
    name: string
    interpretation: string
    evidence: string[]
  }>
  newsReferences: Array<{
    sourceId: string
    relevance: string
    summary: string
  }>
  uncertainties: string[]
  generatedAt: string
}

export interface AiInterpretationResult {
  snapshotId: string
  snapshotGeneratedAt: string
  interpretation: AiInterpretation
  cached: boolean
  sources: Array<{
    id: string
    title: string
    source: string
    publishedAt: string
    url: string
  }>
}

export type AiLongTermDimensionId =
  | 'businessQuality'
  | 'cashFlow'
  | 'capitalEfficiency'
  | 'balanceSheet'
  | 'valuation'
  | 'shareholderReturn'
  | 'priceTiming'

export type AiLongTermSectionId =
  | 'enterpriseQuality'
  | 'financialSafety'
  | 'currentPrice'

export type AiLongTermValueLevel = 'high' | 'medium' | 'low' | 'insufficient'
export type AiLongTermPriceTimingLevel = 'favorable' | 'neutral' | 'unfavorable' | 'insufficient'

export interface AiLongTermInterpretation {
  summary: string
  sections: Array<{
    id: AiLongTermSectionId
    conclusion: string
    evidence: string[]
  }>
  conclusion: {
    longTermValue: {
      level: AiLongTermValueLevel
      reason: string
    }
    priceTiming: {
      level: AiLongTermPriceTimingLevel
      reason: string
    }
  }
  dimensions?: Array<{
    id: AiLongTermDimensionId
    conclusion: string
    evidence: string[]
  }>
  risks: string[]
  uncertainties: string[]
  generatedAt: string
}

export interface AiLongTermInterpretationResult {
  snapshotId: string
  generatedAt: string
  fundamentalSnapshotDate: string | null
  fundamentalReportDate: string | null
  fundamentalGeneratedAt: string | null
  fundamentalFiscalYears: number[]
  dividendSnapshotDate: string | null
  priceDataAt: string | null
  valuationHistoryPeriodStart: string | null
  valuationHistoryPeriodEnd: string | null
  valuationIndustryDataAt: string | null
  interpretation: AiLongTermInterpretation
  cached: boolean
}

export type AiAnalysisType = 'short-term' | 'long-term'

export type AiAnalysisProgressPhase =
  | 'preparing'
  | 'loading-snapshot'
  | 'checking-cache'
  | 'analyzing'
  | 'validating'

export interface AiAnalysisProgressEvent {
  quoteId: string
  analysisType: AiAnalysisType
  phase: AiAnalysisProgressPhase
  message: string
  detail: string
  updatedAt: string
}

export interface AiApi {
  getStatus: () => Promise<AiStatus>
  getSettings: () => Promise<AiSettings>
  saveSettings: (settings: AiSettings) => Promise<AiSettings>
  setCredential: (providerId: AiApiKeyProviderId, apiKey: string) => Promise<AiCredentialStatus>
  clearCredential: (providerId: AiApiKeyProviderId) => Promise<void>
  loginCodexAccount: () => Promise<AiCodexAccountStatus>
  logoutCodexAccount: () => Promise<AiCodexAccountStatus>
  testConnection: (providerId: AiProviderId) => Promise<AiConnectionResult>
  listConversations: (query?: string) => Promise<AiConversation[]>
  getConversation: (conversationId: string) => Promise<{ conversation: AiConversation; messages: AiMessage[] } | null>
  createConversation: (input?: AiCreateConversationInput) => Promise<AiConversation>
  renameConversation: (conversationId: string, title: string) => Promise<AiConversation>
  deleteConversation: (conversationId: string) => Promise<void>
  clearConversations: () => Promise<void>
  exportConversation: (conversationId: string) => Promise<AiConversationExport>
  exportAllConversations: () => Promise<AiConversationExport[]>
  sendChat: (input: AiChatSendInput) => Promise<AiChatStartResult>
  cancelChat: (conversationId: string) => Promise<void>
  retryChat: (conversationId: string, messageId: string) => Promise<AiChatStartResult>
  getLatestInterpretation: (quoteId: string) => Promise<AiInterpretationResult | null>
  interpret: (quoteId: string) => Promise<AiInterpretationResult>
  getLatestLongTermInterpretation: (quoteId: string) => Promise<AiLongTermInterpretationResult | null>
  interpretLongTerm: (quoteId: string) => Promise<AiLongTermInterpretationResult>
  onAnalysisProgress: (listener: (event: AiAnalysisProgressEvent) => void) => () => void
  onChatDelta: (listener: (event: AiChatDeltaEvent) => void) => () => void
  onChatCompleted: (listener: (event: AiChatCompletedEvent) => void) => () => void
  onChatError: (listener: (event: AiChatErrorEvent) => void) => () => void
}

export interface AiProviderRequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiProviderRequest {
  model: string
  messages: AiProviderRequestMessage[]
}

export interface AiProviderTurnResult {
  responseId?: string
  content: string
}

export interface AiStructuredTaskRequest {
  systemPrompt: string
  userContent: string
}

export interface AiStructuredTaskResult extends AiProviderTurnResult {
  providerId: AiProviderId
  model: string
}

export interface AiProvider {
  readonly id: AiProviderId
  getCapabilities: () => AiProviderCapabilities
  testConnection: (credential?: string) => Promise<AiConnectionResult>
  streamChat: (
    credential: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal
  ) => Promise<AiProviderTurnResult>
}

export interface AiModuleDependencies {
  getMarketInsightSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null> | null
  refreshMarketInsightSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null> | null
  getChipDistributionCache: (quoteId: string) => ChipDistributionCacheEntry | null
  getLatestQuote: (quoteId: string) => StockQuote | null
  getDailyKline: (quoteId: string, limit: number) => Promise<KlineResult>
  getValuationHistory: (quoteId: string) => Promise<StockValuationHistory>
  getFundamentalSnapshot: () => FundamentalSnapshot | null
  getFundamentalState: () => DataSnapshotRuntimeState
  getDividendFinancingSnapshot: () => DividendFinancingSnapshot | null
  getDividendFinancingState: () => DataSnapshotRuntimeState
  getCompanyReportSummaries: (code: string) => CompanyReportSummary[]
}

declare global {
  interface Window {
    aiApi?: AiApi
  }
}

export {}
