export interface StockPositionSnapshot {
  id: string
  name: string
  createdAt: string
  quantity: number
  cost: number
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
}

export function normalizeWatchlist(stocks: readonly WatchStock[]): WatchStock[] {
  return stocks.map((stock) => ({
    ...stock,
    isPriority: Boolean(stock.position || stock.isPriority),
    showRadarSignals: stock.showRadarSignals ?? true,
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

export interface TPositionSnapshot {
  quantity: number
  cost: number
  openedOn?: string
}

export interface TSellPlanLevel {
  targetPercent: number
  quantity: number
}

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
  trades: TTrade[]
  sellLevels: TSellPlanLevel[]
  settlement?: TBatchSettlement
}

export interface TTradingAccount {
  quoteId: string
  code: string
  name: string
  activeBatch?: TTradingBatch
  history: TTradingBatch[]
  baseTrades?: TTrade[]
}

export type TTradingAccounts = Record<string, TTradingAccount>

export function normalizeTTradingAccounts(
  accounts: TTradingAccounts | undefined
): TTradingAccounts {
  return accounts ?? {}
}

export const DEFAULT_WATCHLIST_COLUMN_ORDER = [
  'stock',
  'latest',
  'changePercent',
  'open',
  'high',
  'low',
  'amount',
  'radar',
  'positionQuantity',
  'cost',
  'marketValue',
  'totalProfit',
  'profitPercent',
  'todayProfit',
  'todayProfitPercent',
  'operation'
] as const

export type WatchlistColumnId = typeof DEFAULT_WATCHLIST_COLUMN_ORDER[number]
export const WATCHLIST_COLUMN_ORDER_VERSION = 1

const PREVIOUS_DEFAULT_WATCHLIST_COLUMN_ORDER: readonly WatchlistColumnId[] = [
  'stock',
  'latest',
  'changePercent',
  'open',
  'high',
  'low',
  'amount',
  'radar',
  'positionQuantity',
  'cost',
  'marketValue',
  'todayProfit',
  'todayProfitPercent',
  'totalProfit',
  'profitPercent',
  'operation'
]

function isPreviousDefaultColumnOrder(columnOrder: readonly WatchlistColumnId[]): boolean {
  return columnOrder.length === PREVIOUS_DEFAULT_WATCHLIST_COLUMN_ORDER.length
    && columnOrder.every((columnId, index) => (
      columnId === PREVIOUS_DEFAULT_WATCHLIST_COLUMN_ORDER[index]
    ))
}

export function normalizeWatchlistColumnOrder(
  columnOrder: readonly WatchlistColumnId[] | undefined
): WatchlistColumnId[] {
  const source = columnOrder && isPreviousDefaultColumnOrder(columnOrder)
    ? DEFAULT_WATCHLIST_COLUMN_ORDER
    : columnOrder ?? DEFAULT_WATCHLIST_COLUMN_ORDER
  const validColumns = new Set<WatchlistColumnId>(DEFAULT_WATCHLIST_COLUMN_ORDER)
  const normalized = source.filter((columnId, index) => (
    columnId !== 'operation'
    && validColumns.has(columnId)
    && source.indexOf(columnId) === index
  ))
  const missingColumns = DEFAULT_WATCHLIST_COLUMN_ORDER.filter((columnId) => (
    columnId !== 'operation' && !normalized.includes(columnId)
  ))
  return [...normalized, ...missingColumns, 'operation']
}

export function migrateWatchlistColumnOrder(
  columnOrder: readonly WatchlistColumnId[] | undefined,
  version: number | undefined
): WatchlistColumnId[] {
  const normalized = normalizeWatchlistColumnOrder(columnOrder)
  if ((version ?? 0) >= WATCHLIST_COLUMN_ORDER_VERSION) return normalized

  const migrated: WatchlistColumnId[] = normalized.filter((columnId) => columnId !== 'todayProfit')
  const profitPercentIndex = migrated.indexOf('profitPercent')
  migrated.splice(profitPercentIndex + 1, 0, 'todayProfit')
  return migrated
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
  radarSignals?: StockRadarSignal[]
  updatedAt: string
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
}

export interface KlineResult {
  quoteId: string
  name: string
  tradingDate: string
  bars: KlineBar[]
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

export interface AppSettings {
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  marketIndexIds: MarketIndexId[]
  startWithWindows: boolean
  minimizeToTray: boolean
  showTaskbarTicker: boolean
  taskbarPositionPercent: number
  tTradingFees: TTradingFeeSettings
  tradingCalendar: TradingCalendarSettings
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  priorityRefreshSeconds: 5,
  regularRefreshSeconds: 10,
  marketIndexIds: [...DEFAULT_MARKET_INDEX_IDS],
  startWithWindows: false,
  minimizeToTray: true,
  showTaskbarTicker: true,
  taskbarPositionPercent: 0,
  tTradingFees: { ...DEFAULT_T_TRADING_FEE_SETTINGS },
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
    taskbarPositionPercent: Math.min(100, Math.max(0,
      settings?.taskbarPositionPercent ?? DEFAULT_APP_SETTINGS.taskbarPositionPercent
    )),
    tTradingFees: normalizeTTradingFeeSettings(settings?.tTradingFees),
    tradingCalendar: normalizeTradingCalendarSettings(settings?.tradingCalendar)
  }
}

export interface AppState {
  watchlist: WatchStock[]
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
}

export interface StockDesktopApi {
  getBootstrap: () => Promise<BootstrapResult>
  searchStocks: (query: string) => Promise<SearchResult[]>
  refreshQuotes: () => Promise<StockQuote[]>
  getKline: (quoteId: string, period: KlinePeriod, limit?: number) => Promise<KlineResult>
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
  onSelectStock: (callback: (quoteId: string) => void) => () => void
  onDataError: (callback: (message: string) => void) => () => void
}
