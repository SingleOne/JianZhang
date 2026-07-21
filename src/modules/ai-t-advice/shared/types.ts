import type { StockPosition, StockQuote, TTradingAccount, WatchStock } from '../../../shared/types'

export type AiTAdviceAction = 'hold' | 'forward-t' | 'reverse-t'
export type AiTAdviceConfidence = 'low' | 'medium' | 'high'
export type AiTAdviceRecordStatus = 'active' | 'dismissed' | 'applied'

export interface AiTAdviceSettings {
  enabled: boolean
}

export interface AiTAdviceStatus {
  enabled: boolean
  generatingQuoteIds: string[]
  message: string
}

export interface AiTAdvice {
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

export interface AiTPlanLevelPreview {
  side: 'buy' | 'sell'
  levelIndex: number
  label: string
  current: {
    targetPercent: number
    targetPrice: number | null
    quantity: number
  }
  proposed: {
    targetPercent: number
    targetPrice: number
    quantity: number
  }
}

export interface AiTAdviceApplyPreview {
  previewId: string
  adviceId: string
  quoteId: string
  quoteName: string
  batchId: string
  action: Exclude<AiTAdviceAction, 'hold'>
  expiresAt: string
  change: AiTPlanLevelPreview
}

export interface AiTAdviceApplyResult {
  advice: AiTAdvice
  appliedAt: string
}

export interface AiTAdviceTradingContext {
  stock: WatchStock
  quote?: StockQuote
  position?: StockPosition
  account?: TTradingAccount
}

export interface AiTAdviceApi {
  getStatus: () => Promise<AiTAdviceStatus>
  getSettings: () => Promise<AiTAdviceSettings>
  saveSettings: (settings: AiTAdviceSettings) => Promise<AiTAdviceSettings>
  generate: (quoteId: string) => Promise<AiTAdviceGenerationResult>
  cancel: (quoteId: string) => Promise<void>
  listHistory: (quoteId: string) => Promise<AiTAdvice[]>
  dismiss: (adviceId: string) => Promise<AiTAdvice>
  previewApply: (adviceId: string) => Promise<AiTAdviceApplyPreview>
  confirmApply: (previewId: string) => Promise<AiTAdviceApplyResult>
}

declare global {
  interface Window {
    aiTAdviceApi?: AiTAdviceApi
  }
}

export {}
