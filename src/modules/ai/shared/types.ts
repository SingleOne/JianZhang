import type { MarketInsightSnapshot } from '../../market-insight/shared/types'
import type {
  AppState,
  ChipDistributionCacheEntry,
  CompanyReportLibraryResult,
  CompanyReportSummary,
  CorporateActionListResult,
  DailyMarketScanResult,
  DataSnapshotRuntimeState,
  DividendFinancingSnapshot,
  FundsFlowResult,
  FundamentalSnapshot,
  GlobalFundamentalSnapshot,
  KlinePeriod,
  KlineResult,
  SectorIndexResult,
  ShareholderSnapshot,
  StockOrderBook,
  StockQuote,
  StockValuationHistory
} from '../../../shared/types'

export const AI_PROVIDER_IDS = [
  'openai',
  'deepseek',
  'zhipu',
  'kimi',
  'minimax',
  'hunyuan',
  'ernie',
  'qwen',
  'mimo',
  'grok',
  'gemini',
  'anthropic'
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export type AiApiKeyProviderId = AiProviderId
export type AiMessageRole = 'user' | 'assistant' | 'system'
export type AiMessageStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'error'

export interface AiProviderCapabilities {
  streaming: boolean
  marketInterpretation: boolean
  stockDataTools: boolean
}

export interface AiProviderDescriptor {
  id: AiProviderId
  label: string
  billingHint: string
  defaultModel: string
  authMode: 'apiKey'
  capabilities: AiProviderCapabilities
}

export interface AiCredentialStatus {
  configured: boolean
  maskedSuffix?: string
}

export interface AiModelOption {
  id: string
  label: string
}

export interface AiCredentialSaveResult {
  credential: AiCredentialStatus
  models: AiModelOption[]
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
  datasetIds?: string[]
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

export type AiLongTermSectionId = 'enterpriseQuality' | 'financialSafety' | 'currentPrice'

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
  'preparing' | 'loading-snapshot' | 'checking-cache' | 'analyzing' | 'validating'

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
  setCredential: (providerId: AiApiKeyProviderId, apiKey: string) => Promise<AiCredentialSaveResult>
  clearCredential: (providerId: AiApiKeyProviderId) => Promise<void>
  listModels: (providerId: AiProviderId) => Promise<AiModelOption[]>
  testConnection: (providerId: AiProviderId) => Promise<AiConnectionResult>
  listConversations: (query?: string) => Promise<AiConversation[]>
  getConversation: (
    conversationId: string
  ) => Promise<{ conversation: AiConversation; messages: AiMessage[] } | null>
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
  getLatestLongTermInterpretation: (
    quoteId: string
  ) => Promise<AiLongTermInterpretationResult | null>
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
  tools?: AiProviderTool[]
}

export interface AiProviderTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AiProviderToolCall {
  id: string
  name: string
  arguments: string
}

export type AiProviderToolExecutor = (
  call: AiProviderToolCall,
  signal: AbortSignal
) => Promise<string>

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
  listModels: (credential?: string) => Promise<AiModelOption[]>
  testConnection: (credential?: string) => Promise<AiConnectionResult>
  streamChat: (
    credential: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal,
    executeTool?: AiProviderToolExecutor
  ) => Promise<AiProviderTurnResult>
}

export interface AiModuleDependencies {
  getState: () => AppState
  getMarketInsightSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null> | null
  refreshMarketInsightSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null> | null
  getChipDistributionCache: (quoteId: string) => ChipDistributionCacheEntry | null
  getLatestQuote: (quoteId: string) => StockQuote | null
  getDailyKline: (quoteId: string, limit: number) => Promise<KlineResult>
  getKline: (quoteId: string, period: KlinePeriod, limit?: number) => Promise<KlineResult>
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  getSectorIndex: (quoteId: string) => Promise<SectorIndexResult>
  getDailyMarketScanResult: () => DailyMarketScanResult | null
  getValuationHistory: (quoteId: string) => Promise<StockValuationHistory>
  getFundamentalSnapshot: () => Promise<FundamentalSnapshot | null>
  getFundamentalState: () => DataSnapshotRuntimeState
  getDividendFinancingSnapshot: () => Promise<DividendFinancingSnapshot | null>
  getDividendFinancingState: () => DataSnapshotRuntimeState
  getCompanyReportSummaries: (code: string) => CompanyReportSummary[]
  getCompanyReports: (quoteId: string) => Promise<CompanyReportLibraryResult>
  getGlobalFundamentals: (quoteId: string) => Promise<GlobalFundamentalSnapshot>
  getShareholderSnapshot: (quoteId: string) => Promise<ShareholderSnapshot>
  listCorporateActions: (quoteId: string) => Promise<CorporateActionListResult>
}

declare global {
  interface Window {
    aiApi?: AiApi
  }
}

export {}
