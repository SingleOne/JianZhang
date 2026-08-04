import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  getMarketIndexStocks,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  type AppState,
  type BootstrapResult,
  type ConfigImportResult,
  type DividendFinancingSnapshot,
  type FundamentalSnapshot,
  type FundsFlowResult,
  type KlinePeriod,
  type KlineResult,
  type SectorIndexResult,
  type StockDesktopApi,
  type StockOrderBook,
  type StockQuote,
  type StockSectorQuote,
  type WatchStock
} from '../shared/types'
import builtInDividendFinancingSnapshot from '../data/dividend-financing-ranking.json'
import { createConfigDocument, parseConfigDocument } from '../shared/config'
import { DEMO_SECTORS, DEMO_STOCKS, DEMO_VALUES } from './demo-data'

function makeDemoSectorQuote(stockQuoteId: string): StockSectorQuote | undefined {
  const sector = DEMO_SECTORS[stockQuoteId]
  if (!sector) return undefined
  return {
    code: sector.code,
    name: sector.name,
    quoteId: sector.quoteId,
    changePercent: DEMO_VALUES[sector.quoteId]?.changePercent ?? null
  }
}

const DEFAULT_WATCHLIST: WatchStock[] = DEMO_STOCKS.slice(0, 5).map((stock, index) => ({
  ...stock,
  showInTaskbar: index < 2,
  isPriority: false,
  showRadarSignals: true
}))

const DEFAULT_STATE: AppState = {
  watchlist: DEFAULT_WATCHLIST,
  watchlistGroups: [],
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
  settings: { ...DEFAULT_APP_SETTINGS },
  tTradingAccounts: {}
}

function loadDemoState(): AppState {
  const saved = localStorage.getItem('jianzhang-demo-state-v1')
  if (!saved) return structuredClone(DEFAULT_STATE)
  const parsed = JSON.parse(saved) as AppState
  return {
    watchlist: normalizeWatchlist(parsed.watchlist),
    watchlistGroups: normalizeWatchlistGroups(parsed.watchlistGroups),
    settings: normalizeAppSettings(parsed.settings),
    columnOrder: migrateWatchlistColumnOrder(parsed.columnOrder, parsed.columnOrderVersion),
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    tTradingAccounts: normalizeTTradingAccounts(parsed.tTradingAccounts)
  }
}

function makeDemoQuotes(watchlist: WatchStock[]): StockQuote[] {
  const now = new Date().toISOString()
  return watchlist.map((stock, index) => {
    const known = DEMO_VALUES[stock.quoteId]
    const sector = makeDemoSectorQuote(stock.quoteId)
    const radarSignals = index === 0 ? [{
      type: '8201',
      label: '火箭发射',
      date: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
      time: '10:28:16',
      info: '',
      direction: 'up' as const
    }] : undefined
    if (known) return { ...known, sector, radarSignals, updatedAt: now }
    const base = 24 + index * 7.31
    return {
      code: stock.code,
      name: stock.name,
      quoteId: stock.quoteId,
      latest: base,
      change: 0.18,
      changePercent: 0.76,
      open: base - 0.22,
      high: base + 0.64,
      low: base - 0.51,
      previousClose: base - 0.18,
      volume: 182300,
      amount: 486320000,
      turnoverRate: 1.26,
      sector,
      radarSignals,
      updatedAt: now
    }
  })
}

