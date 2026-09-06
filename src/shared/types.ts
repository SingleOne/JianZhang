import {
  BUILT_IN_MARKET_CALENDAR_END_YEARS,
  builtInMarketCalendar,
  type MarketCalendarSource
} from './market-calendar'
import { stockMarketIdentity, type StockMarket } from './stock-market'
export type {
  StockCurrency,
  StockExchange,
  StockInstrumentType,
  StockMarket,
  StockMarketIdentity,
  StockVolumeUnit
} from './stock-market'

export interface StockPositionSnapshot {
  id: string
  name: string
  createdAt: string
  quantity: number
  cost: number
  currency?: import('./stock-market').StockCurrency
  costExchangeRate?: number
  costExchangeRateDate?: string
}

export type StockAlertMetric = 'price' | 'changePercent' | 'profitPercent'
export type StockAlertOperator = 'gte' | 'lte'
export type StockAlertStatus = 'armed' | 'triggered'

export interface StockAlertRule {
  id: string
  metric: StockAlertMetric
  operator: StockAlertOperator
  target: number
  enabled: boolean
  status?: StockAlertStatus
  triggeredAt?: string
}

export interface WatchStock {
  code: string
  name: string
  quoteId: string
  marketLabel: string
  market?: import('./stock-market').StockMarket
  exchange?: import('./stock-market').StockExchange
  currency?: import('./stock-market').StockCurrency
  instrumentType?: import('./stock-market').StockInstrumentType
  showInTaskbar: boolean
  isPriority: boolean
  showRadarSignals: boolean
  position?: StockPosition
  positionSnapshots?: StockPositionSnapshot[]
  alertRules?: StockAlertRule[]
  groupIds?: string[]
  addedAt?: string
  addedPrice?: number
}

export type StockTrackingSourceType =
  'manual' | 'dailyScan' | 'dividendFinancing' | 'fundamentalScreening' | 'legacy'

export interface StockTrackingSourceDetail {
  tags?: string[]
  tradingDate?: string
  signals?: DailyMarketScanSignalType[]
  startPrice?: number
  changePercent?: number
  volumeRatio?: number
  dividendRatio?: number
  dividendRank?: number
  snapshotDate?: string
  industryName?: string
}

export interface StockTrackingSource {
  id: string
  type: StockTrackingSourceType
  recordedAt: string
  detail?: StockTrackingSourceDetail
}

export type StockTrackingEntryType = 'note' | 'thesis' | 'review' | 'system'

export interface StockTrackingQuoteSnapshot {
  latest: number
  changePercent: number | null
  capturedAt: string
}

export interface StockTrackingEntry {
  id: string
  type: StockTrackingEntryType
  content: string
  createdAt: string
  quoteSnapshot?: StockTrackingQuoteSnapshot
}

export type StockTrackingConclusionResult = 'expected' | 'unexpected' | 'unverified'

export interface StockTrackingConclusion {
  result: StockTrackingConclusionResult
  summary: string
  stoppedAt: string
}

export interface StockTrackingMetricSnapshot {
  tradingDate: string
  capturedAt: string
  metrics: Record<string, number>
}

export interface StockTrackingProfile {
  quoteId: string
  code: string
  name: string
  marketLabel: string
  market?: import('./stock-market').StockMarket
  exchange?: import('./stock-market').StockExchange
  currency?: import('./stock-market').StockCurrency
  instrumentType?: import('./stock-market').StockInstrumentType
  status: 'tracking' | 'stopped'
  tags: string[]
  thesis: string
  startedAt: string
  updatedAt: string
  stoppedAt?: string
  sources: StockTrackingSource[]
  entries: StockTrackingEntry[]
  metricSnapshots: StockTrackingMetricSnapshot[]
  conclusion?: StockTrackingConclusion
}

export type StockTrackingProfiles = Record<string, StockTrackingProfile>

export interface WatchlistGroup {
  id: string
  name: string
}

export const DAILY_SCAN_WATCHLIST_GROUP_ID = 'daily-market-scan-observation'
export const DAILY_SCAN_WATCHLIST_GROUP_NAME = '异动观察'
export const TRACKING_WATCHLIST_GROUP_ID = 'stock-tracking'
export const TRACKING_WATCHLIST_GROUP_NAME = '追踪'
export const HOLDING_WATCHLIST_GROUP_ID = 'portfolio-holdings'
export const HOLDING_WATCHLIST_GROUP_NAME = '持仓'
export const DEFAULT_WATCHLIST_GROUPS: readonly WatchlistGroup[] = [
  { id: DAILY_SCAN_WATCHLIST_GROUP_ID, name: DAILY_SCAN_WATCHLIST_GROUP_NAME },
  { id: TRACKING_WATCHLIST_GROUP_ID, name: TRACKING_WATCHLIST_GROUP_NAME },
  { id: HOLDING_WATCHLIST_GROUP_ID, name: HOLDING_WATCHLIST_GROUP_NAME }
]

export function isDailyScanWatchlistGroup(group: WatchlistGroup): boolean {
  return (
    group.id === DAILY_SCAN_WATCHLIST_GROUP_ID ||
    group.name.trim() === DAILY_SCAN_WATCHLIST_GROUP_NAME
  )
}

export function getDailyScanWatchlistGroup(groups: readonly WatchlistGroup[]): WatchlistGroup {
  return groups.find(isDailyScanWatchlistGroup) ?? { ...DEFAULT_WATCHLIST_GROUPS[0] }
}

export function isTrackingWatchlistGroup(group: WatchlistGroup): boolean {
  return (
    group.id === TRACKING_WATCHLIST_GROUP_ID || group.name.trim() === TRACKING_WATCHLIST_GROUP_NAME
  )
}

export function isHoldingWatchlistGroup(group: WatchlistGroup): boolean {
  return (
    group.id === HOLDING_WATCHLIST_GROUP_ID || group.name.trim() === HOLDING_WATCHLIST_GROUP_NAME
  )
}

export function isSystemWatchlistGroup(group: WatchlistGroup): boolean {
  return (
    isDailyScanWatchlistGroup(group) ||
    isTrackingWatchlistGroup(group) ||
    isHoldingWatchlistGroup(group)
  )
}

export function getTrackingWatchlistGroup(groups: readonly WatchlistGroup[]): WatchlistGroup {
  return groups.find(isTrackingWatchlistGroup) ?? { ...DEFAULT_WATCHLIST_GROUPS[1] }
}

export function getHoldingWatchlistGroup(groups: readonly WatchlistGroup[]): WatchlistGroup {
  return groups.find(isHoldingWatchlistGroup) ?? { ...DEFAULT_WATCHLIST_GROUPS[2] }
}

export function normalizeWatchlistGroups(
  groups: readonly WatchlistGroup[] | undefined
): WatchlistGroup[] {
  const usedIds = new Set<string>()
  const normalized = (Array.isArray(groups) ? groups : []).flatMap((group) => {
    const id = group?.id?.trim()
    const name = group?.name?.trim()
    if (!id || !name || usedIds.has(id)) return []
    usedIds.add(id)
    return [{ id, name }]
  })
  const dailyScanGroup = normalized.find(isDailyScanWatchlistGroup)
  const trackingGroup = normalized.find(isTrackingWatchlistGroup)
  const holdingGroup = normalized.find(isHoldingWatchlistGroup)
  const systemGroups = [
    dailyScanGroup ?? { ...DEFAULT_WATCHLIST_GROUPS[0] },
    trackingGroup ?? { ...DEFAULT_WATCHLIST_GROUPS[1] },
    holdingGroup ?? { ...DEFAULT_WATCHLIST_GROUPS[2] }
  ]
  return [
    ...systemGroups.map((group) => ({
      ...group,
      name: isDailyScanWatchlistGroup(group)
        ? DAILY_SCAN_WATCHLIST_GROUP_NAME
        : isTrackingWatchlistGroup(group)
          ? TRACKING_WATCHLIST_GROUP_NAME
          : HOLDING_WATCHLIST_GROUP_NAME
    })),
    ...normalized.filter((group) => !isSystemWatchlistGroup(group))
  ]
}

const STOCK_TRACKING_SOURCE_TYPES = new Set<StockTrackingSourceType>([
  'manual',
  'dailyScan',
  'dividendFinancing',
  'fundamentalScreening',
  'legacy'
])

const STOCK_TRACKING_ENTRY_TYPES = new Set<StockTrackingEntryType>([
  'note',
  'thesis',
  'review',
  'system'
])

