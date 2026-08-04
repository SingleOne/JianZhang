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
  showInTaskbar: boolean
  isPriority: boolean
  showRadarSignals: boolean
  position?: StockPosition
  positionSnapshots?: StockPositionSnapshot[]
  alertRules?: StockAlertRule[]
  groupIds?: string[]
}

export interface WatchlistGroup {
  id: string
  name: string
}

export function normalizeWatchlistGroups(groups: readonly WatchlistGroup[] | undefined): WatchlistGroup[] {
  if (!Array.isArray(groups)) return []
  const usedIds = new Set<string>()
  return groups.flatMap((group) => {
    const id = group?.id?.trim()
    const name = group?.name?.trim()
    if (!id || !name || usedIds.has(id)) return []
    usedIds.add(id)
    return [{ id, name }]
  })
}

export function normalizeWatchlist(stocks: readonly WatchStock[]): WatchStock[] {
  return stocks.map((stock) => ({
    ...stock,
    isPriority: Boolean(stock.position || stock.isPriority),
    showRadarSignals: stock.showRadarSignals ?? true,
    groupIds: [...new Set((stock.groupIds ?? []).filter((groupId) => typeof groupId === 'string'))],
    positionSnapshots: Array.isArray(stock.positionSnapshots)
      ? stock.positionSnapshots.filter((snapshot) => (
          snapshot
          && typeof snapshot.id === 'string'
          && typeof snapshot.name === 'string'
          && typeof snapshot.createdAt === 'string'
          && Number.isFinite(snapshot.quantity)
          && snapshot.quantity > 0
          && Number.isFinite(snapshot.cost)
          && snapshot.cost > 0
        ))
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

export type MarketIndexId = typeof MARKET_INDEX_OPTIONS[number]['id']

export const DEFAULT_MARKET_INDEX_IDS: MarketIndexId[] = ['shanghai', 'shenzhen', 'chinext']

export function normalizeMarketIndexIds(indexIds: readonly string[] | undefined): MarketIndexId[] {
  const selectedIds = new Set(indexIds ?? DEFAULT_MARKET_INDEX_IDS)
  return MARKET_INDEX_OPTIONS
    .filter((index) => selectedIds.has(index.id))
    .map((index) => index.id)
}

export function getMarketIndexStocks(indexIds: readonly MarketIndexId[]): WatchStock[] {
  const selectedIds = new Set(indexIds)
  return MARKET_INDEX_OPTIONS
    .filter((index) => selectedIds.has(index.id))
    .map((index) => ({
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
    return Array.isArray(account.baseTrades)
      || Array.isArray(account.activeBatch?.trades)
      || account.history?.some((batch) => Array.isArray(batch.trades)) === true
  })
}

function activeTQuantity(batch: TTradingBatch, trades: readonly TTrade[]): number {
  const openingSide: TTradeSide = (batch.direction ?? 'forward') === 'reverse' ? 'sell' : 'buy'
  return Math.max(0, trades.reduce((total, trade) => (
    trade.purpose !== 't'
      ? total
      : total + (trade.side === openingSide ? trade.quantity : -trade.quantity)
  ), 0))
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
      alertStatus: level.alertStatus === 'triggered' || level.alertStatus === 'handled'
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
  const status = enabled && (
    alert?.status === 'profit-triggered' || alert?.status === 'loss-triggered'
  )
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
    buyLevels: direction === 'reverse' && !hasBuyLevels
      ? legacyLevels
      : normalizeTPlanLevels(batch.buyLevels, quantity),
    sellLevels: direction === 'reverse' && !hasBuyLevels
      ? createDefaultTPlanLevels(quantity)
      : legacyLevels,
    alertEnabled: batch.alertEnabled ?? false,
    floatingProfitAlert: normalizeTFloatingProfitAlert(batch.floatingProfitAlert)
  }
}

export function normalizeTTradingAccounts(
  accounts: TTradingAccounts | undefined
): TTradingAccounts {
  return Object.fromEntries(Object.entries(accounts ?? {}).map(([quoteId, account]) => {
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
      legacyTrades.forEach((trade) => records.set(trade.id, {
        ...trade,
        batchId: batch.id,
        batchSequence: batch.sequence,
        batchDirection: batch.direction ?? 'forward'
      }))
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
    const tradeRecords = [...records.values()].map((record) => {
      const batch = record.batchId ? batchesById.get(record.batchId) : undefined
      return batch
        ? {
            ...record,
            batchSequence: batch.sequence,
            batchDirection: batch.direction ?? 'forward'
          }
        : record
    }).sort((left, right) => right.tradedAt.localeCompare(left.tradedAt))
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

    return [quoteId, {
      ...accountFields,
      history,
      activeBatch: activeBatch
        ? normalizeActiveTTradingBatch(activeBatch, activeTrades)
        : undefined,
      tradeRecords
    }]
  }))
}

export const DEFAULT_WATCHLIST_COLUMN_ORDER = [
  'stock',
  'latest',
  'changePercent',
  'sectorChangePercent',
  'dividendFinancingRatio',
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

export type WatchlistColumnId = typeof DEFAULT_WATCHLIST_COLUMN_ORDER[number]
export const WATCHLIST_COLUMN_ORDER_VERSION = 7

export function normalizeWatchlistColumnOrder(
  columnOrder: readonly string[] | undefined
): WatchlistColumnId[] {
  const source = columnOrder ?? DEFAULT_WATCHLIST_COLUMN_ORDER
  const validColumns = new Set<WatchlistColumnId>(DEFAULT_WATCHLIST_COLUMN_ORDER)
  const normalized = source.filter((columnId, index): columnId is WatchlistColumnId => (
    columnId !== 'operation'
    && validColumns.has(columnId as WatchlistColumnId)
    && source.indexOf(columnId) === index
  ))
  const missingColumns = DEFAULT_WATCHLIST_COLUMN_ORDER.filter((columnId) => (
    columnId !== 'operation' && !normalized.includes(columnId)
  ))
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
  sector?: StockSectorQuote
  radarSignals?: StockRadarSignal[]
  fiveLevelLargeOrders?: FiveLevelLargeOrderAlert[]
  updatedAt: string
}

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
  | 'added'
  | 'removed'
  | 'rank'
  | 'ratio'
  | 'dividend'
  | 'financing'

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
  changeReport: DividendFinancingChangeReport
  reportPath: string
  diagnosticsPath: string
}

export type FundamentalOrganizationType =
  | 'general'
  | 'bank'
  | 'securities'
  | 'insurance'
  | 'other'

export interface FundamentalAnnualReport {
  year: number
  reportDate: string
  noticeDate: string | null
  weightedAverageRoe: number | null
  deductedWeightedAverageRoe: number | null
  netProfit: number | null
  parentNetProfit: number | null
  deductedParentNetProfit: number | null
  operatingCashFlow: number | null
}

export interface FundamentalBalanceSheet {
  reportDate: string
  noticeDate: string | null
  totalAssets: number | null
  totalLiabilities: number | null
  debtAssetRatio: number | null
  industryPercentile: number | null
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
  latestBalanceSheet: FundamentalBalanceSheet
}

export interface FundamentalIndustryBenchmark {
  code: string
  name: string
  sampleSize: number
  debtAssetRatioP60: number
}

export interface FundamentalSnapshot {
  schemaVersion: 1
  snapshotDate: string
  generatedAt: string
  currency: 'CNY'
  fiscalYears: number[]
  latestAnnualReportDate: string
  sources: Array<{
    name: string
    reportName: string
    url: string
  }>
  coverage: {
    companyCount: number
    completeFiveYearRoeCount: number
    completeFiveYearCashProfitCount: number
    latestDebtAssetRatioCount: number
    latestIndustryPercentileCount: number
    industryCount: number
  }
  industries: FundamentalIndustryBenchmark[]
  rows: FundamentalCompany[]
}

export interface FundamentalUpdateProgress {
  stage: 'running' | 'completed' | 'failed'
  message: string
}

export interface FundamentalUpdateResult {
  snapshot: FundamentalSnapshot
  snapshotPath: string
  diagnosticsPath: string
}

export const BUILT_IN_TRADING_CALENDAR_END_YEAR = 2026

export interface TradingCalendarSettings {
  closedDates: string[]
  coveredThroughYear: number
  lastRefreshedAt: string | null
  lastCheckedYear: number | null
  lastAttemptedAt: string | null
  lastError: string | null
}

export const DEFAULT_TRADING_CALENDAR_SETTINGS: TradingCalendarSettings = {
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
  tradingCalendar: { ...DEFAULT_TRADING_CALENDAR_SETTINGS }
}

function normalizeTTradingFeeSettings(
  settings: Partial<TTradingFeeSettings> | undefined
): TTradingFeeSettings {
  return {
    commissionRatePerTenThousand: Math.max(0,
      settings?.commissionRatePerTenThousand
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.commissionRatePerTenThousand
    ),
    minimumCommissionBundle: Math.max(0,
      settings?.minimumCommissionBundle
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.minimumCommissionBundle
    ),
    handlingRatePerTenThousand: Math.max(0,
      settings?.handlingRatePerTenThousand
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.handlingRatePerTenThousand
    ),
    regulatoryRatePerTenThousand: Math.max(0,
      settings?.regulatoryRatePerTenThousand
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.regulatoryRatePerTenThousand
    ),
    transferRatePerTenThousand: Math.max(0,
      settings?.transferRatePerTenThousand
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.transferRatePerTenThousand
    ),
    stampDutyRatePerTenThousand: Math.max(0,
      settings?.stampDutyRatePerTenThousand
        ?? DEFAULT_T_TRADING_FEE_SETTINGS.stampDutyRatePerTenThousand
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
    buyLevels: normalizeTPlanDefaultLevels(
      settings?.buyLevels,
      DEFAULT_T_PLAN_SETTINGS.buyLevels
    ),
    sellLevels: normalizeTPlanDefaultLevels(
      settings?.sellLevels,
      DEFAULT_T_PLAN_SETTINGS.sellLevels
    )
  }
}

export function normalizeTradingCalendarSettings(
  calendar: Partial<TradingCalendarSettings> | undefined
): TradingCalendarSettings {
  const closedDates = Array.isArray(calendar?.closedDates)
    ? [...new Set(calendar.closedDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
    : []
  return {
    closedDates,
    coveredThroughYear: Math.max(
      BUILT_IN_TRADING_CALENDAR_END_YEAR,
      calendar?.coveredThroughYear ?? BUILT_IN_TRADING_CALENDAR_END_YEAR
    ),
    lastRefreshedAt: calendar?.lastRefreshedAt ?? null,
    lastCheckedYear: calendar?.lastCheckedYear ?? null,
    lastAttemptedAt: calendar?.lastAttemptedAt ?? null,
    lastError: calendar?.lastError ?? null
  }
}

export function normalizeAppSettings(
  settings: (Partial<AppSettings> & { refreshSeconds?: number }) | undefined
): AppSettings {
  const legacyRefreshSeconds = settings?.refreshSeconds
  const regularFallback = typeof legacyRefreshSeconds === 'number' && legacyRefreshSeconds !== 5
    ? legacyRefreshSeconds
    : DEFAULT_APP_SETTINGS.regularRefreshSeconds
  return {
    priorityRefreshSeconds: Math.min(300, Math.max(3,
      settings?.priorityRefreshSeconds ?? DEFAULT_APP_SETTINGS.priorityRefreshSeconds
    )),
    regularRefreshSeconds: Math.min(300, Math.max(3,
      settings?.regularRefreshSeconds ?? regularFallback
    )),
    marketIndexIds: normalizeMarketIndexIds(
      Array.isArray(settings?.marketIndexIds) ? settings.marketIndexIds : undefined
    ),
    startWithWindows: settings?.startWithWindows ?? DEFAULT_APP_SETTINGS.startWithWindows,
    minimizeToTray: settings?.minimizeToTray ?? DEFAULT_APP_SETTINGS.minimizeToTray,
    showTaskbarTicker: settings?.showTaskbarTicker ?? DEFAULT_APP_SETTINGS.showTaskbarTicker,
    showChipDistribution: settings?.showChipDistribution ?? DEFAULT_APP_SETTINGS.showChipDistribution,
    showBollingerBands: settings?.showBollingerBands ?? DEFAULT_APP_SETTINGS.showBollingerBands,
    taskbarPositionPercent: Math.min(100, Math.max(0,
      settings?.taskbarPositionPercent ?? DEFAULT_APP_SETTINGS.taskbarPositionPercent
    )),
    tTradingFees: normalizeTTradingFeeSettings(settings?.tTradingFees),
    tPlanDefaults: normalizeTPlanDefaultSettings(settings?.tPlanDefaults),
    tFloatingProfitAlertDefaultThreshold: Math.max(
      1,
      settings?.tFloatingProfitAlertDefaultThreshold
        ?? DEFAULT_T_FLOATING_PROFIT_ALERT_THRESHOLD
    ),
    tradingCalendar: normalizeTradingCalendarSettings(settings?.tradingCalendar)
  }
}

export interface AppState {
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  settings: AppSettings
  columnOrder: WatchlistColumnId[]
  columnOrderVersion?: number
  tTradingAccounts: TTradingAccounts
}

export interface ConfigExportResult {
  canceled: boolean
  filePath?: string
}

export interface ConfigImportResult extends ConfigExportResult {
  state?: AppState
}

export interface BootstrapResult {
  state: AppState
  quotes: StockQuote[]
  source: 'eastmoney' | 'demo'
  warning?: string
}

export interface TaskbarLayout {
  taskbarHeight: number
}

export interface StockDesktopApi {
  getBootstrap: () => Promise<BootstrapResult>
  getTaskbarLayout: () => Promise<TaskbarLayout>
  searchStocks: (query: string) => Promise<SearchResult[]>
  getDividendFinancingSnapshot: () => Promise<DividendFinancingSnapshot>
  getDividendFinancingChangeReport: () => Promise<DividendFinancingChangeReport | null>
  runDividendFinancingUpdate: () => Promise<DividendFinancingUpdateResult>
  getFundamentalSnapshot: () => Promise<FundamentalSnapshot>
  runFundamentalUpdate: () => Promise<FundamentalUpdateResult>
  refreshQuotes: () => Promise<StockQuote[]>
  getKline: (quoteId: string, period: KlinePeriod, limit?: number) => Promise<KlineResult>
  saveChipDistributionCache: (entry: ChipDistributionCacheEntry) => Promise<ChipDistributionCacheEntry>
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  getSectorIndex: (quoteId: string) => Promise<SectorIndexResult>
  refreshTradingCalendar: () => Promise<TradingCalendarSettings>
  saveState: (state: AppState) => Promise<AppState>
  exportConfig: (state: AppState) => Promise<ConfigExportResult>
  importConfig: () => Promise<ConfigImportResult>
  hideWindow: () => Promise<void>
  quitApp: () => Promise<void>
  onQuotesUpdated: (callback: (quotes: StockQuote[]) => void) => () => void
  onStateUpdated: (callback: (state: AppState) => void) => () => void
  onTaskbarLayout: (callback: (layout: TaskbarLayout) => void) => () => void
  onSelectStock: (callback: (quoteId: string) => void) => () => void
  onDataError: (callback: (message: string) => void) => () => void
  onDividendFinancingUpdateProgress: (
    callback: (progress: DividendFinancingUpdateProgress) => void
  ) => () => void
  onFundamentalUpdateProgress: (
    callback: (progress: FundamentalUpdateProgress) => void
  ) => () => void
}
