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
export const DEFAULT_WATCHLIST_GROUPS: readonly WatchlistGroup[] = [
  { id: DAILY_SCAN_WATCHLIST_GROUP_ID, name: DAILY_SCAN_WATCHLIST_GROUP_NAME },
  { id: TRACKING_WATCHLIST_GROUP_ID, name: TRACKING_WATCHLIST_GROUP_NAME }
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

export function isSystemWatchlistGroup(group: WatchlistGroup): boolean {
  return isDailyScanWatchlistGroup(group) || isTrackingWatchlistGroup(group)
}

export function getTrackingWatchlistGroup(groups: readonly WatchlistGroup[]): WatchlistGroup {
  return groups.find(isTrackingWatchlistGroup) ?? { ...DEFAULT_WATCHLIST_GROUPS[1] }
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
  const systemGroups = [
    dailyScanGroup ?? { ...DEFAULT_WATCHLIST_GROUPS[0] },
    trackingGroup ?? { ...DEFAULT_WATCHLIST_GROUPS[1] }
  ]
  return [
    ...systemGroups.map((group) => ({
      ...group,
      name: isDailyScanWatchlistGroup(group)
        ? DAILY_SCAN_WATCHLIST_GROUP_NAME
        : TRACKING_WATCHLIST_GROUP_NAME
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

export function synchronizeTrackingGroupMembership(
  stocks: readonly WatchStock[],
  groups: readonly WatchlistGroup[],
  profiles: StockTrackingProfiles
): WatchStock[] {
  const trackingGroupId = getTrackingWatchlistGroup(groups).id
  return stocks.map((stock) => {
    const groupIds = new Set(stock.groupIds ?? [])
    if (profiles[stock.quoteId]?.status === 'tracking') groupIds.add(trackingGroupId)
    else groupIds.delete(trackingGroupId)
    return { ...stock, groupIds: [...groupIds] }
  })
}

export function normalizeWatchlist(stocks: readonly WatchStock[]): WatchStock[] {
  return stocks.map((stock) => ({
    ...stock,
    ...stockMarketIdentity(stock.quoteId, stock.instrumentType),
    isPriority: Boolean(stock.position || stock.isPriority),
    showRadarSignals: stock.showRadarSignals ?? true,
    groupIds: [...new Set((stock.groupIds ?? []).filter((groupId) => typeof groupId === 'string'))],
    positionSnapshots: Array.isArray(stock.positionSnapshots)
      ? stock.positionSnapshots.filter(
          (snapshot) =>
            snapshot &&
            typeof snapshot.id === 'string' &&
            typeof snapshot.name === 'string' &&
            typeof snapshot.createdAt === 'string' &&
            Number.isFinite(snapshot.quantity) &&
            snapshot.quantity > 0 &&
            Number.isFinite(snapshot.cost) &&
            snapshot.cost > 0
        )
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
  }))
}

export const MARKET_INDEX_OPTIONS = [
  { id: 'shanghai', code: '000001', name: '上证指数', quoteId: '1.000001', marketLabel: '沪指' },
  { id: 'shenzhen', code: '399001', name: '深证成指', quoteId: '0.399001', marketLabel: '深指' },
  { id: 'chinext', code: '399006', name: '创业板指', quoteId: '0.399006', marketLabel: '创业板' },
  { id: 'sse50', code: '000016', name: '上证50', quoteId: '1.000016', marketLabel: '沪指' },
  { id: 'csi300', code: '000300', name: '沪深300', quoteId: '1.000300', marketLabel: '沪深' },
  { id: 'star50', code: '000688', name: '科创50', quoteId: '1.000688', marketLabel: '科创板' },
  { id: 'csi500', code: '000905', name: '中证500', quoteId: '1.000905', marketLabel: '中证' },
  { id: 'csi1000', code: '000852', name: '中证1000', quoteId: '1.000852', marketLabel: '中证' },
  { id: 'bse50', code: '899050', name: '北证50', quoteId: '0.899050', marketLabel: '北交所' }
] as const

export type MarketIndexId = (typeof MARKET_INDEX_OPTIONS)[number]['id']

export const DEFAULT_MARKET_INDEX_IDS: MarketIndexId[] = ['shanghai', 'shenzhen', 'chinext']

export function normalizeMarketIndexIds(indexIds: readonly string[] | undefined): MarketIndexId[] {
  const selectedIds = new Set(indexIds ?? DEFAULT_MARKET_INDEX_IDS)
  return MARKET_INDEX_OPTIONS.filter((index) => selectedIds.has(index.id)).map((index) => index.id)
}

export function getMarketIndexStocks(indexIds: readonly MarketIndexId[]): WatchStock[] {
  const selectedIds = new Set(indexIds)
  return MARKET_INDEX_OPTIONS.filter((index) => selectedIds.has(index.id)).map((index) => ({
    code: index.code,
    name: index.name,
    quoteId: index.quoteId,
    marketLabel: index.marketLabel,
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
}

export interface TTradingFeeSettings {
  commissionRatePerTenThousand: number
  minimumCommissionBundle: number
  handlingRatePerTenThousand: number
  regulatoryRatePerTenThousand: number
  transferRatePerTenThousand: number
  stampDutyRatePerTenThousand: number
}

export const DEFAULT_T_TRADING_FEE_SETTINGS: TTradingFeeSettings = {
  commissionRatePerTenThousand: 5.313,
  minimumCommissionBundle: 5,
  handlingRatePerTenThousand: 0.341,
  regulatoryRatePerTenThousand: 0.2,
  transferRatePerTenThousand: 0.1,
  stampDutyRatePerTenThousand: 5
}

export interface TTradeFees {
  commission: number
  handling: number
  regulatory: number
  transfer: number
  stampDuty: number
}

export type TTradeSide = 'buy' | 'sell'
export type TTradePurpose = 't' | 'base'
export type TTradingDirection = 'forward' | 'reverse'

export interface TTrade {
  id: string
  side: TTradeSide
  purpose: TTradePurpose
  tradedAt: string
  price: number
  quantity: number
  fees: TTradeFees
  note: string
}

/** 统一交易记录；批次字段缺省时表示批次外的独立底仓交易。 */
export interface TTradeRecord extends TTrade {
  batchId?: string
  batchSequence?: number
  batchDirection?: TTradingDirection
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
  activeBatch?: TTradingBatch
  history: TTradingBatch[]
  /** 账户内所有底仓及做T成交的唯一数据源。 */
  tradeRecords: TTradeRecord[]
}

export type TTradingAccounts = Record<string, TTradingAccount>

export function hasLegacyTTradingData(accounts: unknown): boolean {
  if (!accounts || typeof accounts !== 'object') return false
  return Object.values(accounts).some((value) => {
    if (!value || typeof value !== 'object') return false
    const account = value as {
      baseTrades?: unknown
      activeBatch?: { trades?: unknown }
      history?: Array<{ trades?: unknown }>
    }
    return (
      Array.isArray(account.baseTrades) ||
      Array.isArray(account.activeBatch?.trades) ||
      account.history?.some((batch) => Array.isArray(batch.trades)) === true
    )
  })
}

function activeTQuantity(batch: TTradingBatch, trades: readonly TTrade[]): number {
  const openingSide: TTradeSide = (batch.direction ?? 'forward') === 'reverse' ? 'sell' : 'buy'
  return Math.max(
    0,
    trades.reduce(
      (total, trade) =>
        trade.purpose !== 't'
          ? total
          : total + (trade.side === openingSide ? trade.quantity : -trade.quantity),
      0
    )
  )
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

export function normalizeTTradingAccounts(
  accounts: TTradingAccounts | undefined
): TTradingAccounts {
  return Object.fromEntries(
    Object.entries(accounts ?? {}).map(([quoteId, account]) => {
      type LegacyBatch = TTradingBatch & { trades?: TTrade[] }
      type LegacyAccount = Omit<TTradingAccount, 'activeBatch' | 'history' | 'tradeRecords'> & {
        activeBatch?: LegacyBatch
        history?: LegacyBatch[]
        baseTrades?: TTrade[]
        tradeRecords?: TTradeRecord[]
      }
      const legacyAccount = account as LegacyAccount
      const legacyHistory = legacyAccount.history ?? []
      const stripLegacyTrades = (batch: LegacyBatch): TTradingBatch => {
        const { trades: _legacyTrades, ...normalizedBatch } = batch
        return normalizedBatch
      }
      const records = new Map(
        (legacyAccount.tradeRecords ?? []).map((record) => [record.id, record])
      )
      const addLegacyBatchTrades = (batch: LegacyBatch) => {
        const legacyTrades = batch.trades ?? []
        legacyTrades.forEach((trade) =>
          records.set(trade.id, {
            ...trade,
            batchId: batch.id,
            batchSequence: batch.sequence,
            batchDirection: batch.direction ?? 'forward'
          })
        )
      }

      legacyAccount.baseTrades?.forEach((trade) => records.set(trade.id, { ...trade }))
      legacyHistory.forEach(addLegacyBatchTrades)
      if (legacyAccount.activeBatch) addLegacyBatchTrades(legacyAccount.activeBatch)

      const history = legacyHistory.map(stripLegacyTrades)
      const activeBatch = legacyAccount.activeBatch
        ? stripLegacyTrades(legacyAccount.activeBatch)
        : undefined
      const batchesById = new Map(
        [...history, ...(activeBatch ? [activeBatch] : [])].map((batch) => [batch.id, batch])
      )
      const tradeRecords = [...records.values()]
        .map((record) => {
          const batch = record.batchId ? batchesById.get(record.batchId) : undefined
          return batch
            ? {
                ...record,
                batchSequence: batch.sequence,
                batchDirection: batch.direction ?? 'forward'
              }
            : record
        })
        .sort((left, right) => right.tradedAt.localeCompare(left.tradedAt))
      const activeTrades = activeBatch
        ? tradeRecords.filter((record) => record.batchId === activeBatch.id)
        : []
      const {
        activeBatch: _legacyActiveBatch,
        history: _legacyHistory,
        baseTrades: _legacyBaseTrades,
        tradeRecords: _legacyTradeRecords,
        ...accountFields
      } = legacyAccount

      return [
        quoteId,
        {
          ...accountFields,
          history,
          activeBatch: activeBatch
            ? normalizeActiveTTradingBatch(activeBatch, activeTrades)
            : undefined,
          tradeRecords
        }
      ]
    })
  )
}

export const DEFAULT_WATCHLIST_COLUMN_ORDER = [
  'stock',
  'latest',
  'changePercent',
  'sectorChangePercent',
  'dividendFinancingRatio',
  'valueTags',
  'open',
  'trading',
  'amount',
  'radar',
  'positionQuantity',
  'cost',
  'marketValue',
  'totalProfit',
  'todayProfit',
  'operation'
] as const

export type WatchlistColumnId = (typeof DEFAULT_WATCHLIST_COLUMN_ORDER)[number]
export const WATCHLIST_COLUMN_ORDER_VERSION = 8

export function normalizeWatchlistColumnOrder(
  columnOrder: readonly string[] | undefined
): WatchlistColumnId[] {
  const source = columnOrder ?? DEFAULT_WATCHLIST_COLUMN_ORDER
  const validColumns = new Set<WatchlistColumnId>(DEFAULT_WATCHLIST_COLUMN_ORDER)
  const normalized = source.filter(
    (columnId, index): columnId is WatchlistColumnId =>
      columnId !== 'operation' &&
      validColumns.has(columnId as WatchlistColumnId) &&
      source.indexOf(columnId) === index
  )
  const missingColumns = DEFAULT_WATCHLIST_COLUMN_ORDER.filter(
    (columnId) => columnId !== 'operation' && !normalized.includes(columnId)
  )
  return [...normalized, ...missingColumns, 'operation']
}

export function migrateWatchlistColumnOrder(
  columnOrder: readonly string[] | undefined,
  version: number | undefined
): WatchlistColumnId[] {
  let migrated = normalizeWatchlistColumnOrder(columnOrder)

  if ((version ?? 0) < 2) {
    migrated = migrated.filter((columnId) => columnId !== 'todayProfit')
    const totalProfitIndex = migrated.indexOf('totalProfit')
    migrated.splice(totalProfitIndex + 1, 0, 'todayProfit')
  }

  if ((version ?? 0) < 4) {
    migrated = migrated.filter((columnId) => columnId !== 'sectorChangePercent')
    const changePercentIndex = migrated.indexOf('changePercent')
    migrated.splice(changePercentIndex + 1, 0, 'sectorChangePercent')
  }

  if ((version ?? 0) < 5) {
    migrated = migrated.filter((columnId) => columnId !== 'trading')
    const openIndex = migrated.indexOf('open')
    migrated.splice(openIndex + 1, 0, 'trading')
  }

  if ((version ?? 0) < 7) {
    migrated = migrated.filter((columnId) => columnId !== 'dividendFinancingRatio')
    const sectorChangePercentIndex = migrated.indexOf('sectorChangePercent')
    migrated.splice(sectorChangePercentIndex + 1, 0, 'dividendFinancingRatio')
  }

  if ((version ?? 0) < 8) {
    migrated = migrated.filter((columnId) => columnId !== 'valueTags')
    const dividendFinancingIndex = migrated.indexOf('dividendFinancingRatio')
    migrated.splice(dividendFinancingIndex + 1, 0, 'valueTags')
  }

  return migrated
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
  priceEarningsRatioTtm?: number | null
  priceBookRatio?: number | null
  sector?: StockSectorQuote
  radarSignals?: StockRadarSignal[]
  fiveLevelLargeOrders?: FiveLevelLargeOrderAlert[]
  updatedAt: string
  dataAt?: string
}

export type StockQuoteSource =
  | 'eastmoney-primary'
  | 'eastmoney-mirror'
  | 'tencent'
  | 'sina'
  | 'demo'

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

export type DailyMarketScanSignalType =
  'volumeSurge' | 'strongGain' | 'strongLoss' | 'breakout20d' | 'breakdown20d' | 'reversal'

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
  totalMarketValue?: number | null
  circulatingMarketValue?: number | null
  priceEarningsIndustryPercentile: number | null
  priceBookIndustryPercentile: number | null
  priceEarningsIndustrySampleSize: number
  priceBookIndustrySampleSize: number
}

export type CompanyReportType = 'annual' | 'semiannual' | 'firstQuarter' | 'thirdQuarter'

export type CompanyReportVariant = 'full' | 'summary' | 'english'

export interface CompanyReportSummarySections {
  managementDiscussion: string | null
  auditOpinion: string | null
  financialStatementNotes: string | null
  aiConclusion: string
}

export interface CompanyReportSummary {
  reportId: string
  code: string
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
  title: string
  reportType: CompanyReportType
  reportYear: number
  variant: CompanyReportVariant
  amended: boolean
  publishedAt: string
  url: string
  summary?: CompanyReportSummary
}

export interface CompanyReportLibraryResult {
  code: string
  source: '巨潮资讯'
  periodStart: string
  periodEnd: string
  fetchedAt: string
  fromCache: boolean
  warning?: string
  reports: CompanyReportItem[]
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
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6
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
    latestQuarterlyRiskReportCount?: number
    completeQuarterlyRiskIndicatorCount?: number
    industryCount: number
  }
  industries: FundamentalIndustryBenchmark[]
  rows: FundamentalCompany[]
}

export interface StockValuationHistory {
  quoteId: string
  fetchedAt: string
  periodStart: string | null
  periodEnd: string | null
  priceEarningsRatioTtmValues: number[]
  priceBookRatioValues: number[]
}

export interface StockValuationMetricAnalysis {
  currentValue: number | null
  historicalPercentile: number | null
  historicalSampleSize: number
  industryPercentile: number | null
  industrySampleSize: number
  industryBasisValue: number | null
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

export interface AppSettings {
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  marketIndexIds: MarketIndexId[]
  startWithWindows: boolean
  minimizeToTray: boolean
  showTaskbarTicker: boolean
  showChipDistribution: boolean
  showBollingerBands: boolean
  taskbarPositionPercent: number
  tTradingFees: TTradingFeeSettings
  tPlanDefaults: TPlanDefaultSettings
  tFloatingProfitAlertDefaultThreshold: number
  tradingCalendar: TradingCalendarSettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  priorityRefreshSeconds: 5,
  regularRefreshSeconds: 10,
  marketIndexIds: [...DEFAULT_MARKET_INDEX_IDS],
  startWithWindows: false,
  minimizeToTray: true,
  showTaskbarTicker: true,
  showChipDistribution: false,
  showBollingerBands: true,
  taskbarPositionPercent: 0,
  tTradingFees: { ...DEFAULT_T_TRADING_FEE_SETTINGS },
  tPlanDefaults: structuredClone(DEFAULT_T_PLAN_SETTINGS),
  tFloatingProfitAlertDefaultThreshold: DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD,
  tradingCalendar: structuredClone(DEFAULT_TRADING_CALENDAR_SETTINGS)
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
    | Partial<Record<StockMarket, Partial<MarketTradingCalendarSettings>>>
    | undefined
  const normalizeMarket = (market: StockMarket): MarketTradingCalendarSettings => {
    const defaults = DEFAULT_MARKET_TRADING_CALENDARS[market]
    const stored = storedMarkets?.[market]
    const legacy = market === 'CN' ? calendar : undefined
    return {
      closedDates: validDates([
        ...defaults.closedDates,
        ...(stored?.closedDates ?? legacy?.closedDates ?? [])
      ]),
      halfDayDates: validDates([
        ...defaults.halfDayDates,
        ...(stored?.halfDayDates ?? [])
      ]),
      coveredThroughYear: Math.max(
        defaults.coveredThroughYear,
        stored?.coveredThroughYear ?? legacy?.coveredThroughYear ?? defaults.coveredThroughYear
      ),
      source: stored?.source ?? defaults.source,
      lastRefreshedAt: stored?.lastRefreshedAt ?? legacy?.lastRefreshedAt ?? null,
      lastCheckedYear: stored?.lastCheckedYear ?? legacy?.lastCheckedYear ?? null,
      lastAttemptedAt: stored?.lastAttemptedAt ?? legacy?.lastAttemptedAt ?? null,
      lastError: stored?.lastError ?? legacy?.lastError ?? null
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

export function normalizeAppSettings(
  settings: (Partial<AppSettings> & { refreshSeconds?: number }) | undefined
): AppSettings {
  const legacyRefreshSeconds = settings?.refreshSeconds
  const regularFallback =
    typeof legacyRefreshSeconds === 'number' && legacyRefreshSeconds !== 5
      ? legacyRefreshSeconds
      : DEFAULT_APP_SETTINGS.regularRefreshSeconds
  return {
    priorityRefreshSeconds: Math.min(
      300,
      Math.max(3, settings?.priorityRefreshSeconds ?? DEFAULT_APP_SETTINGS.priorityRefreshSeconds)
    ),
    regularRefreshSeconds: Math.min(
      300,
      Math.max(3, settings?.regularRefreshSeconds ?? regularFallback)
    ),
    marketIndexIds: normalizeMarketIndexIds(
      Array.isArray(settings?.marketIndexIds) ? settings.marketIndexIds : undefined
    ),
    startWithWindows: settings?.startWithWindows ?? DEFAULT_APP_SETTINGS.startWithWindows,
    minimizeToTray: settings?.minimizeToTray ?? DEFAULT_APP_SETTINGS.minimizeToTray,
    showTaskbarTicker: settings?.showTaskbarTicker ?? DEFAULT_APP_SETTINGS.showTaskbarTicker,
    showChipDistribution:
      settings?.showChipDistribution ?? DEFAULT_APP_SETTINGS.showChipDistribution,
    showBollingerBands: settings?.showBollingerBands ?? DEFAULT_APP_SETTINGS.showBollingerBands,
    taskbarPositionPercent: Math.min(
      100,
      Math.max(0, settings?.taskbarPositionPercent ?? DEFAULT_APP_SETTINGS.taskbarPositionPercent)
    ),
    tTradingFees: normalizeTTradingFeeSettings(settings?.tTradingFees),
    tPlanDefaults: normalizeTPlanDefaultSettings(settings?.tPlanDefaults),
    tFloatingProfitAlertDefaultThreshold: Math.max(
      1,
      settings?.tFloatingProfitAlertDefaultThreshold ?? DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD
    ),
    tradingCalendar: normalizeTradingCalendarSettings(settings?.tradingCalendar)
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
}

export type CompletionNotificationTarget = 'reports' | 'ai-short-term' | 'ai-long-term' | 't-advice'

export interface AppCompletionNotification {
  id: string
  quoteId: string
  target: CompletionNotificationTarget
  message: string
  createdAt: string
}

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
}

export interface StockDesktopApi {
  getBootstrap: () => Promise<BootstrapResult>
  getTaskbarLayout: () => Promise<TaskbarLayout>
  getTaskbarTooltipQuoteId: () => Promise<string | null>
  resizeTaskbarTicker: (width: number, height: number) => Promise<void>
  setTaskbarTooltip: (anchor: TaskbarTooltipAnchor | null) => Promise<void>
  resizeTaskbarTooltip: (height: number) => Promise<void>
  searchStocks: (query: string) => Promise<SearchResult[]>
  getDividendFinancingSnapshot: () => Promise<DividendFinancingSnapshot | null>
  getDividendFinancingState: () => Promise<DataSnapshotRuntimeState>
  getDividendFinancingChangeReport: () => Promise<DividendFinancingChangeReport | null>
  runDividendFinancingUpdate: () => Promise<DividendFinancingUpdateResult>
  getFundamentalSnapshot: () => Promise<FundamentalSnapshot | null>
  getFundamentalState: () => Promise<DataSnapshotRuntimeState>
  getFundamentalChangeReport: () => Promise<FundamentalChangeReport | null>
  runFundamentalUpdate: () => Promise<FundamentalUpdateResult>
  getCompanyReports: (code: string, forceRefresh?: boolean) => Promise<CompanyReportLibraryResult>
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
