import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  normalizeAppSettings,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  type AppState,
  type BootstrapResult,
  type ConfigImportResult,
  type FundsFlowResult,
  type KlinePeriod,
  type KlineResult,
  type SearchResult,
  type StockDesktopApi,
  type StockQuote,
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

const DEFAULT_WATCHLIST: WatchStock[] = DEMO_STOCKS.slice(0, 5).map((stock, index) => ({
  ...stock,
  showInTaskbar: index < 2,
  isPriority: false,
  showRadarSignals: true
}))

const DEFAULT_STATE: AppState = {
  watchlist: DEFAULT_WATCHLIST,
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  settings: { ...DEFAULT_APP_SETTINGS }
}

const DEMO_VALUES: Record<string, Omit<StockQuote, 'updatedAt'>> = {
  '1.600519': {
    code: '600519', name: '贵州茅台', quoteId: '1.600519', latest: 1248.06, change: -3.0,
    changePercent: -0.24, open: 1252.0, high: 1264.62, low: 1245.05, previousClose: 1251.06,
    volume: 17225, amount: 2161774015
  },
  '0.300750': {
    code: '300750', name: '宁德时代', quoteId: '0.300750', latest: 367.81, change: -5.19,
    changePercent: -1.39, open: 369.48, high: 370.97, low: 364.5, previousClose: 373.0,
    volume: 75470, amount: 2776714534
  },
  '0.002594': {
    code: '002594', name: '比亚迪', quoteId: '0.002594', latest: 92.63, change: 0.87,
    changePercent: 0.95, open: 91.74, high: 92.8, low: 91.15, previousClose: 91.76,
    volume: 142119, amount: 1310129948
  },
  '1.600030': {
    code: '600030', name: '中信证券', quoteId: '1.600030', latest: 31.07, change: 0.21,
    changePercent: 0.68, open: 30.83, high: 31.18, low: 30.72, previousClose: 30.86,
    volume: 438210, amount: 1356948120
  },
  '1.600036': {
    code: '600036', name: '招商银行', quoteId: '1.600036', latest: 48.26, change: -0.18,
    changePercent: -0.37, open: 48.51, high: 48.64, low: 48.08, previousClose: 48.44,
    volume: 264580, amount: 1278830400
  }
}

function loadDemoState(): AppState {
  const saved = localStorage.getItem('jianzhang-demo-state-v1')
  if (!saved) return structuredClone(DEFAULT_STATE)
  const parsed = JSON.parse(saved) as AppState
  return {
    watchlist: normalizeWatchlist(parsed.watchlist),
    settings: normalizeAppSettings(parsed.settings),
    columnOrder: normalizeWatchlistColumnOrder(parsed.columnOrder)
  }
}

function makeDemoQuotes(watchlist: WatchStock[]): StockQuote[] {
  const now = new Date().toISOString()
  return watchlist.map((stock, index) => {
    const known = DEMO_VALUES[stock.quoteId]
    const radarSignals = index === 0 ? [{
      type: '8201',
      label: '火箭发射',
      date: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
      time: '10:28:16',
      info: '',
      direction: 'up' as const
    }] : undefined
    if (known) return { ...known, radarSignals, updatedAt: now }
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
      radarSignals,
      updatedAt: now
    }
  })
}

function makeDemoKline(quoteId: string, period: KlinePeriod): KlineResult {
  const quote = DEMO_VALUES[quoteId]
  const base = quote?.open ?? 48
  const date = new Date().toISOString().slice(0, 10)
  if (period === 'daily' || period === 'weekly' || period === 'monthly') {
    const intervalDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30
    const count = period === 'monthly' ? 60 : period === 'weekly' ? 104 : 120
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
        amount: (30_000 + ((index * 7123) % 90_000)) * close * 100
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
  const bars = Array.from({ length: 48 * dayCount }, (_, index) => {
    const minuteIndex = index % 48
    const dayIndex = Math.floor(index / 48)
    const minutes = minuteIndex < 24 ? 35 + minuteIndex * 5 : 65 + minuteIndex * 5
    const hour = minuteIndex < 24 ? 9 + Math.floor(minutes / 60) : 13 + Math.floor((minutes - 185) / 60)
    const minute = minuteIndex < 24 ? minutes % 60 : (minutes - 185) % 60
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
      volume: 850 + ((index * 173) % 2100),
      amount: (850 + ((index * 173) % 2100)) * close * 100
    }
  })
  return {
    quoteId,
    name: quote?.name ?? '',
    tradingDate: period === 'fiveDay' ? `${bars[0].time.slice(0, 10)} 至 ${date}` : date,
    bars
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

const noSubscribe = (): (() => void) => () => undefined

function demoConfigFileName(): string {
  return `见涨-配置-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`
}

const demoApi: StockDesktopApi = {
  async getBootstrap(): Promise<BootstrapResult> {
    const state = loadDemoState()
    return { state, quotes: makeDemoQuotes(state.watchlist), source: 'demo' }
  },
  async searchStocks(query) {
    const normalized = query.trim().toLowerCase()
    return DEMO_STOCKS.filter(
      (stock) => stock.code.includes(normalized) || stock.name.toLowerCase().includes(normalized)
    )
  },
  async refreshQuotes() {
    return makeDemoQuotes(loadDemoState().watchlist)
  },
  async getKline(quoteId, period) {
    return makeDemoKline(quoteId, period)
  },
  async getFundsFlow(quoteId) {
    return makeDemoFundsFlow(quoteId)
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
  onSelectStock: noSubscribe,
  onDataError: noSubscribe
}

export const stockApi = window.stockApi ?? demoApi
export const isDesktopRuntime = Boolean(window.stockApi)
export const initialState = DEFAULT_STATE
