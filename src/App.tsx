import { Activity, Bot, CircleCheck, Filter, RefreshCw, Signal, Trophy, WifiOff } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AppTitlebar } from './components/AppTitlebar'
import { useConfirmDialog } from './components/ConfirmDialog'
import { DailyMarketScanDialog } from './components/DailyMarketScanDialog'
import { DividendFinancingRankingDialog } from './components/DividendFinancingRankingDialog'
import { FundamentalScreeningDialog } from './components/FundamentalScreeningDialog'
import { SearchBar } from './components/SearchBar'
import { SettingsMenu } from './components/SettingsMenu'
import { WatchlistTable } from './components/WatchlistTable'
import { initialState, isDesktopRuntime, stockApi } from './lib/api'
import {
  APP_COMPLETION_NOTIFICATION_EVENT,
  type AppCompletionNotification,
  type StockDetailNavigationRequest
} from './lib/completion-notifications'
import { formatCurrency, formatPercent, formatPrice, formatProfit, formatUpdateTime } from './lib/format'
import {
  createFundamentalPeerComparisonMap,
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  screenFundamentalCompanies
} from './lib/fundamental-screening'
import { calculatePortfolioSummary } from './lib/portfolio'
import { reconcileStockQuotes } from './lib/quote-state'
import { getDailyScanWatchlistGroup, MARKET_INDEX_OPTIONS } from './shared/types'
import packageInfo from '../package.json'
import type {
  AppSettings,
  AppState,
  DataSnapshotRuntimeState,
  DividendFinancingChangeReport,
  DividendFinancingSnapshot,
  FundamentalChangeReport,
  FundamentalSnapshot,
  SearchResult,
  StockPosition,
  StockPositionSnapshot,
  StockAlertRule,
  StockQuote,
  TTradingAccount,
  WatchlistGroup,
  WatchlistColumnId
} from './shared/types'

const EMPTY_DATA_SNAPSHOT_STATE: DataSnapshotRuntimeState = {
  status: 'missing',
  progressMessage: null,
  error: null,
  snapshotDate: null,
  generatedAt: null,
  recordCount: 0,
  periodLabel: null,
  staleReason: null
}

// AI UI remains behind build-time boundaries so share builds can omit it completely.
const AiAssistantDrawer = __JIANZHANG_AI_MODULE_ENABLED__
  ? lazy(() => import('./modules/ai/renderer/register').then((module) => ({ default: module.AiAssistantDrawer })))
  : null

function directionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function cardDirectionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-card-flat'
  return value > 0 ? 'is-card-up' : 'is-card-down'
}