export function normalizeStockTrackingProfiles(
  profiles: StockTrackingProfiles | undefined
): StockTrackingProfiles {
  if (!profiles || typeof profiles !== 'object') return {}
  return Object.fromEntries(
    Object.entries(profiles).flatMap(([quoteId, profile]) => {
      if (!profile || typeof profile !== 'object' || !quoteId) return []
      const sources = Array.isArray(profile.sources)
        ? profile.sources.flatMap((source, index) => {
            if (!source || !STOCK_TRACKING_SOURCE_TYPES.has(source.type)) return []
            return [
              {
                ...source,
                id: source.id || `${quoteId}:source:${index}`,
                recordedAt: source.recordedAt || profile.startedAt
              }
            ]
          })
        : []
      const entries = Array.isArray(profile.entries)
        ? profile.entries.flatMap((entry, index) => {
            if (!entry || !entry.content?.trim() || !STOCK_TRACKING_ENTRY_TYPES.has(entry.type))
              return []
            return [
              {
                ...entry,
                id: entry.id || `${quoteId}:entry:${index}`,
                content: entry.content.trim(),
                createdAt: entry.createdAt || profile.updatedAt
              }
            ]
          })
        : []
      const metricSnapshots = Array.isArray(profile.metricSnapshots)
        ? profile.metricSnapshots
            .flatMap((snapshot) => {
              const tradingDate = snapshot?.tradingDate?.slice(0, 10)
              if (!tradingDate) return []
              const metrics = Object.fromEntries(
                Object.entries(snapshot.metrics ?? {}).filter(
                  ([metricId, value]) => metricId.trim() && Number.isFinite(value)
                )
              )
              if (Object.keys(metrics).length === 0) return []
              return [
                {
                  tradingDate,
                  capturedAt: snapshot.capturedAt || profile.updatedAt,
                  metrics
                }
              ]
            })
            .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
        : []
      return [
        [
          quoteId,
          {
            ...profile,
            ...stockMarketIdentity(quoteId, profile.instrumentType),
            quoteId,
            status: profile.status === 'stopped' ? 'stopped' : 'tracking',
            tags: [...new Set((profile.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
            thesis: profile.thesis?.trim() ?? '',
            sources,
            entries,
            metricSnapshots
          }
        ]
      ]
    })
  )
}

export function synchronizeWatchlistGroupMemberships(
  stocks: readonly WatchStock[],
  groups: readonly WatchlistGroup[],
  profiles: StockTrackingProfiles
): WatchStock[] {
  const trackingGroupId = getTrackingWatchlistGroup(groups).id
  const holdingGroupId = getHoldingWatchlistGroup(groups).id
  return stocks.map((stock) => {
    const groupIds = new Set(stock.groupIds ?? [])
    if (profiles[stock.quoteId]?.status === 'tracking') groupIds.add(trackingGroupId)
    else groupIds.delete(trackingGroupId)
    if (stock.position && stock.position.quantity > 0) groupIds.add(holdingGroupId)
    else groupIds.delete(holdingGroupId)
    return { ...stock, groupIds: [...groupIds] }
  })
}

export function normalizeWatchlist(stocks: readonly WatchStock[]): WatchStock[] {
  return stocks.map((stock) => {
    const identity = stockMarketIdentity(stock.quoteId, stock.instrumentType)
    const normalizeCostRate = (value: number | undefined) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
    const position = stock.position
      ? {
          ...stock.position,
          currency: identity.currency,
          costExchangeRate:
            identity.currency === 'CNY' ? 1 : normalizeCostRate(stock.position.costExchangeRate),
          costExchangeRateDate:
            identity.currency === 'CNY'
              ? (stock.position.costExchangeRateDate ?? stock.position.openedOn)
              : stock.position.costExchangeRateDate
        }
      : undefined
    return {
      ...stock,
      ...identity,
      addedAt: typeof stock.addedAt === 'string' && stock.addedAt ? stock.addedAt : undefined,
      addedPrice:
        typeof stock.addedPrice === 'number' &&
        Number.isFinite(stock.addedPrice) &&
        stock.addedPrice > 0
          ? stock.addedPrice
          : undefined,
      position,
      isPriority: Boolean(position || stock.isPriority),
      showRadarSignals: stock.showRadarSignals ?? true,
      groupIds: [
        ...new Set((stock.groupIds ?? []).filter((groupId) => typeof groupId === 'string'))
      ],
      positionSnapshots: Array.isArray(stock.positionSnapshots)
        ? stock.positionSnapshots
            .filter(
              (snapshot) =>
                snapshot &&
                typeof snapshot.id === 'string' &&
                typeof snapshot.name === 'string' &&
                typeof snapshot.createdAt === 'string' &&
                Number.isFinite(snapshot.quantity) &&
                snapshot.quantity > 0 &&
                Number.isFinite(snapshot.cost)
            )
            .map((snapshot) => ({
              ...snapshot,
              currency: identity.currency,
              costExchangeRate:
                identity.currency === 'CNY' ? 1 : normalizeCostRate(snapshot.costExchangeRate),
              costExchangeRateDate: snapshot.costExchangeRateDate
            }))
        : [],
      alertRules: Array.isArray(stock.alertRules)
        ? stock.alertRules
            .filter((rule) => Number.isFinite(rule.target))
            .map((rule) => ({
              id: rule.id,
              metric: rule.metric,
              operator: rule.operator,
              target: rule.target,
              enabled: rule.enabled ?? true,
              status: rule.status === 'triggered' ? 'triggered' : 'armed',
              triggeredAt: rule.triggeredAt
            }))
        : []
    }
  })
}

export const MARKET_INDEX_OPTIONS = [
  {
    id: 'shanghai',
    code: '000001',
    name: '上证指数',
    quoteId: '1.000001',
    marketLabel: '沪指',
    market: 'CN'
  },
  {
    id: 'shenzhen',
    code: '399001',
    name: '深证成指',
    quoteId: '0.399001',
    marketLabel: '深指',
    market: 'CN'
  },
  {
    id: 'chinext',
    code: '399006',
    name: '创业板指',
    quoteId: '0.399006',
    marketLabel: '创业板',
    market: 'CN'
  },
  {
    id: 'sse50',
    code: '000016',
    name: '上证50',
    quoteId: '1.000016',
    marketLabel: '沪指',
    market: 'CN'
  },
  {
    id: 'csi300',
    code: '000300',
    name: '沪深300',
    quoteId: '1.000300',
    marketLabel: '沪深',
    market: 'CN'
  },
  {
    id: 'star50',
    code: '000688',
    name: '科创50',
    quoteId: '1.000688',
    marketLabel: '科创板',
    market: 'CN'
  },
  {
    id: 'csi500',
    code: '000905',
    name: '中证500',
    quoteId: '1.000905',
    marketLabel: '中证',
    market: 'CN'
  },
  {
    id: 'csi1000',
    code: '000852',
    name: '中证1000',
    quoteId: '1.000852',
    marketLabel: '中证',
    market: 'CN'
  },
  {
    id: 'bse50',
    code: '899050',
    name: '北证50',
    quoteId: '0.899050',
    marketLabel: '北交所',
    market: 'CN'
  },
  {
    id: 'hsi',
    code: 'HSI',
    name: '恒生指数',
    quoteId: '100.HSI',
    marketLabel: '港股指数',
    market: 'HK'
  },
  {
    id: 'hstech',
    code: 'HSTECH',
    name: '恒生科技指数',
    quoteId: '124.HSTECH',
    marketLabel: '港股指数',
    market: 'HK'
  },
  {
    id: 'hscei',
    code: 'HSCEI',
    name: '国企指数',
    quoteId: '100.HSCEI',
    marketLabel: '港股指数',
    market: 'HK'
  },
  {
    id: 'nasdaq',
    code: 'NDX',
    name: '纳斯达克',
    quoteId: '100.NDX',
    marketLabel: '美股指数',
    market: 'US'
  },
  {
    id: 'sp500',
    code: 'SPX',
    name: '标普500',
    quoteId: '100.SPX',
    marketLabel: '美股指数',
    market: 'US'
  },
  {
    id: 'dow-jones',
    code: 'DJIA',
    name: '道琼斯',
    quoteId: '100.DJIA',
    marketLabel: '美股指数',
    market: 'US'
  }
] as const

export type MarketIndexId = (typeof MARKET_INDEX_OPTIONS)[number]['id']

export const DEFAULT_MARKET_INDEX_IDS: MarketIndexId[] = ['shanghai', 'hsi', 'nasdaq']
const MARKET_INDEX_IDS = new Set<string>(MARKET_INDEX_OPTIONS.map((index) => index.id))

export function normalizeMarketIndexIds(indexIds: unknown): MarketIndexId[] {
  if (
    !Array.isArray(indexIds) ||
    !indexIds.every((indexId) => typeof indexId === 'string' && MARKET_INDEX_IDS.has(indexId))
  ) {
    return [...DEFAULT_MARKET_INDEX_IDS]
  }
  return [...indexIds] as MarketIndexId[]
}

export function getMarketIndexStocks(indexIds: readonly MarketIndexId[]): WatchStock[] {
  const selectedIds = new Set(indexIds)
  return MARKET_INDEX_OPTIONS.filter((index) => selectedIds.has(index.id)).map((index) => ({
    code: index.code,
    name: index.name,
    quoteId: index.quoteId,
    marketLabel: index.marketLabel,
    market: index.market,
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: false
  }))
}

export interface StockPosition {
  quantity: number
  cost: number
  openedToday: boolean
  openedOn?: string
  currency?: import('./stock-market').StockCurrency
  costExchangeRate?: number
  costExchangeRateDate?: string
}

export interface TTradingFeeSettings {
  commissionRatePerTenThousand: number
  minimumCommissionBundle: number
  handlingRatePerTenThousand: number
  regulatoryRatePerTenThousand: number
  transferRatePerTenThousand: number
  stampDutyRatePerTenThousand: number
}

export interface HongKongTradeFeeSettings {
  brokerageRatePercent: number
  minimumBrokerage: number
  platformFee: number
  includeSettlementFee: boolean
}

export interface UnitedStatesTradeFeeSettings {
  commissionPerShare: number
  minimumCommission: number
  platformFee: number
  includeSecFee: boolean
  includeFinraTaf: boolean
}

export interface MarketTradeFeeSettings {
  HK: HongKongTradeFeeSettings
  US: UnitedStatesTradeFeeSettings
}

export const DEFAULT_T_TRADING_FEE_SETTINGS: TTradingFeeSettings = {
  commissionRatePerTenThousand: 5.313,
  minimumCommissionBundle: 5,
  handlingRatePerTenThousand: 0.341,
  regulatoryRatePerTenThousand: 0.2,
  transferRatePerTenThousand: 0.1,
  stampDutyRatePerTenThousand: 5
}

export const DEFAULT_MARKET_TRADE_FEE_SETTINGS: MarketTradeFeeSettings = {
  HK: {
    brokerageRatePercent: 0,
    minimumBrokerage: 0,
    platformFee: 0,
    includeSettlementFee: false
  },
  US: {
    commissionPerShare: 0,
    minimumCommission: 0,
    platformFee: 0,
    includeSecFee: true,
    includeFinraTaf: true
  }
}

export interface TTradeFees {
  commission: number
  handling: number
  regulatory: number
  transfer: number
  stampDuty: number
}

export type TradeFeeItemCode =
  | 'brokerage'
  | 'platform'
  | 'sfc-levy'
  | 'afrc-levy'
  | 'hkex-trading'
  | 'stamp-duty'
  | 'settlement'
  | 'sec-section-31'
  | 'finra-taf'
  | 'manual'

export interface TradeFeeItem {
  code: TradeFeeItemCode
  label: string
  amount: number
}

export interface TradeFeeTemplateSnapshot {
  id: string
  version: string
  label: string
  effectiveFrom: string
}

export type TTradeSide = 'buy' | 'sell'
export type TTradePurpose = 't' | 'base'
export type TTradingDirection = 'forward' | 'reverse'

export interface TTradeAllocation {
  purpose: TTradePurpose
  quantity: number
  batchId?: string
  batchSequence?: number
  batchDirection?: TTradingDirection
}

export interface TTrade {
  id: string
  side: TTradeSide
  purpose: TTradePurpose
  tradedAt: string
  price: number
  quantity: number
  fees: TTradeFees
  feeItems?: TradeFeeItem[]
  feeTemplate?: TradeFeeTemplateSnapshot
  market?: import('./stock-market').StockMarket
  currency?: import('./stock-market').StockCurrency
  marketDate?: string
  exchangeRate?: number
  exchangeRateDate?: string
  estimatedSettlementDate?: string
  actualSettlementDate?: string
  settlementRule?: TradeFeeTemplateSnapshot
  origin?: 'execution' | 'opening-balance'
  /** 拆分记录的共同成交来源，仅用于追溯，不参与持仓和批次计算。 */
  splitSource?: { id: string; quantity: number }
  /** 一笔真实成交在底仓及一个或多个 T 批次之间的数量分配。 */
  allocations?: TTradeAllocation[]
  note: string
}

/** 统一交易记录；批次字段缺省时表示批次外的底仓交易。 */
export interface TTradeRecord extends TTrade {
  batchId?: string
  batchSequence?: number
  batchDirection?: TTradingDirection
}

export type CorporateActionType =
  | 'cashDividend'
  | 'stockDividend'
  | 'split'
  | 'reverseSplit'
  | 'rightsIssue'
  | 'spinOff'
  | 'mergerExchange'
  | 'symbolChange'
  | 'delistingCash'
  | 'returnOfCapital'
  | 'manualCash'

export type CorporateActionStatus =
  'detected' | 'needsReview' | 'confirmed' | 'applied' | 'ignored' | 'revised' | 'reversed'

export interface CorporateActionMarketRules {
  market: StockMarket
  quantityPrecision: number
  cashPrecision: number
  supportsFractionalShares: boolean
  defaultWithholdingTaxMode: 'brokerActual' | 'manual'
  dateTimeZone: string
  settlementRuleIds: string[]
}

export interface CorporateActionExtractedField<T> {
  value?: T
  confidence: 'high' | 'medium' | 'low'
  evidenceText?: string
}

export type CorporateActionTerms =
  | {
      kind: 'cashDividend'
      amountPerShare: CorporateActionExtractedField<number>
      currency: CorporateActionExtractedField<import('./stock-market').StockCurrency>
    }
  | {
      kind: 'shareRatio'
      oldShares: CorporateActionExtractedField<number>
      newShares: CorporateActionExtractedField<number>
      fractionalTreatment?: CorporateActionExtractedField<'keep' | 'cash' | 'discard'>
    }
  | {
      kind: 'rightsIssue'
      heldShares: CorporateActionExtractedField<number>
      entitlementShares: CorporateActionExtractedField<number>
      subscriptionPrice: CorporateActionExtractedField<number>
      currency: CorporateActionExtractedField<import('./stock-market').StockCurrency>
    }
  | {
      kind: 'securityConversion'
      oldShares: CorporateActionExtractedField<number>
      newShares: CorporateActionExtractedField<number>
      targetQuoteId?: CorporateActionExtractedField<string>
    }
  | {
      kind: 'symbolChange'
      oldQuoteId: CorporateActionExtractedField<string>
      newQuoteId: CorporateActionExtractedField<string>
      newCode?: CorporateActionExtractedField<string>
    }
  | { kind: 'manualCash' }
  | { kind: 'unsupported' }

export interface CorporateActionEvidence {
  source: string
  title: string
  url: string
  publishedAt: string
  excerpt?: string
}

export interface CorporateActionCandidate {
  id: string
  quoteId: string
  market: StockMarket
  type: CorporateActionType
  status: CorporateActionStatus
  title: string
  announcementDate: string
  exDate?: string
  recordDate?: string
  electionDeadline?: string
  effectiveDate?: string
  payableDate?: string
  terms: CorporateActionTerms
  evidence: CorporateActionEvidence[]
  providerId: string
  providerEventId: string
  contentHash: string
  detectedAt: string
  reviewedAt?: string
  appliedEntryIds?: string[]
  warning?: string
}

export interface CorporateActionRecord extends CorporateActionCandidate {
  status: Exclude<CorporateActionStatus, 'detected'>
}

export type CorporateActionRecords = Record<string, CorporateActionRecord>

export interface PortfolioLedgerEntryBase {
  id: string
  accountId: string
  quoteId: string
  occurredAt: string
  marketDate: string
  recordedAt?: string
  source: 'manual' | 'corporateAction' | 'brokerImport' | 'trade'
  externalId?: string
  corporateActionId?: string
  currency?: import('./stock-market').StockCurrency
  exchangeRate?: number
  exchangeRateDate?: string
  exchangeRateEstimated?: boolean
  note?: string
}

export interface TradeLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'trade'
  record: TTradeRecord
}

export interface CashDividendLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'cashDividend'
  eligibleQuantity: number
  amountPerShare: number
  amount: number
}

export interface WithholdingTaxLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'withholdingTax'
  amount: number
}

