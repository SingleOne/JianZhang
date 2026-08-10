import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_GROUPS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  getMarketIndexStocks,
  migrateWatchlistColumnOrder,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeStockTrackingProfiles,
  normalizeWatchlist,
  normalizeWatchlistGroups,
  synchronizeTrackingGroupMembership,
  type AppState,
  type BootstrapResult,
  type CompanyReportLibraryResult,
  type ConfigImportResult,
  type DataSnapshotRuntimeState,
  type DailyMarketScanResult,
  type DividendFinancingSnapshot,
  type FundamentalSnapshot,
  type FundsFlowResult,
  type KlinePeriod,
  type KlineResult,
  type SectorIndexResult,
  type ShareholderSnapshot,
  type StockDesktopApi,
  type StockOrderBook,
  type StockQuote,
  type StockSectorQuote,
  type WatchStock
} from '../shared/types'
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
  watchlistGroups: DEFAULT_WATCHLIST_GROUPS.map((group) => ({ ...group })),
  stockTrackingProfiles: {},
  columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
  columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
  settings: { ...DEFAULT_APP_SETTINGS },
  tTradingAccounts: {}
}

const DEMO_DAILY_MARKET_SCAN_RESULT: DailyMarketScanResult = {
  schemaVersion: 1,
  tradingDate: '2026-08-05',
  generatedAt: '2026-08-05T07:15:00.000Z',
  source: 'demo',
  universeCount: 5_482,
  activeCount: 1_736,
  klineSuccessCount: 1_728,
  klineFailureCount: 8,
  signalCount: 7,
  rows: [
    {
      code: '600519',
      name: '贵州茅台',
      quoteId: '1.600519',
      marketLabel: '沪A',
      tradingDate: '2026-08-05',
      latest: 1488.6,
      changePercent: 5.82,
      amount: 8_620_000_000,
      volume: 584_200,
      averageVolume20d: 205_000,
      volumeRatio: 2.85,
      breakoutPercent: 1.36,
      breakdownPercent: null,
      previousFiveDayReturn: 1.2,
      declineDays: 2,
      signals: ['volumeSurge', 'strongGain', 'breakout20d']
    },
    {
      code: '300750',
      name: '宁德时代',
      quoteId: '0.300750',
      marketLabel: '创业板',
      tradingDate: '2026-08-05',
      latest: 268.35,
      changePercent: 2.14,
      amount: 6_730_000_000,
      volume: 312_600,
      averageVolume20d: 180_000,
      volumeRatio: 1.74,
      breakoutPercent: null,
      breakdownPercent: null,
      previousFiveDayReturn: -6.28,
      declineDays: 4,
      signals: ['reversal']
    },
    {
      code: '002594',
      name: '比亚迪',
      quoteId: '0.002594',
      marketLabel: '深A',
      tradingDate: '2026-08-05',
      latest: 118.72,
      changePercent: 6.31,
      amount: 5_860_000_000,
      volume: 426_000,
      averageVolume20d: 260_000,
      volumeRatio: 1.64,
      breakoutPercent: null,
      breakdownPercent: null,
      previousFiveDayReturn: 0.86,
      declineDays: 2,
      signals: ['strongGain']
    },
    {
      code: '688981',
      name: '中芯国际',
      quoteId: '1.688981',
      marketLabel: '科创板',
      tradingDate: '2026-08-05',
      latest: 82.36,
      changePercent: -6.18,
      amount: 7_240_000_000,
      volume: 368_000,
      averageVolume20d: 200_000,
      volumeRatio: 1.84,
      breakoutPercent: null,
      breakdownPercent: -1.42,
      previousFiveDayReturn: -2.36,
      declineDays: 3,
      signals: ['strongLoss', 'breakdown20d']
    }
  ]
}