function makeDemoKline(quoteId: string, period: KlinePeriod, limit?: number): KlineResult {
  const quote = DEMO_VALUES[quoteId]
  const base = quote?.open ?? 48
  const date = new Date().toISOString().slice(0, 10)
  if (period === 'daily' || period === 'weekly' || period === 'monthly') {
    const intervalDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30
    const count = limit ?? (period === 'monthly' ? 60 : period === 'weekly' ? 104 : 120)
    const bars = Array.from({ length: count }, (_, index) => {
      const barDate = new Date()
      barDate.setDate(barDate.getDate() - (count - index - 1) * intervalDays)
      const wave = Math.sin(index / 5.4) * base * 0.045
      const drift = (index - count / 2) * base * 0.0007
      const open = base + wave + drift
      const close = open + Math.sin(index * 1.3) * base * 0.012
      return {
        time: barDate.toISOString().slice(0, 10),
        open,
        close,
        high: Math.max(open, close) + base * 0.008,
        low: Math.min(open, close) - base * 0.007,
        volume: 30_000 + ((index * 7123) % 90_000),
        amount: (30_000 + ((index * 7123) % 90_000)) * close * 100,
        turnoverRate: 0.8 + index % 10 * 0.15
      }
    })
    return {
      quoteId,
      name: quote?.name ?? '',
      tradingDate: `${bars[0].time} 至 ${bars.at(-1)?.time ?? ''}`,
      bars
    }
  }

  const dayCount = period === 'fiveDay' ? 5 : 1
  const pointsPerDay = period === 'intraday' ? 63 : 48
  const bars = Array.from({ length: pointsPerDay * dayCount }, (_, index) => {
    const minuteIndex = index % pointsPerDay
    const dayIndex = Math.floor(index / pointsPerDay)
    const isAuction = period === 'intraday' && minuteIndex < 15
    const regularIndex = isAuction ? 0 : minuteIndex - (period === 'intraday' ? 15 : 0)
    const sessionMinutes = regularIndex < 24 ? 30 + regularIndex * 5 : (regularIndex - 24) * 5
    const hour = isAuction ? 9 : regularIndex < 24 ? 9 + Math.floor(sessionMinutes / 60) : 13 + Math.floor(sessionMinutes / 60)
    const minute = isAuction ? 15 + minuteIndex : sessionMinutes % 60
    const barDate = new Date()
    barDate.setDate(barDate.getDate() - (dayCount - dayIndex - 1))
    const wave = Math.sin(index / 4.2) * base * 0.0028
    const drift = (index - 20) * base * 0.000045
    const open = base + wave + drift
    const close = open + Math.sin(index * 1.7) * base * 0.0012
    return {
      time: `${barDate.toISOString().slice(0, 10)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      open,
      close,
      high: Math.max(open, close) + base * (0.0008 + (index % 3) * 0.0002),
      low: Math.min(open, close) - base * (0.0007 + (index % 2) * 0.0002),
      volume: isAuction ? 0 : 850 + ((index * 173) % 2100),
      amount: isAuction ? 0 : (850 + ((index * 173) % 2100)) * close * 100
    }
  })
  return {
    quoteId,
    name: quote?.name ?? '',
    tradingDate: period === 'fiveDay' ? `${bars[0].time.slice(0, 10)} 至 ${date}` : date,
    bars,
    intervalMinutes: period === 'intraday' ? 1 : period === 'fiveDay' ? 5 : undefined
  }
}

function makeDemoOrderBook(quoteId: string): StockOrderBook {
  const quote = DEMO_VALUES[quoteId]
  const latest = quote?.latest ?? 48
  const priceAt = (offset: number) => Number((latest + offset * 0.01).toFixed(2))
  return {
    quoteId,
    name: quote?.name ?? '',
    latest,
    previousClose: quote?.previousClose ?? latest,
    bids: Array.from({ length: 5 }, (_, index) => ({
      price: priceAt(-(index + 1)),
      volume: 260 + ((index * 173) % 1100)
    })),
    asks: Array.from({ length: 5 }, (_, index) => ({
      price: priceAt(index + 1),
      volume: 310 + ((index * 227) % 1200)
    })),
    updatedAt: new Date().toISOString()
  }
}

function makeDemoFundsFlow(quoteId: string): FundsFlowResult {
  const quote = DEMO_VALUES[quoteId]
  const tradingDate = new Date().toISOString().slice(0, 10)
  const points = Array.from({ length: 48 }, (_, index) => {
    const minutes = index < 24 ? 35 + index * 5 : 65 + index * 5
    const hour = index < 24 ? 9 + Math.floor(minutes / 60) : 13 + Math.floor((minutes - 185) / 60)
    const minute = index < 24 ? minutes % 60 : (minutes - 185) % 60
    const main = Math.sin(index / 5) * 38_000_000 + index * 420_000
    const large = main * 0.42 + Math.cos(index / 4) * 7_000_000
    const medium = -main * 0.48 + Math.sin(index / 3) * 5_000_000
    const small = -(main + medium)
    return {
      time: `${tradingDate} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      main,
      superLarge: main - large,
      large,
      medium,
      small
    }
  })
  return { quoteId, name: quote?.name ?? '', tradingDate, points }
}

function makeDemoSectorIndex(stockQuoteId: string): SectorIndexResult {
  const sector = DEMO_SECTORS[stockQuoteId] ?? {
    code: 'BK0727',
    name: '综合行业',
    quoteId: '90.BK0727'
  }
  const sectorStock: WatchStock = {
    ...sector,
    marketLabel: '行业板块',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: false
  }
  return {
    stockQuoteId,
    boardCode: sector.code,
    boardName: sector.name,
    boardQuoteId: sector.quoteId,
    quote: makeDemoQuotes([sectorStock])[0],
    trend: makeDemoKline(sector.quoteId, 'intraday')
  }
}