export interface CorporateActionFeeLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'corporateActionFee'
  amount: number
}

export interface ShareAdjustmentLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'shareAdjustment'
  actionType: 'stockDividend' | 'split' | 'reverseSplit'
  quantityBefore: number
  quantityAfter: number
  oldShares: number
  newShares: number
}

export interface PositionAdjustmentLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'positionAdjustment'
  resetsPerformance?: boolean
  quantityBefore: number
  quantityAfter: number
  costBefore: number | null
  costAfter: number | null
  openedOnBefore?: string
  openedOnAfter?: string
}

export interface RightsSubscriptionLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'rightsSubscription'
  quantity: number
  price: number
  cost?: number
  fees: number
}

export interface SecurityConversionLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'securityConversion'
  quantityBefore: number
  quantityAfter: number
  sourceQuoteId?: string
  targetQuoteId?: string
}

export interface CashAdjustmentLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'cashAdjustment'
  amount: number
  reason: 'fractionalShare' | 'manual' | 'rightsSale' | 'delisting' | 'capitalReturn'
}

export interface ReversalLedgerEntry extends PortfolioLedgerEntryBase {
  kind: 'reversal'
  reversesEntryId: string
}

export type PortfolioLedgerEntry =
  | TradeLedgerEntry
  | CashDividendLedgerEntry
  | WithholdingTaxLedgerEntry
  | CorporateActionFeeLedgerEntry
  | ShareAdjustmentLedgerEntry
  | PositionAdjustmentLedgerEntry
  | RightsSubscriptionLedgerEntry
  | SecurityConversionLedgerEntry
  | CashAdjustmentLedgerEntry
  | ReversalLedgerEntry

export interface PortfolioLedger {
  schemaVersion: 1
  entries: PortfolioLedgerEntry[]
}

export interface CorporateActionConfirmation {
  eligibleQuantity?: number
  amountPerShare?: number
  oldShares?: number
  newShares?: number
  subscribedQuantity?: number
  subscriptionPrice?: number
  withholdingTax?: number
  fees?: number
  cashAmount?: number
  currency?: import('./stock-market').StockCurrency
  exchangeRate?: number
  exchangeRateDate?: string
  exchangeRateEstimated?: boolean
  targetQuoteId?: string
  occurredAt?: string
  note?: string
}

export interface CorporateActionPreviewRequest {
  candidate: CorporateActionCandidate
  account: TTradingAccount
  confirmation: CorporateActionConfirmation
}

export interface CorporateActionImpactPreview {
  candidateId: string
  resolvedCandidate?: CorporateActionCandidate
  quantityBefore: number
  quantityAfter: number
  costBefore: number | null
  costAfter: number | null
  totalCostBefore: number | null
  totalCostAfter: number | null
  grossCash: number
  withholdingTax: number
  fees: number
  netCash: number
  netCashCny: number | null
  entries: PortfolioLedgerEntry[]
  missingFields: string[]
}

export interface CorporateActionListResult {
  quoteId: string
  market: StockMarket
  source: string
  fetchedAt: string
  fromCache: boolean
  candidates: CorporateActionCandidate[]
  warning?: string
  degraded?: boolean
  cacheVersion?: number
}

export interface ManualCorporateActionRequest {
  quoteId: string
  market: StockMarket
  type: CorporateActionType
  title: string
  announcementDate: string
  effectiveDate?: string
  currency: import('./stock-market').StockCurrency
  confirmation: CorporateActionConfirmation
}

export interface TPositionSnapshot {
  quantity: number
  cost: number
  openedOn?: string
}

export type TAlertStatus = 'armed' | 'triggered' | 'handled'

export const DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD = 100

export type TFloatingProfitAlertStatus = 'armed' | 'profit-triggered' | 'loss-triggered'

export interface TFloatingProfitAlert {
  enabled: boolean
  threshold: number
  status: TFloatingProfitAlertStatus
  triggeredAt?: string
}

export interface TPlanLevel {
  targetPercent: number
  quantity: number
  alertStatus?: TAlertStatus
  triggeredAt?: string
}

export interface TPlanDefaultLevel {
  targetPercent: number
  quantity: number
}

export interface TPlanDefaultSettings {
  buyLevels: TPlanDefaultLevel[]
  sellLevels: TPlanDefaultLevel[]
}

/** 兼容旧代码中仅存在卖出计划时的类型名称。 */
export type TSellPlanLevel = TPlanLevel

export interface TBatchSettlement {
  settledAt: string
  latestPositionQuantity: number
  latestPositionCost?: number
  ledgerProfit: number
  costAdjustedProfit?: number
  finalProfit: number
  source: 'ledger' | 'position-cost'
  note: string
}

export interface TTradingBatch {
  id: string
  sequence: number
  openedAt: string
  /** 缺省时视为旧版正T批次，保证原有配置兼容。 */
  direction?: TTradingDirection
  openingPosition?: TPositionSnapshot
  /** 低于当前 T 仓平均成本的五档买入计划。 */
  buyLevels?: TPlanLevel[]
  /** 高于当前 T 仓平均成本的五档卖出计划。 */
  sellLevels: TPlanLevel[]
  /** 当前批次的买卖十档价格提醒总开关。 */
  alertEnabled?: boolean
  /** 当前批次的双向浮动盈亏金额提醒。 */
  floatingProfitAlert?: TFloatingProfitAlert
  settlement?: TBatchSettlement
}

export interface TTradingAccount {
  quoteId: string
  code: string
  name: string
  market?: import('./stock-market').StockMarket
  currency?: import('./stock-market').StockCurrency
  activeBatch?: TTradingBatch
  history: TTradingBatch[]
  /** 统一组合账本是新写入和公司行动计算的唯一数据源。 */
  ledger: PortfolioLedger
  /** 由账本中 trade 条目派生的旧版兼容镜像。 */
  tradeRecords: TTradeRecord[]
}

export type TTradingAccounts = Record<string, TTradingAccount>

function activeTQuantity(batch: TTradingBatch, trades: readonly TTrade[]): number {
  const openingSide: TTradeSide = (batch.direction ?? 'forward') === 'reverse' ? 'sell' : 'buy'
  return Math.max(
    0,
    trades.reduce((total, trade) => {
      const quantity = trade.allocations?.length
        ? trade.allocations
            .filter((allocation) => allocation.purpose === 't' && allocation.batchId === batch.id)
            .reduce((sum, allocation) => sum + allocation.quantity, 0)
        : trade.purpose === 't'
          ? trade.quantity
          : 0
      return total + (trade.side === openingSide ? quantity : -quantity)
    }, 0)
  )
}

function tradeReferencesTradingBatch(trade: TTradeRecord, batchId: string): boolean {
  return trade.allocations?.length
    ? trade.allocations.some((allocation) => allocation.batchId === batchId)
    : trade.batchId === batchId
}

export function createDefaultTPlanLevels(quantity: number): TPlanLevel[] {
  const totalLots = Math.floor(quantity / 100)
  const baseLots = Math.floor(totalLots / 5)
  const extraLots = totalLots % 5
  return [1, 2, 3, 4, 5].map((targetPercent, index) => ({
    targetPercent,
    quantity: (baseLots + (index < extraLots ? 1 : 0)) * 100,
    alertStatus: 'armed' as const
  }))
}

