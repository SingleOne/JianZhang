import type { StockPosition, StockQuote, TTradingAccount, WatchStock } from '../../../shared/types'

export type AiTAdviceAction = 'hold' | 'forward-t' | 'reverse-t'
export type AiTAdviceConfidence = 'low' | 'medium' | 'high'
export type AiTAdviceRecordStatus = 'active' | 'dismissed'

export interface AiTAdviceSettings {
  enabled: boolean
}

export interface AiTAdviceStatus {
  enabled: boolean
  generatingQuoteIds: string[]
  message: string
}

export type AiTAdviceProgressPhase =
  'preparing' | 'refreshing-snapshot' | 'waiting-order-book' | 'analyzing' | 'validating'

export interface AiTAdviceProgressEvent {
  accountId?: string
  quoteId: string
  phase: AiTAdviceProgressPhase
  message: string
  detail: string
  attempt?: number
  updatedAt: string
}

export interface AiTAdvice {
  accountId?: string
  accountName?: string
  id: string
  quoteId: string
  quoteName: string
  action: AiTAdviceAction
  rationale: string[]
  priceZone?: {
    lower: number
    upper: number
  }
  quantity?: number
  invalidationPrice?: number
  risks: string[]
  confidence: AiTAdviceConfidence
  sourceSnapshotId: string
  snapshotGeneratedAt: string
  snapshotDataState?: 'live' | 'cached' | 'stale'
  snapshotStaleSources?: string[]
  generatedAt: string
  providerId: string
  model: string
  status: AiTAdviceRecordStatus
  resolvedAt?: string
}

export interface AiTAdviceGenerationResult {
  advice: AiTAdvice
}

export interface AiTAdviceTradingContext {
  feeSettings?: import('../../../shared/types').AccountFeeSettings
  stock: WatchStock
  quote?: StockQuote
  position?: StockPosition
  account?: TTradingAccount
}

export interface AiTAdviceApi {
  getStatus: () => Promise<AiTAdviceStatus>
  getSettings: () => Promise<AiTAdviceSettings>
  saveSettings: (settings: AiTAdviceSettings) => Promise<AiTAdviceSettings>
  generate: (quoteId: string, accountId?: string) => Promise<AiTAdviceGenerationResult>
  cancel: (quoteId: string, accountId?: string) => Promise<void>
  listHistory: (quoteId: string, accountId?: string) => Promise<AiTAdvice[]>
  dismiss: (adviceId: string) => Promise<AiTAdvice>
  onProgress: (listener: (event: AiTAdviceProgressEvent) => void) => () => void
}

declare global {
  interface Window {
    aiTAdviceApi?: AiTAdviceApi
  }
}

export {}