function loadDemoState(): AppState {
  const saved = localStorage.getItem('jianzhang-demo-state-v1')
  if (!saved) return structuredClone(DEFAULT_STATE)
  const parsed = JSON.parse(saved) as AppState
  const watchlistGroups = normalizeWatchlistGroups(parsed.watchlistGroups)
  const stockTrackingProfiles = normalizeStockTrackingProfiles(parsed.stockTrackingProfiles)
  return {
    watchlist: synchronizeTrackingGroupMembership(
      normalizeWatchlist(parsed.watchlist),
      watchlistGroups,
      stockTrackingProfiles
    ),
    watchlistGroups,
    stockTrackingProfiles,
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
    const radarSignals =
      index === 0
        ? [
            {
              type: '8201',
              label: '火箭发射',
              date: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
              time: '10:28:16',
              info: '',
              direction: 'up' as const
            }
          ]
        : undefined
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
        turnoverRate: 0.8 + (index % 10) * 0.15
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
    const hour = isAuction
      ? 9
      : regularIndex < 24
        ? 9 + Math.floor(sessionMinutes / 60)
        : 13 + Math.floor(sessionMinutes / 60)
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

const DEMO_DIVIDEND_FINANCING_SNAPSHOT: DividendFinancingSnapshot = {
  schemaVersion: 2,
  scoreMethodologyVersion: 1,
  snapshotDate: '2026-08-04',
  generatedAt: '2026-08-04T12:00:00+08:00',
  thresholdPercent: 100,
  activeStockCount: 1,
  exactCandidateCount: 1,
  dualListedCount: 0,
  financingErrorCount: 0,
  dividendErrorCount: 0,
  rows: [
    {
      rank: 1,
      code: '600519',
      name: '贵州茅台',
      market: 'SH',
      dividendYi: 3200,
      financingYi: 22.44,
      ratio: 14260.25,
      netReturnYi: 3177.56,
      annualDividends: [],
      financingEvents: [],
      financingCount: 0,
      qualityScore: 96,
      scoreRank: 1,
      qualityScoreBreakdown: {
        ratio: 29,
        netReturn: 24,
        continuity: 24,
        growth: 9,
        financingDiscipline: 10
      }
    }
  ]
}

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

const DEMO_COMPANY_REPORTS: CompanyReportLibraryResult = {
  code: '600519',
  source: '巨潮资讯',
  periodStart: '2017-01-01',
  periodEnd: '2026-08-07',
  fetchedAt: '2026-08-07T08:00:00.000Z',
  fromCache: false,
  reports: [
    {
      id: 'demo-annual',
      code: '600519',
      title: '贵州茅台2025年年度报告',
      reportType: 'annual',
      reportYear: 2025,
      variant: 'full',
      amended: false,
      publishedAt: '2026-04-03T00:00:00.000Z',
      url: 'https://www.cninfo.com.cn/'
    },
    {
      id: 'demo-semiannual',
      code: '600519',
      title: '贵州茅台2025年半年度报告',
      reportType: 'semiannual',
      reportYear: 2025,
      variant: 'full',
      amended: false,
      publishedAt: '2025-08-13T00:00:00.000Z',
      url: 'https://www.cninfo.com.cn/'
    }
  ]
}

function demoSnapshotState(
  snapshot: DividendFinancingSnapshot | FundamentalSnapshot,
  periodLabel: string
): DataSnapshotRuntimeState {
  return {
    status: 'ready',
    progressMessage: null,
    error: null,
    snapshotDate: snapshot.snapshotDate,
    generatedAt: snapshot.generatedAt,
    recordCount: snapshot.rows.length,
    periodLabel,
    staleReason: null
  }
}

function demoConfigFileName(): string {
  return `见涨-配置-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`
}

function makeDemoShareholderSnapshot(quoteId: string): ShareholderSnapshot {
  const code = quoteId.split('.')[1] ?? quoteId
  const market = quoteId.startsWith('1.') ? 'SH' : /^[89]/.test(code) ? 'BJ' : 'SZ'
  const counts: Array<[string, number]> = [
    ['2024-03-31', 169_500],
    ['2024-06-30', 164_200],
    ['2024-09-30', 158_900],
    ['2024-12-31', 153_700],
    ['2025-03-31', 149_800],
    ['2025-06-30', 146_400],
    ['2025-09-30', 142_600],
    ['2025-12-31', 138_900],
    ['2026-03-31', 135_200]
  ]
  const holderHistory = counts.map(([reportDate, holderCount], index) => ({
    reportDate,
    holderCount,
    changePercent: index === 0 ? null : (holderCount / counts[index - 1][1] - 1) * 100,
    averageFreeShares: 5_300 + index * 160,
    averageFreeSharesChangePercent: index === 0 ? null : 2.3,
    concentration: '较分散',
    averageHoldingAmount: 680_000 + index * 45_000,
    topTenHoldingRatio: 61.8,
    topTenFreeHoldingRatio: 61.8
  }))
  const names = [
    '示例控股集团有限公司',
    '香港中央结算有限公司',
    '全国社保基金一一三组合',
    '中国证券金融股份有限公司',
    '中央汇金资产管理有限责任公司'
  ]
  const holdings = names.map((name, index) => ({
    reportDate: '2026-03-31',
    rank: index + 1,
    name,
    holderType: index === 0 ? '其它' : '机构',
    sharesType: '流通A股',
    holdingShares: 580_000_000 / (index + 1),
    holdingRatio: 48 / (index + 1),
    changeShares: index === 1 ? 1_260_000 : null,
    changeLabel: index === 0 ? '不变' : index > 1 ? '新进' : null,
    changeRatio: index === 1 ? 1.25 : null
  }))
  return {
    schemaVersion: 1,
    quoteId,
    code,
    market,
    reportDate: '2026-03-31',
    fetchedAt: '2026-08-10T08:00:00.000Z',
    source: 'eastmoney-f10',
    fromCache: false,
    controller: { name: '示例国有资产监督管理委员会', holdingRatio: null },
    latestSummary: holderHistory.at(-1) ?? null,
    holderHistory,
    topShareholders: holdings,
    topFreeShareholders: holdings
  }
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
    return DEMO_DIVIDEND_FINANCING_SNAPSHOT
  },
  async getDividendFinancingState() {
    return demoSnapshotState(DEMO_DIVIDEND_FINANCING_SNAPSHOT, '浏览器演示快照')
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
  async getFundamentalState() {
    return demoSnapshotState(DEMO_FUNDAMENTAL_SNAPSHOT, '2021—2025 年')
  },
  async getFundamentalChangeReport() {
    return null
  },
  async runFundamentalUpdate() {
    throw new Error('基本面财务数据更新脚本仅能在 Windows 桌面版中运行')
  },
  async getCompanyReports(code) {
    return {
      ...DEMO_COMPANY_REPORTS,
      code,
      reports: DEMO_COMPANY_REPORTS.reports.map((report) => ({ ...report, code }))
    }
  },
  async generateCompanyReportSummary(report) {
    return {
      reportId: report.id,
      code: report.code,
      content:
        '演示总结：公司主营业务保持稳定，请结合报告原文核对收入利润、经营现金流、资产负债变化及风险提示。',
      generatedAt: new Date().toISOString(),
      providerId: 'demo',
      model: 'demo'
    }
  },
  async openCompanyReport(url) {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  async getShareholderSnapshot(quoteId) {
    return makeDemoShareholderSnapshot(quoteId)
  },
  async getValuationHistory(quoteId) {
    return {
      quoteId,
      fetchedAt: new Date().toISOString(),
      periodStart: '2021-08-05',
      periodEnd: '2026-08-05',
      priceEarningsRatioTtmValues: [8, 10, 12, 15, 18, 20, 24],
      priceBookRatioValues: [1, 1.2, 1.5, 1.8, 2.2, 2.8]
    }
  },
  async refreshQuotes() {
    const state = loadDemoState()
    return makeDemoQuotes([
      ...state.watchlist,
      ...getMarketIndexStocks(state.settings.marketIndexIds)
    ])
  },
  async refreshQuote() {
    const state = loadDemoState()
    return makeDemoQuotes([
      ...state.watchlist,
      ...getMarketIndexStocks(state.settings.marketIndexIds)
    ])
  },
  async getKline(quoteId, period, limit) {
    return makeDemoKline(quoteId, period, limit)
  },
  async getDailyMarketScanResult() {
    return DEMO_DAILY_MARKET_SCAN_RESULT
  },
  async getDailyMarketScanState() {
    return {
      running: false,
      progress: {
        stage: 'completed' as const,
        message: '已加载浏览器演示扫描结果。',
        completed: DEMO_DAILY_MARKET_SCAN_RESULT.activeCount,
        total: DEMO_DAILY_MARKET_SCAN_RESULT.activeCount
      },
      error: null
    }
  },
  async runDailyMarketScan() {
    return DEMO_DAILY_MARKET_SCAN_RESULT
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
    const blob = new Blob(
      [JSON.stringify(createConfigDocument(state, 'browser-preview'), null, 2)],
      {
        type: 'application/json'
      }
    )
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
        file
          .text()
          .then((content) =>
            resolve({
              canceled: false,
              filePath: file.name,
              state: parseConfigDocument(JSON.parse(content))
            })
          )
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
  onDividendFinancingStateUpdated: noSubscribe,
  onFundamentalUpdateProgress: noSubscribe,
  onFundamentalStateUpdated: noSubscribe,
  onDailyMarketScanProgress: noSubscribe
}

export const stockApi = window.stockApi ?? demoApi
export const isDesktopRuntime = Boolean(window.stockApi)
export const initialState = DEFAULT_STATE