function normalizeTPlanLevels(
  levels: readonly TPlanLevel[] | undefined,
  quantity: number
): TPlanLevel[] {
  const defaults = createDefaultTPlanLevels(quantity)
  return defaults.map((fallback, index) => {
    const level = levels?.[index]
    if (!level) return fallback
    return {
      targetPercent: Math.max(0, level.targetPercent ?? fallback.targetPercent),
      quantity: Math.max(0, level.quantity ?? fallback.quantity),
      alertStatus:
        level.alertStatus === 'triggered' || level.alertStatus === 'handled'
          ? level.alertStatus
          : 'armed',
      triggeredAt: level.triggeredAt
    }
  })
}

function normalizeTFloatingProfitAlert(
  alert: Partial<TFloatingProfitAlert> | undefined
): TFloatingProfitAlert {
  const enabled = alert?.enabled ?? false
  const status =
    enabled && (alert?.status === 'profit-triggered' || alert?.status === 'loss-triggered')
      ? alert.status
      : 'armed'
  return {
    enabled,
    threshold: Math.max(1, alert?.threshold ?? DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD),
    status,
    triggeredAt: status === 'armed' ? undefined : alert?.triggeredAt
  }
}

export function normalizeActiveTTradingBatch(
  batch: TTradingBatch,
  trades: readonly TTrade[] = []
): TTradingBatch {
  const quantity = activeTQuantity(batch, trades)
  const direction = batch.direction ?? 'forward'
  const legacyLevels = normalizeTPlanLevels(batch.sellLevels, quantity)
  const hasBuyLevels = Array.isArray(batch.buyLevels)

  return {
    ...batch,
    buyLevels:
      direction === 'reverse' && !hasBuyLevels
        ? legacyLevels
        : normalizeTPlanLevels(batch.buyLevels, quantity),
    sellLevels:
      direction === 'reverse' && !hasBuyLevels ? createDefaultTPlanLevels(quantity) : legacyLevels,
    alertEnabled: batch.alertEnabled ?? false,
    floatingProfitAlert: normalizeTFloatingProfitAlert(batch.floatingProfitAlert)
  }
}

export function tradeLedgerEntry(
  accountId: string,
  quoteId: string,
  record: TTradeRecord
): TradeLedgerEntry {
  return {
    id: `trade:${record.id}`,
    accountId,
    quoteId,
    occurredAt: record.tradedAt,
    marketDate: record.marketDate ?? record.tradedAt.slice(0, 10),
    recordedAt: record.tradedAt,
    source: 'trade',
    externalId: record.id,
    currency: record.currency,
    exchangeRate: record.exchangeRate,
    exchangeRateDate: record.exchangeRateDate,
    record,
    kind: 'trade'
  }
}

export function tradeRecordsFromLedger(ledger: PortfolioLedger | undefined): TTradeRecord[] {
  return (ledger?.entries ?? [])
    .filter((entry): entry is TradeLedgerEntry => entry.kind === 'trade')
    .map((entry) => entry.record)
    .sort((left, right) => right.tradedAt.localeCompare(left.tradedAt))
}