const noSubscribe = (): (() => void) => () => undefined

const DEMO_FUNDAMENTAL_SNAPSHOT: FundamentalSnapshot = {
  schemaVersion: 1,
  snapshotDate: '2026-08-04',
  generatedAt: '2026-08-04T12:00:00+08:00',
  currency: 'CNY',
  fiscalYears: [2021, 2022, 2023, 2024, 2025],
  latestAnnualReportDate: '2025-12-31',
  sources: [],
  coverage: {
    companyCount: 0,
    completeFiveYearRoeCount: 0,
    completeFiveYearCashProfitCount: 0,
    latestDebtAssetRatioCount: 0,
    latestIndustryPercentileCount: 0,
    industryCount: 0
  },
  industries: [],
  rows: []
}

function demoConfigFileName(): string {
  return `见涨-配置-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`
}

const demoApi: StockDesktopApi = {
  async getBootstrap(): Promise<BootstrapResult> {
    const state = loadDemoState()
    const marketIndices = getMarketIndexStocks(state.settings.marketIndexIds)
    return { state, quotes: makeDemoQuotes([...state.watchlist, ...marketIndices]), source: 'demo' }
  },
  async getTaskbarLayout() {
    return { taskbarHeight: 48 }
  },
  async searchStocks(query) {
    const normalized = query.trim().toLowerCase()
    return DEMO_STOCKS.filter(
      (stock) => stock.code.includes(normalized) || stock.name.toLowerCase().includes(normalized)
    )
  },
  async getDividendFinancingSnapshot() {
    return builtInDividendFinancingSnapshot as DividendFinancingSnapshot
  },
  async getDividendFinancingChangeReport() {
    return null
  },
  async runDividendFinancingUpdate() {
    throw new Error('分红融资榜更新脚本仅能在 Windows 桌面版中运行')
  },
  async getFundamentalSnapshot() {
    return DEMO_FUNDAMENTAL_SNAPSHOT
  },
  async runFundamentalUpdate() {
    throw new Error('基本面财务数据更新脚本仅能在 Windows 桌面版中运行')
  },
  async refreshQuotes() {
    const state = loadDemoState()
    return makeDemoQuotes([...state.watchlist, ...getMarketIndexStocks(state.settings.marketIndexIds)])
  },
  async getKline(quoteId, period, limit) {
    return makeDemoKline(quoteId, period, limit)
  },
  async saveChipDistributionCache(entry) {
    localStorage.setItem(`jianzhang-chip-distribution-${entry.quoteId}`, JSON.stringify(entry))
    return entry
  },
  async getOrderBook(quoteId) {
    return makeDemoOrderBook(quoteId)
  },
  async getFundsFlow(quoteId) {
    return makeDemoFundsFlow(quoteId)
  },
  async getSectorIndex(quoteId) {
    return makeDemoSectorIndex(quoteId)
  },
  async refreshTradingCalendar() {
    throw new Error('交易日历在线刷新仅在 Windows 桌面版中可用')
  },
  async saveState(state) {
    localStorage.setItem('jianzhang-demo-state-v1', JSON.stringify(state))
    return state
  },
  async exportConfig(state) {
    const fileName = demoConfigFileName()
    const blob = new Blob([JSON.stringify(createConfigDocument(state, 'browser-preview'), null, 2)], {
      type: 'application/json'
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    URL.revokeObjectURL(link.href)
    return { canceled: false, filePath: fileName }
  },
  async importConfig() {
    return new Promise<ConfigImportResult>((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve({ canceled: true })
          return
        }
        file.text()
          .then((content) => resolve({
            canceled: false,
            filePath: file.name,
            state: parseConfigDocument(JSON.parse(content))
          }))
          .catch(reject)
      }
      input.click()
    })
  },
  async hideWindow() {},
  async quitApp() {},
  onQuotesUpdated: noSubscribe,
  onStateUpdated: noSubscribe,
  onTaskbarLayout: noSubscribe,
  onSelectStock: noSubscribe,
  onDataError: noSubscribe,
  onDividendFinancingUpdateProgress: noSubscribe,
  onFundamentalUpdateProgress: noSubscribe
}

export const stockApi = window.stockApi ?? demoApi
export const isDesktopRuntime = Boolean(window.stockApi)
export const initialState = DEFAULT_STATE