export default function App() {
  const confirm = useConfirmDialog()
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null)
  const [completionNotifications, setCompletionNotifications] = useState<
    AppCompletionNotification[]
  >([])
  const [detailNavigationRequest, setDetailNavigationRequest] =
    useState<StockDetailNavigationRequest | null>(null)
  const [source, setSource] = useState<'eastmoney' | 'demo'>('eastmoney')
  const [initializing, setInitializing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [calendarRefreshing, setCalendarRefreshing] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false)
  const [dividendRankingOpen, setDividendRankingOpen] = useState(false)
  const [fundamentalScreeningOpen, setFundamentalScreeningOpen] = useState(false)
  const [dailyMarketScanOpen, setDailyMarketScanOpen] = useState(false)
  const [dividendFinancingSnapshot, setDividendFinancingSnapshot] = useState<DividendFinancingSnapshot | null>(null)
  const [dividendFinancingChangeReport, setDividendFinancingChangeReport] = useState<DividendFinancingChangeReport | null>(null)
  const [fundamentalSnapshot, setFundamentalSnapshot] = useState<FundamentalSnapshot | null>(null)
  const [fundamentalChangeReport, setFundamentalChangeReport] = useState<FundamentalChangeReport | null>(null)
  const [dividendFinancingState, setDividendFinancingState] = useState<DataSnapshotRuntimeState>(EMPTY_DATA_SNAPSHOT_STATE)
  const [fundamentalDataState, setFundamentalDataState] = useState<DataSnapshotRuntimeState>(EMPTY_DATA_SNAPSHOT_STATE)
  const [aiAssistantContext, setAiAssistantContext] = useState<{ quoteId: string; quoteName?: string } | null>(null)
  const aiRuntimeAvailable = Boolean(AiAssistantDrawer && window.aiApi)

  const updateQuotes = useCallback((incoming: StockQuote[]) => {
    setQuotes((current) => reconcileStockQuotes(current, incoming))
  }, [])

  const reportError = useCallback((message: string) => {
    setNotice('')
    setError(message)
  }, [])

  const reportSuccess = useCallback((message: string) => {
    setError('')
    setNotice(message)
  }, [])

  useEffect(() => {
    stockApi.getBootstrap()
      .then((bootstrap) => {
        setState(bootstrap.state)
        setQuotes(bootstrap.quotes)
        setSource(bootstrap.source)
        if (bootstrap.warning) reportError(bootstrap.warning)
        setSelectedQuoteId((current) =>
          current && bootstrap.state.watchlist.some((stock) => stock.quoteId === current) ? current : null
        )
      })
      .catch((reason: unknown) => reportError(reason instanceof Error ? reason.message : '应用初始化失败'))
      .finally(() => setInitializing(false))

    const unsubscribeQuotes = stockApi.onQuotesUpdated(updateQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeSelection = stockApi.onSelectStock(setSelectedQuoteId)
    const unsubscribeError = stockApi.onDataError(reportError)
    return () => {
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeSelection()
      unsubscribeError()
    }
  }, [reportError, updateQuotes])

  useEffect(() => {
    let active = true
    const syncDividendSnapshot = () => {
      Promise.all([
        stockApi.getDividendFinancingSnapshot(),
        stockApi.getDividendFinancingChangeReport()
      ]).then(([snapshot, changeReport]) => {
        if (!active) return
        setDividendFinancingSnapshot(snapshot)
        setDividendFinancingChangeReport(changeReport)
      }).catch(() => undefined)
    }
    const syncFundamentalSnapshot = () => {
      Promise.all([
        stockApi.getFundamentalSnapshot(),
        stockApi.getFundamentalChangeReport()
      ]).then(([snapshot, changeReport]) => {
        if (!active) return
        setFundamentalSnapshot(snapshot)
        setFundamentalChangeReport(changeReport)
      }).catch(() => undefined)
    }
    const unsubscribeDividendState = stockApi.onDividendFinancingStateUpdated((snapshotState) => {
      if (!active) return
      setDividendFinancingState(snapshotState)
      if (snapshotState.status === 'ready' || snapshotState.status === 'stale') {
        syncDividendSnapshot()
      }
    })
    const unsubscribeFundamentalState = stockApi.onFundamentalStateUpdated((snapshotState) => {
      if (!active) return
      setFundamentalDataState(snapshotState)
      if (snapshotState.status === 'ready' || snapshotState.status === 'stale') {
        syncFundamentalSnapshot()
      }
    })
    Promise.all([
      stockApi.getDividendFinancingSnapshot(),
      stockApi.getDividendFinancingChangeReport(),
      stockApi.getDividendFinancingState(),
      stockApi.getFundamentalState(),
      stockApi.getFundamentalSnapshot(),
      stockApi.getFundamentalChangeReport()
    ])
      .then(([
        snapshot,
        changeReport,
        dividendState,
        fundamentalState,
        fundamentalData,
        fundamentalChanges
      ]) => {
        if (active) {
          setDividendFinancingSnapshot(snapshot)
          setDividendFinancingChangeReport(changeReport)
          setDividendFinancingState(dividendState)
          setFundamentalDataState(fundamentalState)
          setFundamentalSnapshot(fundamentalData)
          setFundamentalChangeReport(fundamentalChanges)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribeDividendState()
      unsubscribeFundamentalState()
    }
  }, [])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(''), 4200)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const addCompletionNotification = (event: Event) => {
      const notification = (event as CustomEvent<AppCompletionNotification>).detail
      if (!notification) return
      setCompletionNotifications((current) => [notification, ...current])
    }
    window.addEventListener(APP_COMPLETION_NOTIFICATION_EVENT, addCompletionNotification)
    return () =>
      window.removeEventListener(APP_COMPLETION_NOTIFICATION_EVENT, addCompletionNotification)
  }, [])

  useEffect(() => {
    const openWithStockContext = (event: Event) => {
      const detail = (event as CustomEvent<{ quoteId: string; quoteName?: string }>).detail
      if (!detail?.quoteId) return
      setAiAssistantContext(detail)
      setAiAssistantOpen(true)
    }
    window.addEventListener('ai:open-assistant', openWithStockContext)
    return () => window.removeEventListener('ai:open-assistant', openWithStockContext)
  }, [])

  const quoteIds = useMemo(() => new Set(state.watchlist.map((stock) => stock.quoteId)), [state.watchlist])
  const dividendFinancingByCode = useMemo(
    () => new Map(dividendFinancingSnapshot?.rows.map((item) => [item.code, item]) ?? []),
    [dividendFinancingSnapshot]
  )
  const fundamentalEvaluations = useMemo(
    () => fundamentalSnapshot
      ? screenFundamentalCompanies(
          fundamentalSnapshot,
          DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
        )
      : [],
    [fundamentalSnapshot]
  )
  const fundamentalScreeningByCode = useMemo(() => {
    const watchlistCodes = new Set(state.watchlist.map((stock) => stock.code))
    return new Map(
      fundamentalEvaluations
        .filter((evaluation) => watchlistCodes.has(evaluation.company.code))
        .map((evaluation) => [evaluation.company.code, evaluation])
    )
  }, [fundamentalEvaluations, state.watchlist])
  const fundamentalPeerComparisonsByCode = useMemo(
    () => createFundamentalPeerComparisonMap(fundamentalEvaluations),
    [fundamentalEvaluations]
  )
  const portfolioSummary = useMemo(
    () => calculatePortfolioSummary(state.watchlist, quotes, state.tTradingAccounts),
    [quotes, state.tTradingAccounts, state.watchlist]
  )
  const marketIndexQuotes = useMemo(() => {
    const selectedIds = new Set(state.settings.marketIndexIds)
    const quotesById = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return MARKET_INDEX_OPTIONS
      .filter((index) => selectedIds.has(index.id))
      .map((index) => ({ index, quote: quotesById.get(index.quoteId) }))
  }, [quotes, state.settings.marketIndexIds])
  const lastUpdated = quotes.reduce<string | undefined>((latest, quote) => {
    if (!latest || quote.updatedAt > latest) return quote.updatedAt
    return latest
  }, undefined)

  const persist = useCallback(async (nextState: AppState, refreshDemoQuotes = true) => {
    setState(nextState)
    try {
      const saved = await stockApi.saveState(nextState)
      setState(saved)
      if (!isDesktopRuntime && refreshDemoQuotes) updateQuotes(await stockApi.refreshQuotes())
      return saved
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '设置保存失败')
      return null
    }
  }, [reportError, updateQuotes])

  const addStock = useCallback((result: SearchResult, targetGroup?: WatchlistGroup) => {
    const existing = state.watchlist.find((stock) => stock.quoteId === result.quoteId)
    if (existing) {
      setSelectedQuoteId(existing.quoteId)
      return
    }
    const nextState = {
      ...state,
      watchlistGroups: targetGroup && !state.watchlistGroups.some((group) => group.id === targetGroup.id)
        ? [...state.watchlistGroups, targetGroup]
        : state.watchlistGroups,
      watchlist: [...state.watchlist, {
        ...result,
        showInTaskbar: false,
        isPriority: false,
        showRadarSignals: true,
        groupIds: targetGroup ? [targetGroup.id] : undefined
      }]
    }
    setSelectedQuoteId(result.quoteId)
    void persist(nextState, false).then((saved) => {
      if (saved) return stockApi.refreshQuote(result.quoteId).then(updateQuotes)
      return undefined
    }).catch((reason: unknown) => {
      reportError(reason instanceof Error ? reason.message : '新股票行情获取失败')
    })
  }, [persist, reportError, state, updateQuotes])

  const addDailyMarketScanStock = useCallback((result: SearchResult) => {
    addStock(result, getDailyScanWatchlistGroup(state.watchlistGroups))
  }, [addStock, state.watchlistGroups])

  const removeStock = useCallback((quoteId: string) => {
    const nextWatchlist = state.watchlist.filter((stock) => stock.quoteId !== quoteId)
    setSelectedQuoteId((current) => current === quoteId ? null : current)
    setQuotes((current) => current.filter((quote) => quote.quoteId !== quoteId))
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const toggleTaskbar = useCallback((quoteId: string) => {
    const nextWatchlist = state.watchlist.map((stock) =>
      stock.quoteId === quoteId ? { ...stock, showInTaskbar: !stock.showInTaskbar } : stock
    )
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const togglePriority = useCallback((quoteId: string) => {
    const nextWatchlist = state.watchlist.map((stock) => (
      stock.quoteId === quoteId && !stock.position
        ? { ...stock, isPriority: !stock.isPriority }
        : stock
    ))
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const updatePosition = useCallback((
    quoteId: string,
    position: StockPosition | undefined,
    showRadarSignals: boolean,
    positionSnapshots: StockPositionSnapshot[],
    updatedAccount?: TTradingAccount
  ) => {
    const nextWatchlist = state.watchlist.map((stock) =>
      stock.quoteId === quoteId
        ? {
            ...stock,
            position,
            positionSnapshots,
            showRadarSignals,
            isPriority: position ? true : stock.isPriority
          }
        : stock
    )
    void persist({
      ...state,
      watchlist: nextWatchlist,
      tTradingAccounts: updatedAccount
        ? { ...state.tTradingAccounts, [quoteId]: updatedAccount }
        : state.tTradingAccounts
    })
  }, [persist, state])

  const updateTTrading = useCallback((
    quoteId: string,
    account: TTradingAccount,
    position: StockPosition | undefined
  ) => {
    const nextWatchlist = state.watchlist.map((stock) => (
      stock.quoteId === quoteId
        ? { ...stock, position, isPriority: position ? true : stock.isPriority }
        : stock
    ))
    void persist({
      ...state,
      watchlist: nextWatchlist,
      tTradingAccounts: {
        ...state.tTradingAccounts,
        [quoteId]: account
      }
    })
  }, [persist, state])

  const updateStockAlerts = useCallback((quoteId: string, alertRules: StockAlertRule[]) => {
    const nextWatchlist = state.watchlist.map((stock) => (
      stock.quoteId === quoteId ? { ...stock, alertRules } : stock
    ))
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const reorderWatchlist = useCallback((sourceQuoteId: string, targetQuoteId: string) => {
    const sourceIndex = state.watchlist.findIndex((stock) => stock.quoteId === sourceQuoteId)
    const targetIndex = state.watchlist.findIndex((stock) => stock.quoteId === targetQuoteId)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return
    const nextWatchlist = [...state.watchlist]
    const [movedStock] = nextWatchlist.splice(sourceIndex, 1)
    nextWatchlist.splice(targetIndex, 0, movedStock)
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const pinStock = useCallback((quoteId: string) => {
    const currentIndex = state.watchlist.findIndex((stock) => stock.quoteId === quoteId)
    if (currentIndex <= 0) return
    const nextWatchlist = [...state.watchlist]
    const [pinnedStock] = nextWatchlist.splice(currentIndex, 1)
    nextWatchlist.unshift(pinnedStock)
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const updateColumnOrder = useCallback((columnOrder: WatchlistColumnId[]) => {
    void persist({ ...state, columnOrder })
  }, [persist, state])

  const updateWatchlistGroups = useCallback((
    watchlistGroups: WatchlistGroup[],
    groupIdsByQuoteId: Record<string, string[]>
  ) => {
    const nextWatchlist = state.watchlist.map((stock) => ({
      ...stock,
      groupIds: groupIdsByQuoteId[stock.quoteId] ?? stock.groupIds ?? []
    }))
    void persist({ ...state, watchlistGroups, watchlist: nextWatchlist })
  }, [persist, state])

  const updateSettings = useCallback((settings: AppSettings) => {
    void persist({ ...state, settings })
  }, [persist, state])

  const selectWatchlistStock = useCallback((quoteId: string) => {
    setSelectedQuoteId((current) => current === quoteId ? null : quoteId)
  }, [])

  const openCompletionNotification = useCallback(
    (notification: AppCompletionNotification) => {
      setCompletionNotifications((current) =>
        current.filter((item) => item.id !== notification.id)
      )
      setSelectedQuoteId(notification.quoteId)
      setDetailNavigationRequest({
        id: notification.id,
        quoteId: notification.quoteId,
        target: notification.target
      })
    },
    []
  )

  const handleDetailNavigationHandled = useCallback((requestId: string) => {
    setDetailNavigationRequest((current) => (current?.id === requestId ? null : current))
  }, [])

  const viewWatchlistStockFromRanking = useCallback((quoteId: string) => {
    setSelectedQuoteId(quoteId)
    setDividendRankingOpen(false)
  }, [])

  const viewWatchlistStockFromFundamentals = useCallback((quoteId: string) => {
    setSelectedQuoteId(quoteId)
    setFundamentalScreeningOpen(false)
  }, [])

  const viewWatchlistStockFromDailyScan = useCallback((quoteId: string) => {
    setSelectedQuoteId(quoteId)
    setDailyMarketScanOpen(false)
  }, [])

  const updateChipDistributionEnabled = useCallback((enabled: boolean) => {
    updateSettings({
      ...state.settings,
      showChipDistribution: enabled
    })
  }, [state.settings, updateSettings])

  const updateBollingerBandsEnabled = useCallback((enabled: boolean) => {
    updateSettings({
      ...state.settings,
      showBollingerBands: enabled
    })
  }, [state.settings, updateSettings])

  const exportConfig = useCallback(async () => {
    setConfigBusy(true)
    try {
      const result = await stockApi.exportConfig(state)
      if (!result.canceled) reportSuccess('配置已导出到所选位置')
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '配置导出失败')
    } finally {
      setConfigBusy(false)
    }
  }, [reportError, reportSuccess, state])

  const importConfig = useCallback(async () => {
    setConfigBusy(true)
    try {
      const result = await stockApi.importConfig()
      if (result.canceled || !result.state) return
      const confirmed = await confirm({
        title: '导入并覆盖当前配置',
        message: `导入后将用文件中的 ${result.state.watchlist.length} 只股票和全部设置覆盖当前配置。`,
        confirmLabel: '继续导入',
        tone: 'danger'
      })
      if (!confirmed) return

      const importedQuoteIds = new Set(result.state.watchlist.map((stock) => stock.quoteId))
      setSelectedQuoteId(null)
      setQuotes((current) => current.filter((quote) => importedQuoteIds.has(quote.quoteId)))
      const saved = await persist(result.state)
      if (saved) reportSuccess(`已导入 ${saved.watchlist.length} 只股票及全部设置`)
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '配置导入失败')
    } finally {
      setConfigBusy(false)
    }
  }, [confirm, persist, reportError, reportSuccess])

  const refreshNow = async () => {
    setRefreshing(true)
    try {
      updateQuotes(await stockApi.refreshQuotes())
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const refreshTradingCalendar = async () => {
    setCalendarRefreshing(true)
    try {
      const tradingCalendar = await stockApi.refreshTradingCalendar()
      setState((current) => ({
        ...current,
        settings: { ...current.settings, tradingCalendar }
      }))
      reportSuccess(`交易日历已更新至 ${tradingCalendar.coveredThroughYear} 年`)
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '交易日历刷新失败')
    } finally {
      setCalendarRefreshing(false)
    }
  }

  const updateFundamentalData = async () => {
    try {
      const result = await stockApi.runFundamentalUpdate()
      setFundamentalSnapshot(result.snapshot)
      setFundamentalChangeReport(result.changeReport)
      reportSuccess(`基本面数据已更新，共 ${result.snapshot.rows.length} 家公司`)
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '基本面数据更新失败')
    }
  }

  return (
    <div className="app-shell">
      <AppTitlebar>
        <section className="titlebar-command-bar" aria-label="自选股操作">
          <div className="titlebar-command-main">
            <SearchBar onAdd={addStock} existingQuoteIds={quoteIds} onError={reportError} />
          </div>
          <div className="titlebar-command-actions">
            <button
              className="secondary-button refresh-button"
              onClick={refreshNow}
              disabled={refreshing}
              title="立即刷新"
            >
              <RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} />
              <span>立即刷新</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDividendRankingOpen(true)}
              title="分红融资榜"
            >
              <Trophy size={17} />
              <span>分红融资榜</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setFundamentalScreeningOpen(true)}
              title="基本面初筛"
            >
              <Filter size={17} />
              <span>基本面初筛</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDailyMarketScanOpen(true)}
              title="A 股收盘扫描"
            >
              <Activity size={17} />
              <span>收盘扫描</span>
            </button>
            {aiRuntimeAvailable ? (
              <button
                className="secondary-button ai-assistant-trigger"
                type="button"
                onClick={() => { setAiAssistantContext(null); setAiAssistantOpen(true) }}
                title="AI 助手"
              >
                <Bot size={17} />
                <span>AI 助手</span>
              </button>
            ) : null}
            <SettingsMenu
              settings={state.settings}
              onChange={updateSettings}
              onImportConfig={importConfig}
              onExportConfig={exportConfig}
              configBusy={configBusy}
              onRefreshTradingCalendar={refreshTradingCalendar}
              calendarRefreshing={calendarRefreshing}
              fundamentalDataState={fundamentalDataState}
              onUpdateFundamentalData={updateFundamentalData}
            />
          </div>
        </section>
      </AppTitlebar>
      <main className="app-main">
        <div className="workspace">
          <section className="watchlist-panel" aria-label="我的自选">
            <div className="panel-heading">
              <div className="panel-heading-primary">
                <div className="panel-title">
                  <div className="panel-title-heading">
                    <h1>我的自选</h1>
                    <div
                      className="auto-refresh-state panel-title-refresh"
                      title="仅在北京时间 09:15:00–11:30:30、12:59:30–15:30:30 自动刷新"
                    >
                      <span className="live-dot" />
                      重点 {state.settings.priorityRefreshSeconds} 秒 · 其余 {state.settings.regularRefreshSeconds} 秒刷新
                    </div>
                  </div>
                  <span>{state.watchlist.length} 只股票 · {state.watchlist.filter((stock) => stock.isPriority).length} 只重点 · {portfolioSummary.positionCount} 只有持仓 · 点击股票行展开行情详情</span>
                </div>
                <div id="portfolio-quality-slot" className="portfolio-quality-slot" />
                {marketIndexQuotes.length > 0 ? (
                  <div className="market-index-summary panel-market-index-summary" aria-label="大盘指数行情">
                    {marketIndexQuotes.map(({ index, quote }) => (
                      <span
                        className={`market-index-card ${cardDirectionClass(quote?.changePercent)}`}
                        title={`${index.name} ${formatPrice(quote?.latest)} ${formatPercent(quote?.changePercent)}`}
                        key={index.id}
                      >
                        <small>{index.name}</small>
                        <span>
                          <strong>{formatPrice(quote?.latest)}</strong>
                          <em className={directionClass(quote?.changePercent)}>
                            {formatPercent(quote?.changePercent)}
                          </em>
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="panel-heading-side">
                <div className="portfolio-summary" aria-label="全部持仓收益汇总">
                  <span>
                    <small>持仓总市值</small>
                    <strong>{formatCurrency(portfolioSummary.marketValue)}</strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.todayProfit)}>
                    <small>今日总收益</small>
                    <strong className={portfolioSummary.todayProfit === null ? 'is-flat' : portfolioSummary.todayProfit >= 0 ? 'is-up' : 'is-down'}>
                      {formatProfit(portfolioSummary.todayProfit)}
                    </strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.todayProfitPercent)}>
                    <small>今日收益率</small>
                    <strong className={portfolioSummary.todayProfitPercent === null ? 'is-flat' : portfolioSummary.todayProfitPercent >= 0 ? 'is-up' : 'is-down'}>
                      {formatPercent(portfolioSummary.todayProfitPercent)}
                    </strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.totalProfit)}>
                    <small>持仓总收益</small>
                    <strong className={portfolioSummary.totalProfit === null ? 'is-flat' : portfolioSummary.totalProfit >= 0 ? 'is-up' : 'is-down'}>
                      {formatProfit(portfolioSummary.totalProfit)}
                    </strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.profitPercent)}>
                    <small>总收益率</small>
                    <strong className={portfolioSummary.profitPercent === null ? 'is-flat' : portfolioSummary.profitPercent >= 0 ? 'is-up' : 'is-down'}>
                      {formatPercent(portfolioSummary.profitPercent)}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
            {initializing ? (
              <div className="initial-loading">
                <span className="search-loader" />
                正在读取自选行情…
              </div>
            ) : (
              <WatchlistTable
                watchlist={state.watchlist}
                watchlistGroups={state.watchlistGroups}
                quotes={quotes}
                dividendFinancingByCode={dividendFinancingByCode}
                dividendFinancingSnapshotDate={dividendFinancingSnapshot?.snapshotDate}
                dividendFinancingStaleReason={
                  dividendFinancingState.status === 'stale'
                    ? dividendFinancingState.staleReason
                    : null
                }
                fundamentalScreeningByCode={fundamentalScreeningByCode}
                fundamentalPeerComparisonsByCode={fundamentalPeerComparisonsByCode}
                fundamentalSnapshotDate={fundamentalSnapshot?.snapshotDate}
                fundamentalGeneratedAt={fundamentalSnapshot?.generatedAt}
                fundamentalStaleReason={
                  fundamentalDataState.status === 'stale'
                    ? fundamentalDataState.staleReason
                    : null
                }
                columnOrder={state.columnOrder}
                priorityRefreshSeconds={state.settings.priorityRefreshSeconds}
                regularRefreshSeconds={state.settings.regularRefreshSeconds}
                chipDistributionEnabled={state.settings.showChipDistribution}
                bollingerBandsEnabled={state.settings.showBollingerBands}
                selectedQuoteId={selectedQuoteId}
                detailNavigationRequest={detailNavigationRequest}
                tTradingAccounts={state.tTradingAccounts}
                tTradingFees={state.settings.tTradingFees}
                tPlanDefaults={state.settings.tPlanDefaults}
                tFloatingProfitAlertDefaultThreshold={state.settings.tFloatingProfitAlertDefaultThreshold}
                tradingCalendarClosedDates={state.settings.tradingCalendar.closedDates}
                onSelect={selectWatchlistStock}
                onDetailNavigationHandled={handleDetailNavigationHandled}
                onToggleTaskbar={toggleTaskbar}
                onTogglePriority={togglePriority}
                onEditPosition={updatePosition}
                onUpdateTTrading={updateTTrading}
                onUpdateStockAlerts={updateStockAlerts}
                onReorder={reorderWatchlist}
                onPin={pinStock}
                onColumnOrderChange={updateColumnOrder}
                onUpdateWatchlistGroups={updateWatchlistGroups}
                onChipDistributionEnabledChange={updateChipDistributionEnabled}
                onBollingerBandsEnabledChange={updateBollingerBandsEnabled}
                onRemove={removeStock}
              />
            )}
          </section>
        </div>
      </main>

      <footer className="statusbar">
        <div className="status-source">
          {error ? <WifiOff size={14} /> : <Signal size={14} />}
          <span>{source === 'eastmoney' ? '东方财富公开行情' : '浏览器预览数据'}</span>
        </div>
        <span className="status-separator" />
        <span>{error ? '行情连接异常，保留最近数据' : `最近更新 ${formatUpdateTime(lastUpdated)}`}</span>
        {completionNotifications[0] ? (
          <>
            <span className="status-separator" />
            <button
              className="status-completion-notification"
              type="button"
              onClick={() => openCompletionNotification(completionNotifications[0])}
              title={`${completionNotifications[0].message}，点击查看`}
            >
              <CircleCheck size={14} />
              <span>{completionNotifications[0].message}</span>
              {completionNotifications.length > 1 ? (
                <em>+{completionNotifications.length - 1}</em>
              ) : null}
            </button>
          </>
        ) : null}
        <span className="status-spacer" />
        <span className="status-version">版本 v{packageInfo.version}</span>
        <span className="status-separator" />
        <span>红涨绿跌 · 行情仅供参考</span>
      </footer>

      {error ? <div className="error-toast"><WifiOff size={17} />{error}</div> : null}
      {notice ? <div className="success-toast"><CircleCheck size={17} />{notice}</div> : null}
      <DividendFinancingRankingDialog
        open={dividendRankingOpen}
        cachedSnapshot={dividendFinancingSnapshot}
        cachedChangeReport={dividendFinancingChangeReport}
        dataState={dividendFinancingState}
        watchlist={state.watchlist}
        onAddStock={addStock}
        onViewStock={viewWatchlistStockFromRanking}
        onSnapshotChange={setDividendFinancingSnapshot}
        onChangeReportChange={setDividendFinancingChangeReport}
        onClose={() => setDividendRankingOpen(false)}
      />
      <FundamentalScreeningDialog
        open={fundamentalScreeningOpen}
        cachedSnapshot={fundamentalSnapshot}
        cachedChangeReport={fundamentalChangeReport}
        dataState={fundamentalDataState}
        watchlist={state.watchlist}
        onAddStock={addStock}
        onViewStock={viewWatchlistStockFromFundamentals}
        onSnapshotChange={setFundamentalSnapshot}
        onChangeReportChange={setFundamentalChangeReport}
        onClose={() => setFundamentalScreeningOpen(false)}
      />
      <DailyMarketScanDialog
        open={dailyMarketScanOpen}
        watchlist={state.watchlist}
        onAddStock={addDailyMarketScanStock}
        onViewStock={viewWatchlistStockFromDailyScan}
        onClose={() => setDailyMarketScanOpen(false)}
      />
      {AiAssistantDrawer ? (
        <Suspense fallback={null}>
          <AiAssistantDrawer
            open={aiAssistantOpen}
            context={aiAssistantContext}
            stocks={state.watchlist}
            onClose={() => setAiAssistantOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