function normalizedPortfolioLedger(
  accountId: string,
  quoteId: string,
  ledger: PortfolioLedger | undefined,
  tradeRecords: readonly TTradeRecord[]
): PortfolioLedger {
  const nonTradeEntries = (ledger?.entries ?? []).filter((entry) => entry.kind !== 'trade')
  return {
    schemaVersion: 1,
    entries: [
      ...tradeRecords.map((record) => tradeLedgerEntry(accountId, quoteId, record)),
      ...nonTradeEntries
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  }
}

export function withLedgerTradeRecords(
  account: TTradingAccount,
  tradeRecords: readonly TTradeRecord[]
): TTradingAccount {
  const records = [...tradeRecords].sort((left, right) =>
    right.tradedAt.localeCompare(left.tradedAt)
  )
  return {
    ...account,
    ledger: normalizedPortfolioLedger(account.quoteId, account.quoteId, account.ledger, records),
    tradeRecords: records
  }
}

export function appendPortfolioLedgerEntries(
  account: TTradingAccount,
  entries: readonly PortfolioLedgerEntry[]
): TTradingAccount {
  const ids = new Set(entries.map((entry) => entry.id))
  const ledger = {
    schemaVersion: 1 as const,
    entries: [...account.ledger.entries.filter((entry) => !ids.has(entry.id)), ...entries].sort(
      (left, right) => right.occurredAt.localeCompare(left.occurredAt)
    )
  }
  return { ...account, ledger, tradeRecords: tradeRecordsFromLedger(ledger) }
}

export function normalizeCorporateActionRecords(
  records: CorporateActionRecords | undefined
): CorporateActionRecords {
  return Object.fromEntries(
    Object.entries(records ?? {}).filter(([, record]) => Boolean(record?.id && record.quoteId))
  )
}

export function normalizeTTradingAccounts(
  accounts: TTradingAccounts | undefined
): TTradingAccounts {
  return Object.fromEntries(
    Object.entries(accounts ?? {}).map(([quoteId, account]) => {
      const tradeRecords = tradeRecordsFromLedger(account.ledger)
      const activeBatch = account.activeBatch
      const activeTrades = activeBatch
        ? tradeRecords.filter((record) => tradeReferencesTradingBatch(record, activeBatch.id))
        : []
      const ledger = normalizedPortfolioLedger(quoteId, quoteId, account.ledger, tradeRecords)

      return [
        quoteId,
        {
          ...account,
          activeBatch: activeBatch
            ? normalizeActiveTTradingBatch(activeBatch, activeTrades)
            : undefined,
          ledger,
          tradeRecords: tradeRecordsFromLedger(ledger)
        }
      ]
    })
  )
}

export const DEFAULT_WATCHLIST_COLUMN_ORDER = [
  'stock',
  'latest',
  'changePercent',
  'sinceAddedChange',
  'dividendFinancingRatio',
  'valueTags',
  'open',
  'trading',
  'amount',
  'radar',
  'positionQuantity',
  'marketValue',
  'totalProfit',
  'todayProfit',
  'operation'
] as const

export type WatchlistColumnId = (typeof DEFAULT_WATCHLIST_COLUMN_ORDER)[number]
export const WATCHLIST_COLUMN_ORDER_VERSION = 11

export function normalizeWatchlistColumnOrder(
  columnOrder: readonly string[] | undefined
): WatchlistColumnId[] {
  const source = columnOrder ?? DEFAULT_WATCHLIST_COLUMN_ORDER
  const validColumns = new Set<WatchlistColumnId>(DEFAULT_WATCHLIST_COLUMN_ORDER)
  const normalized = source.filter(
    (columnId, index): columnId is WatchlistColumnId =>
      columnId !== 'stock' &&
      columnId !== 'operation' &&
      validColumns.has(columnId as WatchlistColumnId) &&
      source.indexOf(columnId) === index
  )
  const missingColumns = DEFAULT_WATCHLIST_COLUMN_ORDER.filter(
    (columnId) => columnId !== 'stock' && columnId !== 'operation' && !normalized.includes(columnId)
  )
  return ['stock', ...normalized, ...missingColumns, 'operation']
}

export interface StockSectorQuote {
  code: string
  name: string
  quoteId: string
  changePercent: number | null
}

export type FiveLevelLargeOrderSide = 'buy' | 'sell'

export interface FiveLevelLargeOrderAlert {
  side: FiveLevelLargeOrderSide
  level: number
  price: number | null
  volume: number
  otherLevelsVolume: number
}

export interface StockQuote {
  code: string
  name: string
  quoteId: string
  market?: import('./stock-market').StockMarket
  currency?: import('./stock-market').StockCurrency
  volumeUnit?: import('./stock-market').StockVolumeUnit
  source?: StockQuoteSource
  latest: number | null
  change: number | null
  changePercent: number | null
  open: number | null
  high: number | null
  low: number | null
  previousClose: number | null
  volume: number | null
  amount: number | null
  turnoverRate: number | null
  totalMarketValue?: number | null
  priceEarningsRatioTtm?: number | null
  priceBookRatio?: number | null
  sector?: StockSectorQuote
  radarSignals?: StockRadarSignal[]
  fiveLevelLargeOrders?: FiveLevelLargeOrderAlert[]
  updatedAt: string
  dataAt?: string
}

export type StockQuoteSource =
  'eastmoney-primary' | 'eastmoney-mirror' | 'tencent' | 'sina' | 'demo'

export type StockQuoteDataState = 'live' | 'closed' | 'stale' | 'unknown'

export interface OrderBookLevel {
  price: number | null
  volume: number | null
}

export interface StockOrderBook {
  quoteId: string
  name: string
  latest: number | null
  previousClose: number | null
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  updatedAt: string
  dataState?: 'live' | 'cached' | 'stale'
  refreshError?: string
}

export interface StockRadarSignal {
  type: string
  label: string
  date: string
  time: string
  info: string
  direction: 'up' | 'down'
}

export type KlinePeriod = 'intraday' | 'fiveDay' | 'daily' | 'weekly' | 'monthly'

export interface KlineBar {
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  turnoverRate?: number
}

export interface KlineResult {
  quoteId: string
  name: string
  tradingDate: string
  bars: KlineBar[]
  intervalMinutes?: 1 | 5
  fallbackReason?: string
  source?: StockQuoteSource
  adjustment?: 'forward' | 'none'
  fetchedAt?: string
  fromCache?: boolean
}

export type TechnicalPatternSignalType =
  'longUpperShadow' | 'longLowerShadow' | 'bollingerNarrowing' | 'bollingerExpansion'

export type DailyMarketScanSignalType =
  | 'volumeSurge'
  | 'strongGain'
  | 'strongLoss'
  | 'breakout20d'
  | 'breakdown20d'
  | 'reversal'
  | TechnicalPatternSignalType

export interface DailyMarketScanRow {
  code: string
  name: string
  quoteId: string
  marketLabel: string
  tradingDate: string
  latest: number
  changePercent: number
  amount: number
  volume: number
  averageVolume20d: number
  volumeRatio: number
  turnoverRate?: number | null
  breakoutPercent: number | null
  breakdownPercent?: number | null
  previousFiveDayReturn: number
  declineDays: number
  signals: DailyMarketScanSignalType[]
}

export interface DailyMarketScanResult {
  schemaVersion: 1
  tradingDate: string
  generatedAt: string
  source: string
  universeCount: number
  activeCount: number
  klineSuccessCount: number
  klineFailureCount: number
  signalCount: number
  rows: DailyMarketScanRow[]
}

export type DailyMarketScanStage =
  'idle' | 'quotes' | 'klines' | 'calculating' | 'completed' | 'failed'

export interface DailyMarketScanProgress {
  stage: DailyMarketScanStage
  message: string
  completed: number
  total: number
}

export interface DailyMarketScanState {
  running: boolean
  progress: DailyMarketScanProgress
  error: string | null
}

export interface ChipDistributionBucket {
  price: number
  percent: number
}

export interface ChipDistributionCostRange {
  low: number
  high: number
  concentration: number
}

export interface ChipDistributionData {
  startDate: string
  endDate: string
  barCount: number
  cumulativeTurnover: number
  currentPrice: number
  averageCost: number
  profitPercent: number
  cost70: ChipDistributionCostRange
  cost90: ChipDistributionCostRange
  buckets: ChipDistributionBucket[]
}

export interface ChipDistributionCacheEntry extends ChipDistributionData {
  quoteId: string
  name: string
  calculatedAt: string
}

export interface FundsFlowPoint {
  time: string
  main: number
  superLarge: number
  large: number
  medium: number
  small: number
}

export interface FundsFlowResult {
  quoteId: string
  name: string
  tradingDate: string
  points: FundsFlowPoint[]
}

export interface SectorIndexResult {
  stockQuoteId: string
  boardCode: string
  boardName: string
  boardQuoteId: string
  quote: StockQuote
  trend: KlineResult
}

export interface SearchResult {
  code: string
  name: string
  quoteId: string
  marketLabel: string
  market: import('./stock-market').StockMarket
  exchange: import('./stock-market').StockExchange
  currency: import('./stock-market').StockCurrency
  instrumentType: import('./stock-market').StockInstrumentType
}

export type ShareholderMarket = 'SH' | 'SZ' | 'BJ'

export interface ShareholderController {
  name: string
  holdingRatio: number | null
}

export interface ShareholderCountPoint {
  reportDate: string
  holderCount: number
  changePercent: number | null
  averageFreeShares: number | null
  averageFreeSharesChangePercent: number | null
  concentration: string | null
  averageHoldingAmount: number | null
  topTenHoldingRatio: number | null
  topTenFreeHoldingRatio: number | null
}

export interface ShareholderHolding {
  reportDate: string
  rank: number
  name: string
  holderType: string | null
  sharesType: string | null
  holdingShares: number
  holdingRatio: number | null
  changeShares: number | null
  changeLabel: string | null
  changeRatio: number | null
}

export interface ShareholderSnapshot {
  schemaVersion: 1
  quoteId: string
  code: string
  market: ShareholderMarket
  reportDate: string
  fetchedAt: string
  source: 'eastmoney-f10'
  fromCache: boolean
  warning?: string
  controller: ShareholderController | null
  latestSummary: ShareholderCountPoint | null
  holderHistory: ShareholderCountPoint[]
  topShareholders: ShareholderHolding[]
  topFreeShareholders: ShareholderHolding[]
}

export type DividendFinancingMarket = 'SH' | 'SZ' | 'BJ'

export type DividendTrend = 'growing' | 'stable' | 'declining' | 'insufficient'

export interface AnnualDividendPoint {
  year: number
  amountYi: number
  eventCount: number
}

export interface DividendFinancingEvent {
  date: string
  type: 'IPO' | '增发' | '配股'
  amountYi: number
}

export interface DividendFinancingQualityScoreBreakdown {
  ratio: number
  netReturn: number
  continuity: number
  growth: number
  financingDiscipline: number
}

export interface DividendFinancingRankingItem {
  rank: number
  code: string
  name: string
  market: DividendFinancingMarket
  dividendYi: number
  financingYi: number
  ratio: number
  dividendYield?: number | null
  netReturnYi?: number
  listingYear?: number
  listedYears?: number
  dividendYears?: number
  consecutiveDividendYears?: number
  lastDividendYear?: number | null
  recent3YearDividendYi?: number
  recent5YearDividendYi?: number
  recentDividendTrendPercent?: number | null
  dividendTrend?: DividendTrend
  annualDividends?: AnnualDividendPoint[]
  financingEvents?: DividendFinancingEvent[]
  financingCount?: number
  lastFinancingDate?: string | null
  yearsSinceLastFinancing?: number | null
  qualityScore?: number
  scoreRank?: number
  qualityScoreBreakdown?: DividendFinancingQualityScoreBreakdown
}

export interface DividendFinancingSnapshot {
  schemaVersion: 1 | 2
  scoreMethodologyVersion?: 1
  snapshotDate: string
  generatedAt: string
  thresholdPercent: number
  activeStockCount: number
  exactCandidateCount: number
  dualListedCount: number
  financingErrorCount: number
  dividendErrorCount: number
  rows: DividendFinancingRankingItem[]
}

export interface DividendFinancingOverview {
  schemaVersion: 1
  snapshotDate: string
  generatedAt: string
  recordCount: number
  rows: DividendFinancingRankingItem[]
}

export type DividendFinancingChangeType =
  'added' | 'removed' | 'rank' | 'ratio' | 'dividend' | 'financing'

export interface DividendFinancingChangeItem {
  code: string
  name: string
  market: DividendFinancingMarket
  changeTypes: DividendFinancingChangeType[]
  previousRank: number | null
  currentRank: number | null
  rankChange: number | null
  previousRatio: number | null
  currentRatio: number | null
  ratioChange: number | null
  dividendIncreaseYi: number
  financingIncreaseYi: number
  previousQualityScore: number | null
  currentQualityScore: number | null
  qualityScoreChange: number | null
}

export interface DividendFinancingChangeReport {
  schemaVersion: 1
  previousSnapshotDate: string
  currentSnapshotDate: string
  generatedAt: string
  summary: {
    addedCount: number
    removedCount: number
    rankChangedCount: number
    ratioChangedCount: number
    dividendIncreasedCount: number
    financingIncreasedCount: number
  }
  rows: DividendFinancingChangeItem[]
}

export interface DividendFinancingUpdateProgress {
  stage: 'running' | 'completed' | 'failed'
  message: string
}

export interface DividendFinancingUpdateResult {
  snapshot: DividendFinancingSnapshot
  changeReport: DividendFinancingChangeReport | null
  reportPath: string
  diagnosticsPath: string
}

export type DataSnapshotStatus = 'missing' | 'queued' | 'updating' | 'ready' | 'stale' | 'failed'

export interface DataSnapshotRuntimeState {
  status: DataSnapshotStatus
  progressMessage: string | null
  error: string | null
  snapshotDate: string | null
  generatedAt: string | null
  recordCount: number
  periodLabel: string | null
  staleReason: string | null
}

export type FundamentalOrganizationType = 'general' | 'bank' | 'securities' | 'insurance' | 'other'

export interface FundamentalAnnualReport {
  year: number
  reportDate: string
  noticeDate: string | null
  weightedAverageRoe: number | null
  deductedWeightedAverageRoe: number | null
  roic?: number | null
  netProfit: number | null
  parentNetProfit: number | null
  deductedParentNetProfit: number | null
  operatingCashFlow: number | null
  capitalExpenditure?: number | null
  freeCashFlow?: number | null
}

export interface FundamentalBalanceSheet {
  reportDate: string
  noticeDate: string | null
  totalAssets: number | null
  totalLiabilities: number | null
  debtAssetRatio: number | null
  industryPercentile: number | null
  monetaryFunds?: number | null
  interestBearingDebt?: number | null
  netDebt?: number | null
}

export interface FundamentalQuarterlyRiskReport {
  reportDate: string
  noticeDate: string | null
  operatingCashFlowCumulative: number | null
  operatingCashFlowQuarter: number | null
  accountsReceivable: number | null
  accountsReceivableGrowthYoY: number | null
  totalOperatingRevenue: number | null
  revenueGrowthYoY: number | null
  receivableRevenueDivergence: number | null
  inventory: number | null
  operatingCost: number | null
  inventoryTurnoverDays: number | null
  inventoryDaysChangeYoY: number | null
  goodwill: number | null
  totalAssets: number | null
  goodwillAssetRatio: number | null
}

export interface FundamentalValuationSnapshot {
  dataDate: string
  closePrice?: number | null
  priceEarningsRatioTtm: number | null
  priceBookRatio: number | null
  priceCashFlowRatioTtm?: number | null
  totalMarketValue?: number | null
  circulatingMarketValue?: number | null
  priceEarningsIndustryPercentile: number | null
  priceBookIndustryPercentile: number | null
  priceCashFlowIndustryPercentile?: number | null
  priceEarningsIndustrySampleSize: number
  priceBookIndustrySampleSize: number
  priceCashFlowIndustrySampleSize?: number
}

export type CompanyReportType =
  'annual' | 'semiannual' | 'quarterly' | 'firstQuarter' | 'thirdQuarter' | 'current'

export type CompanyReportVariant = 'full' | 'summary' | 'english'
export type CompanyReportSource = '巨潮资讯' | 'SEC EDGAR' | 'HKEXnews'
export type CompanyReportFormat = 'pdf' | 'html'

export interface CompanyReportSummarySections {
  managementDiscussion: string | null
  auditOpinion: string | null
  financialStatementNotes: string | null
  aiConclusion: string
}

export interface CompanyReportSummary {
  reportId: string
  code: string
  quoteId?: string
  content: string
  managementDiscussion?: string | null
  auditOpinion?: string | null
  financialStatementNotes?: string | null
  aiConclusion?: string
  reportTitle?: string
  reportType?: CompanyReportType
  reportYear?: number
  publishedAt?: string
  generatedAt: string
  providerId: string
  model: string
}

export interface CompanyReportItem {
  id: string
  code: string
  quoteId?: string
  market?: StockMarket
  source?: CompanyReportSource
  title: string
  reportType: CompanyReportType
  reportYear: number
  variant: CompanyReportVariant
  amended: boolean
  publishedAt: string
  url: string
  format?: CompanyReportFormat
  formType?: string
  fiscalPeriod?: string
  periodEnd?: string
  summary?: CompanyReportSummary
}

export interface CompanyReportLibraryResult {
  code: string
  quoteId?: string
  market?: StockMarket
  source: CompanyReportSource
  periodStart: string
  periodEnd: string
  fetchedAt: string
  fromCache: boolean
  warning?: string
  reports: CompanyReportItem[]
}

export type GlobalFinancialMetricId =
  | 'revenue'
  | 'grossProfit'
  | 'operatingIncome'
  | 'netIncome'
  | 'dilutedEps'
  | 'totalAssets'
  | 'totalLiabilities'
  | 'stockholdersEquity'
  | 'cashAndEquivalents'
  | 'totalDebt'
  | 'operatingCashFlow'
  | 'capitalExpenditure'
  | 'freeCashFlow'
  | 'grossMargin'
  | 'netMargin'
  | 'roe'
  | 'debtAssetRatio'

export interface GlobalFinancialMetric {
  id: GlobalFinancialMetricId
  label: string
  value: number
  unit: 'currency' | 'perShare' | 'percent'
  currency?: string
  derivation: 'reported' | 'calculated'
  rawConcept?: string
}

export interface GlobalFinancialPeriod {
  id: string
  periodType: 'annual' | 'interim' | 'ttm'
  fiscalYear: number
  fiscalPeriod: string
  periodStart?: string
  periodEnd: string
  filedAt: string
  formType: string
  sourceUrl: string
  metrics: GlobalFinancialMetric[]
}

export interface GlobalFundamentalSnapshot {
  schemaVersion: 1
  quoteId: string
  market: 'HK' | 'US'
  code: string
  name: string
  officialIssuerId: string
  accountingStandard: 'US GAAP' | 'IFRS' | 'HKFRS' | '未识别'
  reportingCurrency: string | null
  fiscalYearEnd?: string
  fetchedAt: string
  fromCache: boolean
  warning?: string
  source: {
    name: 'SEC Company Facts' | 'HKEXnews'
    url: string
  }
  periods: GlobalFinancialPeriod[]
}

export interface FundamentalCompany {
  code: string
  name: string
  market: DividendFinancingMarket
  quoteId: string
  organizationType: FundamentalOrganizationType
  industryCode: string
  industryName: string
  annualReports: FundamentalAnnualReport[]
  quarterlyRiskReports?: FundamentalQuarterlyRiskReport[]
  latestBalanceSheet: FundamentalBalanceSheet
  valuation?: FundamentalValuationSnapshot
}

export interface FundamentalIndustryBenchmark {
  code: string
  name: string
  sampleSize: number
  debtAssetRatioP60: number
}

export interface FundamentalSnapshot {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7
  snapshotDate: string
  generatedAt: string
  currency: 'CNY'
  fiscalYears: number[]
  latestAnnualReportDate: string
  latestQuarterlyReportDate?: string
  sources: Array<{
    name: string
    reportName: string
    url: string
  }>
  coverage: {
    companyCount: number
    completeFiveYearRoeCount: number
    completeFiveYearCashProfitCount: number
    completeFiveYearFreeCashFlowCount?: number
    completeFiveYearRoicCount?: number
    latestDebtAssetRatioCount: number
    latestIndustryPercentileCount: number
    latestNetDebtCount?: number
    latestValuationCount?: number
    latestTotalMarketValueCount?: number
    latestCirculatingMarketValueCount?: number
    latestPriceEarningsIndustryPercentileCount?: number
    latestPriceBookIndustryPercentileCount?: number
    latestPriceCashFlowIndustryPercentileCount?: number
    latestQuarterlyRiskReportCount?: number
    completeQuarterlyRiskIndicatorCount?: number
    industryCount: number
  }
  industries: FundamentalIndustryBenchmark[]
  rows: FundamentalCompany[]
}

export interface FundamentalPeerMetricComparison {
  value: number | null
  sampleSize: number
  rank: number | null
  topPercent: number | null
  betterThanPercent: number | null
}

export interface FundamentalPeerComparison {
  industryCode: string
  industryName: string
  roe: FundamentalPeerMetricComparison
  cash: FundamentalPeerMetricComparison
  debt: FundamentalPeerMetricComparison
}

export interface FundamentalOverviewRecord {
  company: FundamentalCompany
  industryBenchmark: FundamentalIndustryBenchmark | null
  peerComparison: FundamentalPeerComparison | null
}

export interface FundamentalOverview {
  schemaVersion: 1
  snapshotSchemaVersion: FundamentalSnapshot['schemaVersion']
  snapshotDate: string
  generatedAt: string
  fiscalYears: number[]
  latestAnnualReportDate: string
  latestQuarterlyReportDate?: string
  recordCount: number
  rows: FundamentalOverviewRecord[]
}

export interface StockValuationHistory {
  quoteId: string
  fetchedAt: string
  periodStart: string | null
  periodEnd: string | null
  priceEarningsRatioTtmValues: number[]
  priceBookRatioValues: number[]
  priceCashFlowRatioTtmValues: number[]
}

export interface StockValuationMetricAnalysis {
  currentValue: number | null
  historicalPercentile: number | null
  historicalSampleSize: number
  industryPercentile: number | null
  industrySampleSize: number
  industryBasisValue: number | null
}

export type StockPriceCashFlowUnavailableReason =
  'not-applicable' | 'cash-flow' | 'non-positive-cash-flow' | 'market-value'

export type StockPriceCashFlowPeRelation =
  'cash-rich' | 'matched' | 'cash-lagging' | 'persistent-gap' | 'unavailable'

export interface StockPriceCashFlowAnalysis extends StockValuationMetricAnalysis {
  operatingCashFlowTtm: number | null
  reportDate: string | null
  unavailableReason: StockPriceCashFlowUnavailableReason | null
  priceEarningsComparisonRatio: number | null
  relation: StockPriceCashFlowPeRelation
  persistentGapYears: number
}

export interface StockValuationAnalysis {
  quoteId: string
  quoteDataAt: string | null
  historyFetchedAt: string | null
  historyPeriodStart: string | null
  historyPeriodEnd: string | null
  industryDataAt: string | null
  totalMarketValue: number | null
  circulatingMarketValue: number | null
  priceEarningsRatioTtm: StockValuationMetricAnalysis
  priceBookRatio: StockValuationMetricAnalysis
  priceCashFlowRatioTtm: StockPriceCashFlowAnalysis
}

export type FundamentalChangeRuleStatus = 'passed' | 'failed' | 'missing' | 'not-applicable'

export type FundamentalChangeScreeningStatus =
  'passed' | 'review' | 'missing' | 'financial' | 'unavailable'

export type FundamentalChangeType =
  | 'addedCoverage'
  | 'removedCoverage'
  | 'entered'
  | 'exited'
  | 'reviewAdded'
  | 'reviewResolved'
  | 'dataCompleted'
  | 'dataMissing'
  | 'organizationChanged'

export interface FundamentalChangeMetrics {
  minimumRoe: number | null
  cumulativeCashConversion: number | null
  debtIndustryPercentile: number | null
}

export interface FundamentalRuleChange {
  rule: 'roe' | 'cash' | 'debt'
  previousStatus: FundamentalChangeRuleStatus
  currentStatus: FundamentalChangeRuleStatus
}

export interface FundamentalChangeItem {
  code: string
  name: string
  market: DividendFinancingMarket
  industryName: string
  changeTypes: FundamentalChangeType[]
  previousStatus: FundamentalChangeScreeningStatus
  currentStatus: FundamentalChangeScreeningStatus
  previousOrganizationType: FundamentalOrganizationType | null
  currentOrganizationType: FundamentalOrganizationType | null
  previousMetrics: FundamentalChangeMetrics | null
  currentMetrics: FundamentalChangeMetrics | null
  ruleChanges: FundamentalRuleChange[]
}

export interface FundamentalChangeReport {
  schemaVersion: 1
  previousSnapshotDate: string
  currentSnapshotDate: string
  previousFiscalYears: number[]
  currentFiscalYears: number[]
  generatedAt: string
  summary: {
    enteredCount: number
    exitedCount: number
    reviewAddedCount: number
    reviewResolvedCount: number
    dataChangedCount: number
    addedCoverageCount: number
    removedCoverageCount: number
    organizationChangedCount: number
  }
  rows: FundamentalChangeItem[]
}

export interface FundamentalUpdateProgress {
  stage: 'running' | 'completed' | 'failed'
  message: string
}

export interface FundamentalUpdateResult {
  snapshot: FundamentalSnapshot
  changeReport: FundamentalChangeReport | null
  snapshotPath: string
  diagnosticsPath: string
}

export const BUILT_IN_TRADING_CALENDAR_END_YEAR = BUILT_IN_MARKET_CALENDAR_END_YEARS.CN

export interface MarketTradingCalendarSettings {
  closedDates: string[]
  halfDayDates: string[]
  coveredThroughYear: number
  source: MarketCalendarSource
  lastRefreshedAt: string | null
  lastCheckedYear: number | null
  lastAttemptedAt: string | null
  lastError: string | null
}

export interface TradingCalendarSettings {
  markets: Record<StockMarket, MarketTradingCalendarSettings>
  closedDates: string[]
  coveredThroughYear: number
  lastRefreshedAt: string | null
  lastCheckedYear: number | null
  lastAttemptedAt: string | null
  lastError: string | null
}

export interface ExchangeRateSettings {
  baseCurrency: 'CNY'
  rates: Record<import('./stock-market').StockCurrency, number | null>
  manualOverrides: Partial<Record<'HKD' | 'USD', number>>
  rateDate: string | null
  fetchedAt: string | null
  lastCheckedDate: string | null
  lastAttemptedAt: string | null
  lastError: string | null
  source: 'safe-cfets'
}

export const DEFAULT_EXCHANGE_RATE_SETTINGS: ExchangeRateSettings = {
  baseCurrency: 'CNY',
  rates: { CNY: 1, HKD: null, USD: null },
  manualOverrides: {},
  rateDate: null,
  fetchedAt: null,
  lastCheckedDate: null,
  lastAttemptedAt: null,
  lastError: null,
  source: 'safe-cfets'
}

function defaultMarketTradingCalendar(market: StockMarket): MarketTradingCalendarSettings {
  const calendar = builtInMarketCalendar(market)
  return {
    closedDates: [...calendar.closedDates],
    halfDayDates: [...calendar.halfDayDates],
    coveredThroughYear: BUILT_IN_MARKET_CALENDAR_END_YEARS[market],
    source: market === 'US' ? 'nyse-rules' : 'built-in',
    lastRefreshedAt: null,
    lastCheckedYear: null,
    lastAttemptedAt: null,
    lastError: null
  }
}

const DEFAULT_MARKET_TRADING_CALENDARS: Record<StockMarket, MarketTradingCalendarSettings> = {
  CN: defaultMarketTradingCalendar('CN'),
  HK: defaultMarketTradingCalendar('HK'),
  US: defaultMarketTradingCalendar('US')
}

export const DEFAULT_TRADING_CALENDAR_SETTINGS: TradingCalendarSettings = {
  markets: structuredClone(DEFAULT_MARKET_TRADING_CALENDARS),
  closedDates: [],
  coveredThroughYear: BUILT_IN_TRADING_CALENDAR_END_YEAR,
  lastRefreshedAt: null,
  lastCheckedYear: null,
  lastAttemptedAt: null,
  lastError: null
}

export const DEFAULT_T_PLAN_SETTINGS: TPlanDefaultSettings = {
  buyLevels: [1, 2, 3, 4, 5].map((targetPercent) => ({
    targetPercent,
    quantity: 100
  })),
  sellLevels: [1, 2, 3, 4, 5].map((targetPercent) => ({
    targetPercent,
    quantity: 100
  }))
}

export type AppThemePreference = 'system' | 'light' | 'dark'
export type DailyKlineIndicator = 'movingAverage' | 'bollinger' | 'none'

export interface AppSettings {
  theme: AppThemePreference
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  marketIndexIds: MarketIndexId[]
  startWithWindows: boolean
  minimizeToTray: boolean
  showTaskbarTicker: boolean
  showChipDistribution: boolean
  showBollingerBands: boolean
  dailyKlineIndicator: DailyKlineIndicator
  taskbarPositionPercent: number
  tTradingFees: TTradingFeeSettings
  marketTradeFees: MarketTradeFeeSettings
  tPlanDefaults: TPlanDefaultSettings
  tFloatingProfitAlertDefaultThreshold: number
  tradingCalendar: TradingCalendarSettings
  exchangeRates: ExchangeRateSettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  priorityRefreshSeconds: 5,
  regularRefreshSeconds: 10,
  marketIndexIds: [...DEFAULT_MARKET_INDEX_IDS],
  startWithWindows: false,
  minimizeToTray: true,
  showTaskbarTicker: true,
  showChipDistribution: false,
  showBollingerBands: true,
  dailyKlineIndicator: 'movingAverage',
  taskbarPositionPercent: 0,
  tTradingFees: { ...DEFAULT_T_TRADING_FEE_SETTINGS },
  marketTradeFees: structuredClone(DEFAULT_MARKET_TRADE_FEE_SETTINGS),
  tPlanDefaults: structuredClone(DEFAULT_T_PLAN_SETTINGS),
  tFloatingProfitAlertDefaultThreshold: DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD,
  tradingCalendar: structuredClone(DEFAULT_TRADING_CALENDAR_SETTINGS),
  exchangeRates: structuredClone(DEFAULT_EXCHANGE_RATE_SETTINGS)
}

export function normalizeExchangeRateSettings(
  settings: Partial<ExchangeRateSettings> | undefined
): ExchangeRateSettings {
  const positiveRate = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  const manualOverrides: ExchangeRateSettings['manualOverrides'] = {}
  const manualHkd = positiveRate(settings?.manualOverrides?.HKD)
  const manualUsd = positiveRate(settings?.manualOverrides?.USD)
  if (manualHkd !== null) manualOverrides.HKD = manualHkd
  if (manualUsd !== null) manualOverrides.USD = manualUsd
  return {
    baseCurrency: 'CNY',
    rates: {
      CNY: 1,
      HKD: positiveRate(settings?.rates?.HKD),
      USD: positiveRate(settings?.rates?.USD)
    },
    manualOverrides,
    rateDate: settings?.rateDate ?? null,
    fetchedAt: settings?.fetchedAt ?? null,
    lastCheckedDate: settings?.lastCheckedDate ?? null,
    lastAttemptedAt: settings?.lastAttemptedAt ?? null,
    lastError: settings?.lastError ?? null,
    source: 'safe-cfets'
  }
}

function normalizeTTradingFeeSettings(
  settings: Partial<TTradingFeeSettings> | undefined
): TTradingFeeSettings {
  return {
    commissionRatePerTenThousand: Math.max(
      0,
      settings?.commissionRatePerTenThousand ??
        DEFAULT_T_TRADING_FEE_SETTINGS.commissionRatePerTenThousand
    ),
    minimumCommissionBundle: Math.max(
      0,
      settings?.minimumCommissionBundle ?? DEFAULT_T_TRADING_FEE_SETTINGS.minimumCommissionBundle
    ),
    handlingRatePerTenThousand: Math.max(
      0,
      settings?.handlingRatePerTenThousand ??
        DEFAULT_T_TRADING_FEE_SETTINGS.handlingRatePerTenThousand
    ),
    regulatoryRatePerTenThousand: Math.max(
      0,
      settings?.regulatoryRatePerTenThousand ??
        DEFAULT_T_TRADING_FEE_SETTINGS.regulatoryRatePerTenThousand
    ),
    transferRatePerTenThousand: Math.max(
      0,
      settings?.transferRatePerTenThousand ??
        DEFAULT_T_TRADING_FEE_SETTINGS.transferRatePerTenThousand
    ),
    stampDutyRatePerTenThousand: Math.max(
      0,
      settings?.stampDutyRatePerTenThousand ??
        DEFAULT_T_TRADING_FEE_SETTINGS.stampDutyRatePerTenThousand
    )
  }
}

function normalizeMarketTradeFeeSettings(
  settings: Partial<MarketTradeFeeSettings> | undefined
): MarketTradeFeeSettings {
  return {
    HK: {
      brokerageRatePercent: Math.max(
        0,
        settings?.HK?.brokerageRatePercent ??
          DEFAULT_MARKET_TRADE_FEE_SETTINGS.HK.brokerageRatePercent
      ),
      minimumBrokerage: Math.max(
        0,
        settings?.HK?.minimumBrokerage ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.HK.minimumBrokerage
      ),
      platformFee: Math.max(
        0,
        settings?.HK?.platformFee ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.HK.platformFee
      ),
      includeSettlementFee:
        settings?.HK?.includeSettlementFee ??
        DEFAULT_MARKET_TRADE_FEE_SETTINGS.HK.includeSettlementFee
    },
    US: {
      commissionPerShare: Math.max(
        0,
        settings?.US?.commissionPerShare ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.US.commissionPerShare
      ),
      minimumCommission: Math.max(
        0,
        settings?.US?.minimumCommission ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.US.minimumCommission
      ),
      platformFee: Math.max(
        0,
        settings?.US?.platformFee ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.US.platformFee
      ),
      includeSecFee:
        settings?.US?.includeSecFee ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.US.includeSecFee,
      includeFinraTaf:
        settings?.US?.includeFinraTaf ?? DEFAULT_MARKET_TRADE_FEE_SETTINGS.US.includeFinraTaf
    }
  }
}

function normalizeTPlanDefaultLevels(
  levels: readonly Partial<TPlanDefaultLevel>[] | undefined,
  fallbacks: readonly TPlanDefaultLevel[]
): TPlanDefaultLevel[] {
  return fallbacks.map((fallback, index) => ({
    targetPercent: Math.max(0, levels?.[index]?.targetPercent ?? fallback.targetPercent),
    quantity: Math.max(0, levels?.[index]?.quantity ?? fallback.quantity)
  }))
}

function normalizeTPlanDefaultSettings(
  settings: Partial<TPlanDefaultSettings> | undefined
): TPlanDefaultSettings {
  return {
    buyLevels: normalizeTPlanDefaultLevels(settings?.buyLevels, DEFAULT_T_PLAN_SETTINGS.buyLevels),
    sellLevels: normalizeTPlanDefaultLevels(
      settings?.sellLevels,
      DEFAULT_T_PLAN_SETTINGS.sellLevels
    )
  }
}

export function normalizeTradingCalendarSettings(
  calendar: Partial<TradingCalendarSettings> | undefined
): TradingCalendarSettings {
  const validDates = (dates: readonly string[] | undefined) =>
    [...new Set((dates ?? []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
  const storedMarkets = calendar?.markets as
    Partial<Record<StockMarket, Partial<MarketTradingCalendarSettings>>> | undefined
  const normalizeMarket = (market: StockMarket): MarketTradingCalendarSettings => {
    const defaults = DEFAULT_MARKET_TRADING_CALENDARS[market]
    const stored = storedMarkets?.[market]
    return {
      closedDates: validDates([...defaults.closedDates, ...(stored?.closedDates ?? [])]),
      halfDayDates: validDates([...defaults.halfDayDates, ...(stored?.halfDayDates ?? [])]),
      coveredThroughYear: Math.max(
        defaults.coveredThroughYear,
        stored?.coveredThroughYear ?? defaults.coveredThroughYear
      ),
      source: stored?.source ?? defaults.source,
      lastRefreshedAt: stored?.lastRefreshedAt ?? null,
      lastCheckedYear: stored?.lastCheckedYear ?? null,
      lastAttemptedAt: stored?.lastAttemptedAt ?? null,
      lastError: stored?.lastError ?? null
    }
  }
  const markets = {
    CN: normalizeMarket('CN'),
    HK: normalizeMarket('HK'),
    US: normalizeMarket('US')
  }
  const cnCalendar = markets.CN
  return {
    markets,
    closedDates: cnCalendar.closedDates,
    coveredThroughYear: cnCalendar.coveredThroughYear,
    lastRefreshedAt: cnCalendar.lastRefreshedAt,
    lastCheckedYear: cnCalendar.lastCheckedYear,
    lastAttemptedAt: cnCalendar.lastAttemptedAt,
    lastError: cnCalendar.lastError
  }
}

export function marketTradingCalendar(
  settings: TradingCalendarSettings,
  market: StockMarket
): MarketTradingCalendarSettings {
  return settings.markets[market]
}

export function normalizeAppSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const dailyKlineIndicator =
    settings?.dailyKlineIndicator === 'movingAverage' ||
    settings?.dailyKlineIndicator === 'bollinger' ||
    settings?.dailyKlineIndicator === 'none'
      ? settings.dailyKlineIndicator
      : settings?.showBollingerBands === undefined
        ? DEFAULT_APP_SETTINGS.dailyKlineIndicator
        : settings.showBollingerBands
          ? 'bollinger'
          : 'none'

  return {
    theme: settings?.theme === 'light' || settings?.theme === 'dark' ? settings.theme : 'system',
    priorityRefreshSeconds: Math.min(
      300,
      Math.max(3, settings?.priorityRefreshSeconds ?? DEFAULT_APP_SETTINGS.priorityRefreshSeconds)
    ),
    regularRefreshSeconds: Math.min(
      300,
      Math.max(3, settings?.regularRefreshSeconds ?? DEFAULT_APP_SETTINGS.regularRefreshSeconds)
    ),
    marketIndexIds: normalizeMarketIndexIds(settings?.marketIndexIds),
    startWithWindows: settings?.startWithWindows ?? DEFAULT_APP_SETTINGS.startWithWindows,
    minimizeToTray: settings?.minimizeToTray ?? DEFAULT_APP_SETTINGS.minimizeToTray,
    showTaskbarTicker: settings?.showTaskbarTicker ?? DEFAULT_APP_SETTINGS.showTaskbarTicker,
    showChipDistribution:
      settings?.showChipDistribution ?? DEFAULT_APP_SETTINGS.showChipDistribution,
    showBollingerBands: settings?.showBollingerBands ?? DEFAULT_APP_SETTINGS.showBollingerBands,
    dailyKlineIndicator,
    taskbarPositionPercent: Math.min(
      100,
      Math.max(0, settings?.taskbarPositionPercent ?? DEFAULT_APP_SETTINGS.taskbarPositionPercent)
    ),
    tTradingFees: normalizeTTradingFeeSettings(settings?.tTradingFees),
    marketTradeFees: normalizeMarketTradeFeeSettings(settings?.marketTradeFees),
    tPlanDefaults: normalizeTPlanDefaultSettings(settings?.tPlanDefaults),
    tFloatingProfitAlertDefaultThreshold: Math.max(
      1,
      settings?.tFloatingProfitAlertDefaultThreshold ?? DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD
    ),
    tradingCalendar: normalizeTradingCalendarSettings(settings?.tradingCalendar),
    exchangeRates: normalizeExchangeRateSettings(settings?.exchangeRates)
  }
}

export interface AppState {
  revision?: number
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  stockTrackingProfiles: StockTrackingProfiles
  settings: AppSettings
  columnOrder: WatchlistColumnId[]
  columnOrderVersion?: number
  tTradingAccounts: TTradingAccounts
  corporateActionRecords: CorporateActionRecords
  portfolioPerformanceAdjustments?: PortfolioPerformanceAdjustments
}

export type PortfolioPerformanceAdjustments = Record<string, number>

export function normalizePortfolioPerformanceAdjustments(
  adjustments: PortfolioPerformanceAdjustments | undefined,
  watchlist: readonly WatchStock[]
): PortfolioPerformanceAdjustments {
  const quoteIds = new Set(watchlist.map((stock) => stock.quoteId))
  return Object.fromEntries(
    Object.entries(adjustments ?? {}).filter(
      ([quoteId, value]) => quoteIds.has(quoteId) && Number.isFinite(value) && value !== 0
    )
  )
}

export type CompletionNotificationTarget =
  | 'reports'
  | 'corporate-actions'
  | 'corporate-action-center'
  | 'ai-short-term'
  | 'ai-long-term'
  | 't-advice'

export type StockCompletionNotificationTarget = Exclude<
  CompletionNotificationTarget,
  'corporate-action-center'
>

export type StockDetailNavigationTarget = StockCompletionNotificationTarget | 'trend' | 'tracking'

interface AppCompletionNotificationBase {
  id: string
  message: string
  createdAt: string
}

export type AppCompletionNotification =
  | (AppCompletionNotificationBase & {
      quoteId: string
      target: StockCompletionNotificationTarget
    })
  | (AppCompletionNotificationBase & {
      quoteId?: never
      target: 'corporate-action-center'
    })

export interface ConfigExportResult {
  canceled: boolean
  filePath?: string
  fileCount?: number
  apiKeyCount?: number
}

export interface UserDataBackupSummary {
  applicationVersion: string
  exportedAt: string
  fileCount: number
  apiKeyCount: number
}

export interface GitHubSyncSettings {
  oauthAvailable: boolean
  connected: boolean
  hasStoredPassword: boolean
  syncPasswordReady: boolean
  requiresRemoteRestore: boolean
  accountLogin?: string
  gistId?: string
  gistUrl?: string
  localDataUpdatedAt?: string
  remoteDataUpdatedAt?: string
  remoteVersion?: string
}

export interface GitHubDeviceAuthorization {
  loginId: string
  userCode: string
  verificationUri: string
  expiresAt: string
}

export interface GitHubLoginResult {
  settings: GitHubSyncSettings
}

export interface GitHubSyncUploadResult {
  gistId: string
  gistUrl: string
  version: string
  uploadedAt: string
  fileName: string
  apiKeyCount: number
}

export interface ConfigImportResult extends ConfigExportResult {
  state?: AppState
  importId?: string
  backupSummary?: UserDataBackupSummary
  githubGistVersion?: string
}

export type CacheCategoryId =
  | 'temporary-market'
  | 'diagnostic-logs'
  | 'shareholders'
  | 'valuations'
  | 'market-insight'
  | 'company-reports'
  | 'corporate-actions'
  | 'data-snapshots'
  | 'electron-web'

export type CacheCategoryGroup = 'default' | 'advanced' | 'separate'

export interface CacheCategorySummary {
  id: CacheCategoryId
  label: string
  description: string
  group: CacheCategoryGroup
  fileCount: number | null
  sizeBytes: number
  latestModifiedAt: string | null
}

export interface CacheSummary {
  generatedAt: string
  categories: CacheCategorySummary[]
}

export interface CacheClearResult {
  categoryIds: CacheCategoryId[]
  clearedFileCount: number
  clearedBytes: number
  webCacheCleared: boolean
  failedPaths: string[]
}

export interface BootstrapResult {
  state: AppState
  quotes: StockQuote[]
  source: 'eastmoney' | 'demo'
  warning?: string
}

export type OptionalModuleId = 'marketInsight' | 'ai' | 'aiTAdvice'
export type OptionalModuleStatus = 'disabled' | 'initializing' | 'ready' | 'failed'

export interface OptionalModuleState {
  status: OptionalModuleStatus
  error: string | null
}

export type OptionalModulesState = Record<OptionalModuleId, OptionalModuleState>

export interface TaskbarLayout {
  taskbarHeight: number
  taskbarEdge: 'top' | 'bottom'
}

export interface TaskbarTooltipAnchor {
  quoteId: string
  left: number
  width: number
}

export interface StockSelectionRequest {
  id: string
  quoteId: string
  scrollAlignment?: 'sticky-top'
  detailTarget?: StockDetailNavigationTarget
}

export interface StockDesktopApi {
  getBootstrap: () => Promise<BootstrapResult>
  getOptionalModulesState: () => Promise<OptionalModulesState>
  getTaskbarLayout: () => Promise<TaskbarLayout>
  getTaskbarTooltipQuoteId: () => Promise<string | null>
  resizeTaskbarTicker: (width: number, height: number) => Promise<void>
  setTaskbarTooltip: (anchor: TaskbarTooltipAnchor | null) => Promise<void>
  resizeTaskbarTooltip: (height: number) => Promise<void>
  searchStocks: (query: string) => Promise<SearchResult[]>
  getDividendFinancingOverview: (codes: string[]) => Promise<DividendFinancingOverview | null>
  getDividendFinancingSnapshot: () => Promise<DividendFinancingSnapshot | null>
  getDividendFinancingState: () => Promise<DataSnapshotRuntimeState>
  getDividendFinancingChangeReport: () => Promise<DividendFinancingChangeReport | null>
  runDividendFinancingUpdate: () => Promise<DividendFinancingUpdateResult>
  getFundamentalOverview: (codes: string[]) => Promise<FundamentalOverview | null>
  getFundamentalSnapshot: () => Promise<FundamentalSnapshot | null>
  getFundamentalState: () => Promise<DataSnapshotRuntimeState>
  getFundamentalChangeReport: () => Promise<FundamentalChangeReport | null>
  runFundamentalUpdate: () => Promise<FundamentalUpdateResult>
  getCompanyReports: (
    quoteId: string,
    forceRefresh?: boolean
  ) => Promise<CompanyReportLibraryResult>
  listCorporateActions: (
    quoteId: string,
    forceRefresh?: boolean
  ) => Promise<CorporateActionListResult>
  previewCorporateAction: (
    request: CorporateActionPreviewRequest
  ) => Promise<CorporateActionImpactPreview>
  confirmCorporateAction: (
    request: CorporateActionPreviewRequest
  ) => Promise<CorporateActionImpactPreview>
  ignoreCorporateAction: (candidate: CorporateActionCandidate) => Promise<CorporateActionRecord>
  reverseCorporateAction: (
    candidate: CorporateActionCandidate,
    account: TTradingAccount
  ) => Promise<ReversalLedgerEntry[]>
  listPortfolioLedger: (account: TTradingAccount) => Promise<PortfolioLedgerEntry[]>
  createManualCorporateAction: (
    request: ManualCorporateActionRequest,
    account: TTradingAccount
  ) => Promise<{ candidate: CorporateActionCandidate; preview: CorporateActionImpactPreview }>
  openCorporateAction: (url: string) => Promise<void>
  getGlobalFundamentals: (
    quoteId: string,
    forceRefresh?: boolean
  ) => Promise<GlobalFundamentalSnapshot>
  generateCompanyReportSummary: (report: CompanyReportItem) => Promise<CompanyReportSummary>
  openCompanyReport: (url: string) => Promise<void>
  getShareholderSnapshot: (quoteId: string, forceRefresh?: boolean) => Promise<ShareholderSnapshot>
  getValuationHistory: (quoteId: string) => Promise<StockValuationHistory>
  refreshQuotes: () => Promise<StockQuote[]>
  refreshQuote: (quoteId: string) => Promise<StockQuote[]>
  refreshQuotesByIds: (quoteIds: string[]) => Promise<StockQuote[]>
  getKline: (quoteId: string, period: KlinePeriod, limit?: number) => Promise<KlineResult>
  getDailyMarketScanResult: () => Promise<DailyMarketScanResult | null>
  getDailyMarketScanState: () => Promise<DailyMarketScanState>
  runDailyMarketScan: () => Promise<DailyMarketScanResult>
  saveChipDistributionCache: (
    entry: ChipDistributionCacheEntry
  ) => Promise<ChipDistributionCacheEntry>
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  getSectorIndex: (quoteId: string) => Promise<SectorIndexResult>
  refreshTradingCalendar: () => Promise<TradingCalendarSettings>
  refreshExchangeRates: () => Promise<ExchangeRateSettings>
  saveState: (state: AppState) => Promise<AppState>
  getCompletionNotifications: () => Promise<AppCompletionNotification[]>
  saveCompletionNotifications: (
    notifications: AppCompletionNotification[]
  ) => Promise<AppCompletionNotification[]>
  exportConfig: (state: AppState) => Promise<ConfigExportResult>
  importConfig: () => Promise<ConfigImportResult>
  applyConfigImport: (importId: string) => Promise<void>
  getCacheSummary: () => Promise<CacheSummary>
  clearCaches: (categoryIds: CacheCategoryId[]) => Promise<CacheClearResult>
  getGitHubSyncSettings: () => Promise<GitHubSyncSettings>
  startGitHubLogin: () => Promise<GitHubDeviceAuthorization>
  completeGitHubLogin: (loginId: string) => Promise<GitHubLoginResult>
  refreshGitHubGist: () => Promise<GitHubSyncSettings>
  getGitHubSyncPassword: () => Promise<string | null>
  generateGitHubSyncPassword: () => Promise<string>
  saveGitHubSyncPassword: (password: string) => Promise<GitHubSyncSettings>
  disconnectGitHub: () => Promise<GitHubSyncSettings>
  uploadUserDataToGitHub: (
    state: AppState,
    overwriteRemote?: boolean
  ) => Promise<GitHubSyncUploadResult>
  downloadUserDataFromGitHub: () => Promise<ConfigImportResult>
  confirmGitHubGistRestore: (version: string) => Promise<GitHubSyncSettings>
  hideWindow: () => Promise<void>
  quitApp: () => Promise<void>
  onQuotesUpdated: (callback: (quotes: StockQuote[]) => void) => () => void
  onStateUpdated: (callback: (state: AppState) => void) => () => void
  onTaskbarLayout: (callback: (layout: TaskbarLayout) => void) => () => void
  onTaskbarTooltipStock: (callback: (quoteId: string) => void) => () => void
  onSelectStock: (callback: (request: StockSelectionRequest) => void) => () => void
  onDataError: (callback: (message: string) => void) => () => void
  onOptionalModulesStateUpdated: (callback: (state: OptionalModulesState) => void) => () => void
  onDividendFinancingUpdateProgress: (
    callback: (progress: DividendFinancingUpdateProgress) => void
  ) => () => void
  onDividendFinancingStateUpdated: (
    callback: (state: DataSnapshotRuntimeState) => void
  ) => () => void
  onFundamentalUpdateProgress: (
    callback: (progress: FundamentalUpdateProgress) => void
  ) => () => void
  onFundamentalStateUpdated: (callback: (state: DataSnapshotRuntimeState) => void) => () => void
  onDailyMarketScanProgress: (callback: (state: DailyMarketScanState) => void) => () => void
}
