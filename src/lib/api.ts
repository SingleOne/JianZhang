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
  type FundsFlowResult,
  type KlinePeriod,
  type KlineResult,
  type SearchResult,
  type SectorIndexResult,
  type StockDesktopApi,
  type StockOrderBook,
  type StockQuote,
  type StockSectorQuote,
  type WatchStock
} from '../shared/types'
import { createConfigDocument, parseConfigDocument } from '../shared/config'

const DEMO_STOCKS: SearchResult[] = [
  { code: '600519', name: '贵州茅台', quoteId: '1.600519', marketLabel: '沪A' },
  { code: '300750', name: '宁德时代', quoteId: '0.300750', marketLabel: '深A' },
  { code: '002594', name: '比亚迪', quoteId: '0.002594', marketLabel: '深A' },
  { code: '600030', name: '中信证券', quoteId: '1.600030', marketLabel: '沪A' },
  { code: '600036', name: '招商银行', quoteId: '1.600036', marketLabel: '沪A' },
  { code: '000858', name: '五粮液', quoteId: '0.000858', marketLabel: '深A' },
  { code: '601318', name: '中国平安', quoteId: '1.601318', marketLabel: '沪A' }
]

const DEMO_SECTORS: Record<string, { code: string; name: string; quoteId: string }> = {
  '1.600519': { code: 'BK0896', name: '白酒', quoteId: '90.BK0896' },
  '0.300750': { code: 'BK1033', name: '电池', quoteId: '90.BK1033' },
  '0.002594': { code: 'BK1029', name: '汽车整车', quoteId: '90.BK1029' },
  '1.600030': { code: 'BK0473', name: '证券', quoteId: '90.BK0473' },
  '1.600036': { code: 'BK0475', name: '银行Ⅱ', quoteId: '90.BK0475' },
  '0.000858': { code: 'BK0896', name: '白酒', quoteId: '90.BK0896' },
  '1.601318': { code: 'BK0474', name: '保险', quoteId: '90.BK0474' }
}

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

const DEMO_VALUES: Record<string, Omit<StockQuote, 'updatedAt'>> = {
  '1.000001': {
    code: '000001', name: '上证指数', quoteId: '1.000001', latest: 3516.28, change: 18.64,
    changePercent: 0.53, open: 3499.42, high: 3522.17, low: 3491.08, previousClose: 3497.64,
    volume: 428_621_900, amount: 512_684_000_000, turnoverRate: 0.86
  },
  '0.399001': {
    code: '399001', name: '深证成指', quoteId: '0.399001', latest: 10728.46, change: -31.62,
    changePercent: -0.29, open: 10754.81, high: 10788.36, low: 10692.17, previousClose: 10760.08,
    volume: 512_386_400, amount: 688_275_000_000, turnoverRate: 1.24
  },
  '0.399006': {
    code: '399006', name: '创业板指', quoteId: '0.399006', latest: 2218.75, change: 14.28,
    changePercent: 0.65, open: 2205.12, high: 2226.44, low: 2198.63, previousClose: 2204.47,
    volume: 143_862_000, amount: 276_518_000_000, turnoverRate: 1.68
  },
  '90.BK0896': {
    code: 'BK0896', name: '白酒', quoteId: '90.BK0896', latest: 42876.42, change: 286.14,
    changePercent: 0.67, open: 42620.15, high: 43118.26, low: 42571.88, previousClose: 42590.28,
    volume: 2_865_300, amount: 42_168_400_000, turnoverRate: 1.12
  },
  '90.BK1033': {
    code: 'BK1033', name: '电池', quoteId: '90.BK1033', latest: 1584.28, change: -8.47,
    changePercent: -0.53, open: 1591.36, high: 1603.42, low: 1576.18, previousClose: 1592.75,
    volume: 8_735_600, amount: 68_276_000_000, turnoverRate: 1.84
  },
  '90.BK1029': {
    code: 'BK1029', name: '汽车整车', quoteId: '90.BK1029', latest: 1846.75, change: 21.36,
    changePercent: 1.17, open: 1828.46, high: 1859.72, low: 1821.05, previousClose: 1825.39,
    volume: 6_482_100, amount: 51_739_000_000, turnoverRate: 1.57
  },
  '90.BK0473': {
    code: 'BK0473', name: '证券', quoteId: '90.BK0473', latest: 1358.12, change: 9.64,
    changePercent: 0.71, open: 1349.88, high: 1364.24, low: 1345.17, previousClose: 1348.48,
    volume: 7_164_800, amount: 57_829_000_000, turnoverRate: 1.36
  },
  '90.BK0475': {
    code: 'BK0475', name: '银行Ⅱ', quoteId: '90.BK0475', latest: 1205.36, change: -3.12,
    changePercent: -0.26, open: 1208.75, high: 1212.63, low: 1201.48, previousClose: 1208.48,
    volume: 5_732_400, amount: 48_615_000_000, turnoverRate: 0.72
  },
  '90.BK0474': {
    code: 'BK0474', name: '保险', quoteId: '90.BK0474', latest: 1098.62, change: 7.94,
    changePercent: 0.73, open: 1092.18, high: 1104.37, low: 1088.56, previousClose: 1090.68,
    volume: 3_164_200, amount: 25_742_000_000, turnoverRate: 0.94
  },
  '1.600519': {
    code: '600519', name: '贵州茅台', quoteId: '1.600519', latest: 1248.06, change: -3.0,
    changePercent: -0.24, open: 1252.0, high: 1264.62, low: 1245.05, previousClose: 1251.06,
    volume: 17225, amount: 2161774015, turnoverRate: 0.14
  },
  '0.300750': {
    code: '300750', name: '宁德时代', quoteId: '0.300750', latest: 367.81, change: -5.19,
    changePercent: -1.39, open: 369.48, high: 370.97, low: 364.5, previousClose: 373.0,
    volume: 75470, amount: 2776714534, turnoverRate: 0.65
  },
  '0.002594': {
    code: '002594', name: '比亚迪', quoteId: '0.002594', latest: 92.63, change: 0.87,
    changePercent: 0.95, open: 91.74, high: 92.8, low: 91.15, previousClose: 91.76,
    volume: 142119, amount: 1310129948, turnoverRate: 0.49
  },
  '1.600030': {
    code: '600030', name: '中信证券', quoteId: '1.600030', latest: 31.07, change: 0.21,
    changePercent: 0.68, open: 30.83, high: 31.18, low: 30.72, previousClose: 30.86,
    volume: 438210, amount: 1356948120, turnoverRate: 0.38
  },
  '1.600036': {
    code: '600036', name: '招商银行', quoteId: '1.600036', latest: 48.26, change: -0.18,
    changePercent: -0.37, open: 48.51, high: 48.64, low: 48.08, previousClose: 48.44,
    volume: 264580, amount: 1278830400, turnoverRate: 0.13
  }
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
  async refreshQuotes() {
    const state = loadDemoState()
    return makeDemoQuotes([...state.watchlist, ...getMarketIndexStocks(state.settings.marketIndexIds)])
  },
  async getKline(quoteId, period, limit) {
    return makeDemoKline(quoteId, period, limit)
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
  onDataError: noSubscribe
}

export const stockApi = window.stockApi ?? demoApi
export const isDesktopRuntime = Boolean(window.stockApi)
export const initialState = DEFAULT_STATE
