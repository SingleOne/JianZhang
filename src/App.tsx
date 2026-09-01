import { Bot, CircleCheck, RefreshCw, Signal, WifiOff } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AppTitlebar, MarketTradingState } from './components/AppTitlebar'
import { useConfirmDialog } from './components/ConfirmDialog'
import { SearchBar } from './components/SearchBar'
import { SettingsMenu } from './components/SettingsMenu'
import { TitlebarToolsMenu } from './components/TitlebarToolsMenu'
import { WatchlistTable } from './components/WatchlistTable'
import { getInitialBootstrap, initialState, isDesktopRuntime, stockApi } from './lib/api'
import {
  APP_COMPLETION_NOTIFICATION_EVENT,
  type AppCompletionNotification,
  type StockDetailNavigationRequest
} from './lib/completion-notifications'
import { formatMoneyProfit, formatPercent, formatPrice, formatUpdateTime } from './lib/format'
import {
  DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA,
  evaluateFundamentalCompany,
  type FundamentalScreeningEvaluation
} from './lib/fundamental-screening'
import { calculatePortfolioSummary } from './lib/portfolio'
import { reconcileStockQuotes } from './lib/quote-state'
import {
  createStockTrackingSource,
  startStockTracking,
  stopStockTracking
} from './lib/stock-tracking'
import {
  getDailyScanWatchlistGroup,
  getTrackingWatchlistGroup,
  MARKET_INDEX_OPTIONS
} from './shared/types'
import packageInfo from '../package.json'
import type {
  AppSettings,
  AppState,
  CacheCategoryId,
  CacheClearResult,
  CacheSummary,
  ConfigImportResult,
  CorporateActionRecord,
  DataSnapshotRuntimeState,
  DividendFinancingChangeReport,
  DividendFinancingOverview,
  DividendFinancingRankingItem,
  DividendFinancingSnapshot,
  DailyMarketScanRow,
  FundamentalChangeReport,
  FundamentalOverview,
  FundamentalSnapshot,
  GitHubDeviceAuthorization,
  GitHubSyncSettings,
  OptionalModulesState,
  PortfolioPerformanceAdjustments,
  SearchResult,
  StockPosition,
  StockPositionSnapshot,
  StockAlertRule,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  StockTrackingSource,
  StockQuote,
  StockSelectionRequest,
  TTradingAccount,
  WatchlistGroup,
  WatchlistColumnId
} from './shared/types'

const DailyMarketScanDialog = lazy(() =>
  import('./components/DailyMarketScanDialog').then((module) => ({
    default: module.DailyMarketScanDialog
  }))
)
const DividendFinancingRankingDialog = lazy(() =>
  import('./components/DividendFinancingRankingDialog').then((module) => ({
    default: module.DividendFinancingRankingDialog
  }))
)
const FundamentalScreeningDialog = lazy(() =>
  import('./components/FundamentalScreeningDialog').then((module) => ({
    default: module.FundamentalScreeningDialog
  }))
)
const StockTrackingDialog = lazy(() =>
  import('./components/StockTrackingDialog').then((module) => ({
    default: module.StockTrackingDialog
  }))
)
const CorporateActionCenterDialog = lazy(() => import('./components/CorporateActionCenterDialog'))
const PortfolioPerformanceDialog = lazy(() => import('./components/PortfolioPerformanceDialog'))

interface StockAddOptions {
  startTracking?: boolean
  source?: StockTrackingSource
  targetGroups?: WatchlistGroup[]
}

type DeferredDialogId = 'dividend-ranking' | 'fundamental-screening' | 'daily-scan' | 'tracking'

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

const INITIAL_OPTIONAL_MODULES_STATE: OptionalModulesState = {
  marketInsight: {
    status: __JIANZHANG_MARKET_INSIGHT_ENABLED__ ? 'initializing' : 'disabled',
    error: null
  },
  ai: { status: __JIANZHANG_AI_MODULE_ENABLED__ ? 'initializing' : 'disabled', error: null },
  aiTAdvice: {
    status: __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__ ? 'initializing' : 'disabled',
    error: null
  }
}

// AI UI remains behind build-time boundaries so share builds can omit it completely.
const AiAssistantDrawer = __JIANZHANG_AI_MODULE_ENABLED__
  ? lazy(() =>
      import('./modules/ai/renderer/register').then((module) => ({
        default: module.AiAssistantDrawer
      }))
    )
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
  const [stockSelectionRequest, setStockSelectionRequest] = useState<StockSelectionRequest | null>(
    null
  )
  const [completionNotifications, setCompletionNotifications] = useState<
    AppCompletionNotification[]
  >([])
  const [detailNavigationRequest, setDetailNavigationRequest] =
    useState<StockDetailNavigationRequest | null>(null)
  const [source, setSource] = useState<'eastmoney' | 'demo'>('eastmoney')
  const [initializing, setInitializing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [calendarRefreshing, setCalendarRefreshing] = useState(false)
  const [exchangeRatesRefreshing, setExchangeRatesRefreshing] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [githubSyncBusy, setGitHubSyncBusy] = useState(false)
  const [githubSyncUploading, setGitHubSyncUploading] = useState(false)
  const [githubSyncDownloading, setGitHubSyncDownloading] = useState(false)
  const [githubSyncSettings, setGitHubSyncSettings] = useState<GitHubSyncSettings>({
    oauthAvailable: false,
    connected: false,
    hasStoredPassword: false,
    syncPasswordReady: false,
    requiresRemoteRestore: false
  })
  const [githubSyncPassword, setGitHubSyncPassword] = useState<string | null>(null)
  const [githubGistLoading, setGitHubGistLoading] = useState(false)
  const [githubSyncPasswordSaving, setGitHubSyncPasswordSaving] = useState(false)
  const [githubSyncError, setGitHubSyncError] = useState('')
  const [githubDeviceAuthorization, setGitHubDeviceAuthorization] =
    useState<GitHubDeviceAuthorization | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false)
  const [dividendRankingOpen, setDividendRankingOpen] = useState(false)
  const [fundamentalScreeningOpen, setFundamentalScreeningOpen] = useState(false)
  const [dailyMarketScanOpen, setDailyMarketScanOpen] = useState(false)
  const [stockTrackingOpen, setStockTrackingOpen] = useState(false)
  const [loadedDialogs, setLoadedDialogs] = useState<Set<DeferredDialogId>>(() => new Set())
  const [corporateActionCenterOpen, setCorporateActionCenterOpen] = useState(false)
  const [portfolioPerformanceOpen, setPortfolioPerformanceOpen] = useState(false)
  const [dividendFinancingSnapshot, setDividendFinancingSnapshot] =
    useState<DividendFinancingSnapshot | null>(null)
  const [dividendFinancingOverview, setDividendFinancingOverview] =
    useState<DividendFinancingOverview | null>(null)
  const [dividendFinancingChangeReport, setDividendFinancingChangeReport] =
    useState<DividendFinancingChangeReport | null>(null)
  const [fundamentalSnapshot, setFundamentalSnapshot] = useState<FundamentalSnapshot | null>(null)
  const [fundamentalOverview, setFundamentalOverview] = useState<FundamentalOverview | null>(null)
  const [fundamentalChangeReport, setFundamentalChangeReport] =
    useState<FundamentalChangeReport | null>(null)
  const [dividendFinancingState, setDividendFinancingState] =
    useState<DataSnapshotRuntimeState>(EMPTY_DATA_SNAPSHOT_STATE)
  const [fundamentalDataState, setFundamentalDataState] =
    useState<DataSnapshotRuntimeState>(EMPTY_DATA_SNAPSHOT_STATE)
  const [optionalModulesState, setOptionalModulesState] = useState<OptionalModulesState>(
    INITIAL_OPTIONAL_MODULES_STATE
  )
  const [aiAssistantContext, setAiAssistantContext] = useState<{
    quoteId: string
    quoteName?: string
  } | null>(null)
  const aiModulePresent = Boolean(AiAssistantDrawer && window.aiApi)
  const aiRuntimeAvailable = aiModulePresent && optionalModulesState.ai.status === 'ready'

  const loadDialog = useCallback((dialogId: DeferredDialogId) => {
    setLoadedDialogs((current) => {
      if (current.has(dialogId)) return current
      const next = new Set(current)
      next.add(dialogId)
      return next
    })
  }, [])

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

  const handleStockSelection = useCallback((request: StockSelectionRequest) => {
    setSelectedQuoteId(request.quoteId)
    if (request.detailTarget) {
      setDetailNavigationRequest({
        id: request.id,
        quoteId: request.quoteId,
        target: request.detailTarget,
        scrollAlignment: request.scrollAlignment
      })
    } else if (request.scrollAlignment === 'sticky-top') {
      setStockSelectionRequest(request)
    }
  }, [])

  const refreshGitHubGist = useCallback(
    async (announce = true) => {
      setGitHubGistLoading(true)
      setGitHubSyncError('')
      try {
        const [settings, password] = await Promise.all([
          stockApi.refreshGitHubGist(),
          stockApi.getGitHubSyncPassword()
        ])
        setGitHubSyncSettings(settings)
        setGitHubSyncPassword(password)
        if (announce) {
          reportSuccess(
            settings.gistId
              ? '已找到见涨用户数据 Gist'
              : 'GitHub 已连接，首次上传时会自动创建加密 Gist'
          )
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '无法读取 GitHub Gist'
        setGitHubSyncSettings(await stockApi.getGitHubSyncSettings())
        setGitHubSyncError(message)
        if (announce) reportError(`GitHub 已连接，但${message}`)
      } finally {
        setGitHubGistLoading(false)
      }
    },
    [reportError, reportSuccess]
  )

  useEffect(() => {
    getInitialBootstrap()
      .then((bootstrap) => {
        setState(bootstrap.state)
        setQuotes(bootstrap.quotes)
        setSource(bootstrap.source)
        if (bootstrap.warning) reportError(bootstrap.warning)
        setSelectedQuoteId((current) =>
          current && bootstrap.state.watchlist.some((stock) => stock.quoteId === current)
            ? current
            : null
        )
      })
      .catch((reason: unknown) =>
        reportError(reason instanceof Error ? reason.message : '应用初始化失败')
      )
      .finally(() => setInitializing(false))

    Promise.all([stockApi.getGitHubSyncSettings(), stockApi.getGitHubSyncPassword()])
      .then(([settings, password]) => {
        setGitHubSyncSettings(settings)
        setGitHubSyncPassword(password)
        if (settings.connected) {
          void refreshGitHubGist(false)
        }
      })
      .catch(() => undefined)

    const unsubscribeQuotes = stockApi.onQuotesUpdated(updateQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeSelection = stockApi.onSelectStock(handleStockSelection)
    const unsubscribeError = stockApi.onDataError(reportError)
    return () => {
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeSelection()
      unsubscribeError()
    }
  }, [handleStockSelection, refreshGitHubGist, reportError, updateQuotes])

  useEffect(() => {
    let active = true
    const unsubscribe = stockApi.onOptionalModulesStateUpdated((moduleState) => {
      if (active) setOptionalModulesState(moduleState)
    })
    stockApi
      .getOptionalModulesState()
      .then((moduleState) => {
        if (active) setOptionalModulesState(moduleState)
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    stockApi
      .getCacheSummary()
      .then(setCacheSummary)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribeDividendState = stockApi.onDividendFinancingStateUpdated((snapshotState) => {
      if (!active) return
      setDividendFinancingState(snapshotState)
    })
    const unsubscribeFundamentalState = stockApi.onFundamentalStateUpdated((snapshotState) => {
      if (!active) return
      setFundamentalDataState(snapshotState)
    })
    Promise.all([stockApi.getDividendFinancingState(), stockApi.getFundamentalState()])
      .then(([dividendState, fundamentalState]) => {
        if (!active) return
        setDividendFinancingState(dividendState)
        setFundamentalDataState(fundamentalState)
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribeDividendState()
      unsubscribeFundamentalState()
    }
  }, [])

  useEffect(() => {
    if (initializing) return
    let active = true
    const codes = state.watchlist.map((stock) => stock.code)
    Promise.all([
      stockApi.getDividendFinancingOverview(codes),
      stockApi.getFundamentalOverview(codes)
    ])
      .then(([dividendOverview, nextFundamentalOverview]) => {
        if (!active) return
        setDividendFinancingOverview(dividendOverview)
        setFundamentalOverview(nextFundamentalOverview)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [
    dividendFinancingState.generatedAt,
    dividendFinancingState.status,
    fundamentalDataState.generatedAt,
    fundamentalDataState.status,
    initializing,
    state.watchlist
  ])

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
    stockApi
      .getCompletionNotifications()
      .then((saved) => {
        setCompletionNotifications((current) => {
          if (current.length === 0) return saved
          const currentIds = new Set(current.map((item) => item.id))
          const merged = [...current, ...saved.filter((item) => !currentIds.has(item.id))]
          void stockApi.saveCompletionNotifications(merged)
          return merged
        })
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const addCompletionNotification = (event: Event) => {
      const notification = (event as CustomEvent<AppCompletionNotification>).detail
      if (!notification) return
      setCompletionNotifications((current) => {
        const next = [notification, ...current.filter((item) => item.id !== notification.id)]
        void stockApi.saveCompletionNotifications(next)
        return next
      })
    }
    window.addEventListener(APP_COMPLETION_NOTIFICATION_EVENT, addCompletionNotification)
    return () =>
      window.removeEventListener(APP_COMPLETION_NOTIFICATION_EVENT, addCompletionNotification)
  }, [])

  useEffect(() => {
    const openWithStockContext = (event: Event) => {
      if (!aiRuntimeAvailable) return
      const detail = (event as CustomEvent<{ quoteId: string; quoteName?: string }>).detail
      if (!detail?.quoteId) return
      setAiAssistantContext(detail)
      setAiAssistantOpen(true)
    }
    window.addEventListener('ai:open-assistant', openWithStockContext)
    return () => window.removeEventListener('ai:open-assistant', openWithStockContext)
  }, [aiRuntimeAvailable])

  const quoteIds = useMemo(
    () => new Set(state.watchlist.map((stock) => stock.quoteId)),
    [state.watchlist]
  )
  const dividendFinancingByCode = useMemo(
    () => new Map(dividendFinancingOverview?.rows.map((item) => [item.code, item]) ?? []),
    [dividendFinancingOverview]
  )
  const fundamentalEvaluations = useMemo(
    () =>
      fundamentalOverview?.rows.map((record) =>
        evaluateFundamentalCompany(
          record.company,
          record.industryBenchmark,
          DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
        )
      ) ?? [],
    [fundamentalOverview]
  )
  const fundamentalScreeningByCode = useMemo(() => {
    return new Map(
      fundamentalEvaluations.map((evaluation) => [evaluation.company.code, evaluation])
    )
  }, [fundamentalEvaluations])
  const fundamentalPeerComparisonsByCode = useMemo(
    () =>
      new Map(
        fundamentalOverview?.rows.flatMap((record) =>
          record.peerComparison ? [[record.company.code, record.peerComparison] as const] : []
        ) ?? []
      ),
    [fundamentalOverview]
  )
  const portfolioSummary = useMemo(
    () =>
      calculatePortfolioSummary(
        state.watchlist,
        quotes,
        state.tTradingAccounts,
        state.settings.exchangeRates
      ),
    [quotes, state.settings.exchangeRates, state.tTradingAccounts, state.watchlist]
  )
  const portfolioExposureText = useMemo(() => {
    const total = portfolioSummary.marketValue ?? 0
    if (total <= 0) return ''
    const marketLabels = { CN: 'A股', HK: '港股', US: '美股' } as const
    const marketText = (['CN', 'HK', 'US'] as const)
      .filter((market) => (portfolioSummary.marketValues[market] ?? 0) > 0)
      .map(
        (market) =>
          `${marketLabels[market]} ${(((portfolioSummary.marketValues[market] ?? 0) / total) * 100).toFixed(1)}%`
      )
      .join(' · ')
    const currencyText = (['CNY', 'HKD', 'USD'] as const)
      .filter((currency) => (portfolioSummary.currencyValues[currency] ?? 0) > 0)
      .map(
        (currency) =>
          `${currency} ${(((portfolioSummary.currencyValues[currency] ?? 0) / total) * 100).toFixed(1)}%`
      )
      .join(' · ')
    return [marketText, currencyText].filter(Boolean).join(' ｜ ')
  }, [portfolioSummary])
  const marketIndexQuotes = useMemo(() => {
    const selectedIds = new Set(state.settings.marketIndexIds)
    const quotesById = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return MARKET_INDEX_OPTIONS.filter((index) => selectedIds.has(index.id)).map((index) => ({
      index,
      quote: quotesById.get(index.quoteId)
    }))
  }, [quotes, state.settings.marketIndexIds])
  const lastUpdated = quotes.reduce<string | undefined>((latest, quote) => {
    const quoteDataAt = quote.dataAt ?? quote.updatedAt
    if (!latest || quoteDataAt > latest) return quoteDataAt
    return latest
  }, undefined)

  const persist = useCallback(
    async (nextState: AppState, refreshDemoQuotes = true) => {
      setState(nextState)
      try {
        const saved = await stockApi.saveState(nextState)
        setState(saved)
        if (!isDesktopRuntime && refreshDemoQuotes) updateQuotes(await stockApi.refreshQuotes())
        return saved
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : '设置保存失败')
        if (isDesktopRuntime) {
          void stockApi.getBootstrap().then((bootstrap) => setState(bootstrap.state))
        }
        return null
      }
    },
    [reportError, updateQuotes]
  )

  const addStock = useCallback(
    (result: SearchResult, options: StockAddOptions = {}) => {
      const existing = state.watchlist.find((stock) => stock.quoteId === result.quoteId)
      if (existing && !options.startTracking && !options.targetGroups?.length) {
        setSelectedQuoteId(existing.quoteId)
        return
      }
      const targetGroups = options.targetGroups ?? []
      const knownGroupIds = new Set(state.watchlistGroups.map((group) => group.id))
      const nextGroups = [
        ...state.watchlistGroups,
        ...targetGroups.filter((group) => !knownGroupIds.has(group.id))
      ]
      const groupIds = new Set(existing?.groupIds ?? [])
      targetGroups.forEach((group) => groupIds.add(group.id))
      const knownQuote = quotes.find((quote) => quote.quoteId === result.quoteId)
      const addedAt = new Date().toISOString()
      const nextStock = existing
        ? { ...existing, groupIds: [...groupIds] }
        : {
            ...result,
            showInTaskbar: false,
            isPriority: false,
            showRadarSignals: true,
            groupIds: [...groupIds],
            addedAt,
            addedPrice:
              knownQuote?.latest !== null && knownQuote?.latest !== undefined
                ? knownQuote.latest
                : undefined
          }
      const nextTrackingProfiles = { ...state.stockTrackingProfiles }
      if (options.startTracking && options.source) {
        nextTrackingProfiles[result.quoteId] = startStockTracking(
          nextTrackingProfiles[result.quoteId],
          nextStock,
          options.source,
          quotes.find((quote) => quote.quoteId === result.quoteId)
        )
      }
      const nextState = {
        ...state,
        watchlistGroups: nextGroups,
        watchlist: existing
          ? state.watchlist.map((stock) => (stock.quoteId === result.quoteId ? nextStock : stock))
          : [...state.watchlist, nextStock],
        stockTrackingProfiles: nextTrackingProfiles
      }
      setSelectedQuoteId(result.quoteId)
      void persist(nextState, false)
        .then(async (saved) => {
          if (!saved || existing) return
          const incoming = await stockApi.refreshQuote(result.quoteId)
          updateQuotes(incoming)
          const refreshedQuote = incoming.find((quote) => quote.quoteId === result.quoteId)
          const refreshedPrice = refreshedQuote?.latest
          const profile = saved.stockTrackingProfiles[result.quoteId]
          if (refreshedPrice === null || refreshedPrice === undefined) return
          const savedStock = saved.watchlist.find((stock) => stock.quoteId === result.quoteId)
          const shouldSaveAddedPrice = Boolean(savedStock && !savedStock.addedPrice)
          const shouldSaveTrackingPrice = Boolean(options.source && profile)
          if (!shouldSaveAddedPrice && !shouldSaveTrackingPrice) return
          const sources = profile?.sources.map((source) =>
            source.id === options.source?.id && !source.detail?.startPrice
              ? { ...source, detail: { ...source.detail, startPrice: refreshedPrice } }
              : source
          )
          const nextSaved = {
            ...saved,
            watchlist: shouldSaveAddedPrice
              ? saved.watchlist.map((stock) =>
                  stock.quoteId === result.quoteId
                    ? { ...stock, addedPrice: refreshedPrice }
                    : stock
                )
              : saved.watchlist,
            stockTrackingProfiles:
              profile && sources
                ? {
                    ...saved.stockTrackingProfiles,
                    [result.quoteId]: { ...profile, sources }
                  }
                : saved.stockTrackingProfiles
          }
          await persist(nextSaved, false)
        })
        .catch((reason: unknown) => {
          reportError(reason instanceof Error ? reason.message : '新股票行情获取失败')
        })
    },
    [persist, quotes, reportError, state, updateQuotes]
  )

  const addDailyMarketScanStock = useCallback(
    (result: SearchResult, row: DailyMarketScanRow) => {
      const dailyScanGroup = getDailyScanWatchlistGroup(state.watchlistGroups)
      const trackingGroup = getTrackingWatchlistGroup(state.watchlistGroups)
      addStock(result, {
        startTracking: true,
        targetGroups: [dailyScanGroup, trackingGroup],
        source: createStockTrackingSource('dailyScan', {
          tradingDate: row.tradingDate,
          signals: row.signals,
          startPrice: row.latest,
          changePercent: row.changePercent,
          volumeRatio: row.volumeRatio
        })
      })
    },
    [addStock, state.watchlistGroups]
  )

  const addDividendFinancingStock = useCallback(
    (
      result: SearchResult,
      item: DividendFinancingRankingItem,
      snapshotDate: string | undefined
    ) => {
      addStock(result, {
        startTracking: true,
        targetGroups: [getTrackingWatchlistGroup(state.watchlistGroups)],
        source: createStockTrackingSource('dividendFinancing', {
          snapshotDate,
          dividendRatio: item.ratio,
          dividendRank: item.rank
        })
      })
    },
    [addStock, state.watchlistGroups]
  )

  const addFundamentalScreeningStock = useCallback(
    (
      result: SearchResult,
      evaluation: FundamentalScreeningEvaluation,
      snapshotDate: string | undefined
    ) => {
      const { company } = evaluation
      addStock(result, {
        startTracking: true,
        targetGroups: [getTrackingWatchlistGroup(state.watchlistGroups)],
        source: createStockTrackingSource('fundamentalScreening', {
          snapshotDate,
          industryName: company.industryName,
          tags: [
            `持续高ROE${evaluation.checks.roe ? '通过' : '未通过'}`,
            `现金利润质量${evaluation.checks.cash ? '通过' : '未通过'}`,
            evaluation.eligibleOrganization
              ? `行业杠杆水平${evaluation.checks.debt ? '通过' : '未通过'}`
              : '行业杠杆水平不适用'
          ]
        })
      })
    },
    [addStock, state.watchlistGroups]
  )

  const saveTrackingProfile = useCallback(
    (profile: StockTrackingProfile) => {
      const trackingGroup = getTrackingWatchlistGroup(state.watchlistGroups)
      const nextGroups = state.watchlistGroups.some((group) => group.id === trackingGroup.id)
        ? state.watchlistGroups
        : [...state.watchlistGroups, trackingGroup]
      const nextWatchlist = state.watchlist.map((stock) => {
        if (stock.quoteId !== profile.quoteId) return stock
        const groupIds = new Set(stock.groupIds ?? [])
        if (profile.status === 'tracking') groupIds.add(trackingGroup.id)
        else groupIds.delete(trackingGroup.id)
        return { ...stock, groupIds: [...groupIds] }
      })
      void persist({
        ...state,
        watchlist: nextWatchlist,
        watchlistGroups: nextGroups,
        stockTrackingProfiles: {
          ...state.stockTrackingProfiles,
          [profile.quoteId]: profile
        }
      })
    },
    [persist, state]
  )

  const startManualTracking = useCallback(
    (quoteId: string) => {
      const stock = state.watchlist.find((item) => item.quoteId === quoteId)
      if (!stock) return
      const nextProfile = startStockTracking(
        state.stockTrackingProfiles[quoteId],
        stock,
        createStockTrackingSource('manual', {
          startPrice: quotes.find((quote) => quote.quoteId === quoteId)?.latest ?? undefined
        }),
        quotes.find((quote) => quote.quoteId === quoteId)
      )
      saveTrackingProfile(nextProfile)
    },
    [quotes, saveTrackingProfile, state.stockTrackingProfiles, state.watchlist]
  )

  const stopTracking = useCallback(
    (quoteId: string, result: StockTrackingConclusionResult, summary: string) => {
      const profile = state.stockTrackingProfiles[quoteId]
      if (!profile) return
      saveTrackingProfile(
        stopStockTracking(
          profile,
          result,
          summary,
          quotes.find((quote) => quote.quoteId === quoteId)
        )
      )
    },
    [quotes, saveTrackingProfile, state.stockTrackingProfiles]
  )

  const restartTracking = useCallback(
    (quoteId: string) => {
      startManualTracking(quoteId)
    },
    [startManualTracking]
  )

  const removeStock = useCallback(
    (quoteId: string) => {
      const nextWatchlist = state.watchlist.filter((stock) => stock.quoteId !== quoteId)
      setSelectedQuoteId((current) => (current === quoteId ? null : current))
      setQuotes((current) => current.filter((quote) => quote.quoteId !== quoteId))
      void persist({
        ...state,
        watchlist: nextWatchlist,
        portfolioPerformanceAdjustments: Object.fromEntries(
          Object.entries(state.portfolioPerformanceAdjustments ?? {}).filter(
            ([adjustedQuoteId]) => adjustedQuoteId !== quoteId
          )
        )
      })
    },
    [persist, state]
  )

  const removeTrackedStock = useCallback(
    async (quoteId: string) => {
      const stock = state.watchlist.find((item) => item.quoteId === quoteId)
      const profile = state.stockTrackingProfiles[quoteId]
      if (!stock || !profile) return
      const confirmed = await confirm({
        title: '删除股票并停止追踪',
        message: `将从股票列表中删除“${stock.name}（${stock.code}）”，并停止追踪。历史档案和复盘记录仍会保留。`,
        confirmLabel: '删除并停止',
        tone: 'danger'
      })
      if (!confirmed) return
      const nextProfile =
        profile.status === 'tracking'
          ? stopStockTracking(
              profile,
              'unverified',
              '从股票列表中删除时停止追踪',
              quotes.find((quote) => quote.quoteId === quoteId)
            )
          : profile
      setSelectedQuoteId((current) => (current === quoteId ? null : current))
      setQuotes((current) => current.filter((quote) => quote.quoteId !== quoteId))
      void persist({
        ...state,
        watchlist: state.watchlist.filter((item) => item.quoteId !== quoteId),
        portfolioPerformanceAdjustments: Object.fromEntries(
          Object.entries(state.portfolioPerformanceAdjustments ?? {}).filter(
            ([adjustedQuoteId]) => adjustedQuoteId !== quoteId
          )
        ),
        stockTrackingProfiles: {
          ...state.stockTrackingProfiles,
          [quoteId]: nextProfile
        }
      })
    },
    [confirm, persist, quotes, state]
  )

  const savePortfolioPerformanceAdjustments = useCallback(
    async (adjustments: PortfolioPerformanceAdjustments) =>
      Boolean(
        await persist(
          {
            ...state,
            portfolioPerformanceAdjustments: adjustments
          },
          false
        )
      ),
    [persist, state]
  )

  const toggleTaskbar = useCallback(
    (quoteId: string) => {
      const nextWatchlist = state.watchlist.map((stock) =>
        stock.quoteId === quoteId ? { ...stock, showInTaskbar: !stock.showInTaskbar } : stock
      )
      void persist({ ...state, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const togglePriority = useCallback(
    (quoteId: string) => {
      const nextWatchlist = state.watchlist.map((stock) =>
        stock.quoteId === quoteId && !stock.position
          ? { ...stock, isPriority: !stock.isPriority }
          : stock
      )
      void persist({ ...state, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const updatePosition = useCallback(
    (
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
    },
    [persist, state]
  )

  const updateTTrading = useCallback(
    (quoteId: string, account: TTradingAccount, position: StockPosition | undefined) => {
      const nextWatchlist = state.watchlist.map((stock) =>
        stock.quoteId === quoteId
          ? { ...stock, position, isPriority: position ? true : stock.isPriority }
          : stock
      )
      void persist({
        ...state,
        watchlist: nextWatchlist,
        tTradingAccounts: {
          ...state.tTradingAccounts,
          [quoteId]: account
        }
      })
    },
    [persist, state]
  )

  const applyCorporateAction = useCallback(
    (
      quoteId: string,
      account: TTradingAccount,
      position: StockPosition | undefined,
      record: CorporateActionRecord
    ) => {
      const conversion = account.ledger.entries.find(
        (entry) =>
          entry.kind === 'securityConversion' &&
          entry.corporateActionId === record.id &&
          entry.targetQuoteId
      )
      const targetQuoteId =
        conversion?.kind === 'securityConversion'
          ? record.status === 'reversed'
            ? conversion.sourceQuoteId
            : conversion.targetQuoteId
          : undefined
      const finalQuoteId = targetQuoteId && targetQuoteId !== quoteId ? targetQuoteId : quoteId
      if (
        finalQuoteId !== quoteId &&
        (state.tTradingAccounts[finalQuoteId] ||
          state.watchlist.some((stock) => stock.quoteId === finalQuoteId))
      ) {
        return `目标证券 ${finalQuoteId} 已存在，为避免覆盖账户或自选数据，本次未入账。请先处理目标证券后重试。`
      }
      const finalCode = finalQuoteId.includes('.')
        ? finalQuoteId.split('.').slice(1).join('.') || account.code
        : account.code
      const normalizedAccount =
        finalQuoteId === quoteId
          ? account
          : {
              ...account,
              quoteId: finalQuoteId,
              code: finalCode,
              ledger: {
                ...account.ledger,
                entries: account.ledger.entries.map((entry) => ({
                  ...entry,
                  accountId: finalQuoteId,
                  quoteId: finalQuoteId
                }))
              }
            }
      const { [quoteId]: _previousAccount, ...otherAccounts } = state.tTradingAccounts
      const migratedRecords = Object.fromEntries(
        Object.entries(state.corporateActionRecords).map(([id, saved]) => [
          id,
          saved.quoteId === quoteId ? { ...saved, quoteId: finalQuoteId } : saved
        ])
      )
      const trackingProfile = state.stockTrackingProfiles[quoteId]
      const { [quoteId]: _previousTracking, ...otherTrackingProfiles } = state.stockTrackingProfiles
      void persist({
        ...state,
        watchlist: state.watchlist.map((stock) =>
          stock.quoteId === quoteId
            ? {
                ...stock,
                quoteId: finalQuoteId,
                code: finalCode,
                position,
                isPriority: position ? true : stock.isPriority
              }
            : stock
        ),
        tTradingAccounts: { ...otherAccounts, [finalQuoteId]: normalizedAccount },
        stockTrackingProfiles:
          finalQuoteId !== quoteId && trackingProfile
            ? {
                ...otherTrackingProfiles,
                [finalQuoteId]: { ...trackingProfile, quoteId: finalQuoteId, code: finalCode }
              }
            : state.stockTrackingProfiles,
        corporateActionRecords: {
          ...migratedRecords,
          [record.id]: { ...record, quoteId: finalQuoteId }
        }
      })
      if (finalQuoteId !== quoteId) setSelectedQuoteId(finalQuoteId)
    },
    [persist, state]
  )

  const updateCorporateActionRecord = useCallback(
    (record: CorporateActionRecord) => {
      void persist({
        ...state,
        corporateActionRecords: { ...state.corporateActionRecords, [record.id]: record }
      })
    },
    [persist, state]
  )

  const viewCorporateActionStock = useCallback((quoteId: string) => {
    setCorporateActionCenterOpen(false)
    setSelectedQuoteId(quoteId)
    setDetailNavigationRequest({
      id: `corporate-action:${quoteId}:${Date.now()}`,
      quoteId,
      target: 'corporate-actions',
      scrollAlignment: 'sticky-top'
    })
  }, [])

  const updateStockAlerts = useCallback(
    (quoteId: string, alertRules: StockAlertRule[]) => {
      const nextWatchlist = state.watchlist.map((stock) =>
        stock.quoteId === quoteId ? { ...stock, alertRules } : stock
      )
      void persist({ ...state, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const reorderWatchlist = useCallback(
    (sourceQuoteId: string, targetQuoteId: string) => {
      const sourceIndex = state.watchlist.findIndex((stock) => stock.quoteId === sourceQuoteId)
      const targetIndex = state.watchlist.findIndex((stock) => stock.quoteId === targetQuoteId)
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return
      const nextWatchlist = [...state.watchlist]
      const [movedStock] = nextWatchlist.splice(sourceIndex, 1)
      nextWatchlist.splice(targetIndex, 0, movedStock)
      void persist({ ...state, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const pinStock = useCallback(
    (quoteId: string) => {
      const currentIndex = state.watchlist.findIndex((stock) => stock.quoteId === quoteId)
      if (currentIndex <= 0) return
      const nextWatchlist = [...state.watchlist]
      const [pinnedStock] = nextWatchlist.splice(currentIndex, 1)
      nextWatchlist.unshift(pinnedStock)
      void persist({ ...state, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const updateColumnOrder = useCallback(
    (columnOrder: WatchlistColumnId[]) => {
      void persist({ ...state, columnOrder })
    },
    [persist, state]
  )

  const updateWatchlistGroups = useCallback(
    (watchlistGroups: WatchlistGroup[], groupIdsByQuoteId: Record<string, string[]>) => {
      const nextWatchlist = state.watchlist.map((stock) => ({
        ...stock,
        groupIds: groupIdsByQuoteId[stock.quoteId] ?? stock.groupIds ?? []
      }))
      void persist({ ...state, watchlistGroups, watchlist: nextWatchlist })
    },
    [persist, state]
  )

  const updateSettings = useCallback(
    (settings: AppSettings) => {
      void persist({ ...state, settings })
    },
    [persist, state]
  )

  const refreshCacheSummary = useCallback(() => {
    if (!isDesktopRuntime || cacheBusy) return
    setCacheBusy(true)
    stockApi
      .getCacheSummary()
      .then(setCacheSummary)
      .catch((reason) => reportError(reason instanceof Error ? reason.message : '缓存统计读取失败'))
      .finally(() => setCacheBusy(false))
  }, [cacheBusy, reportError])

  const clearCaches = useCallback(
    async (categoryIds: CacheCategoryId[]) => {
      if (!isDesktopRuntime || categoryIds.length === 0 || cacheBusy) return
      setCacheBusy(true)
      try {
        const categories = categoryIds
          .map((id) => cacheSummary?.categories.find((category) => category.id === id))
          .filter((category): category is NonNullable<typeof category> => Boolean(category))
        const includesSnapshots = categories.some((category) => category.group === 'separate')
        const categoryLabels = categories.map((category) => category.label).join('、')
        const confirmed = await confirm({
          title: includesSnapshots ? '清理数据并重启' : '清理缓存并重启',
          message: includesSnapshots
            ? `将删除 ${categoryLabels || '选中的运行数据'}。相关数据需要重新运行更新或联网获取；不会删除自选、持仓、设置、AI 对话、API Key 和 GitHub 同步凭证。应用会自动重启。`
            : `将删除 ${categoryLabels || '选中的临时缓存'}。相关页面下次打开时会重新获取；不会删除用户配置、AI 数据或同步凭证。应用会自动重启。`,
          confirmLabel: includesSnapshots ? '清理并重启' : '清理并重启',
          tone: includesSnapshots ? 'danger' : 'default'
        })
        if (!confirmed) return
        const result: CacheClearResult = await stockApi.clearCaches(categoryIds)
        const sizeInMegabytes = (result.clearedBytes / (1024 * 1024)).toFixed(1)
        const failureMessage = result.failedPaths.length
          ? `，${result.failedPaths.length} 项未能删除`
          : ''
        reportSuccess(
          `已清理 ${result.clearedFileCount} 个文件，释放 ${sizeInMegabytes} MB${failureMessage}，应用正在重启`
        )
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : '缓存清理失败')
      } finally {
        setCacheBusy(false)
      }
    },
    [cacheBusy, cacheSummary, confirm, reportError, reportSuccess]
  )

  const selectWatchlistStock = useCallback((quoteId: string) => {
    setSelectedQuoteId((current) => (current === quoteId ? null : quoteId))
  }, [])

  const openCompletionNotification = useCallback((notification: AppCompletionNotification) => {
    setCompletionNotifications((current) => {
      const next = current.filter((item) => item.id !== notification.id)
      void stockApi.saveCompletionNotifications(next)
      return next
    })
    setSelectedQuoteId(notification.quoteId)
    setDetailNavigationRequest({
      id: notification.id,
      quoteId: notification.quoteId,
      target: notification.target,
      scrollAlignment: 'sticky-top'
    })
  }, [])

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

  const viewWatchlistStockFromTracking = useCallback((quoteId: string) => {
    setSelectedQuoteId(quoteId)
    setStockSelectionRequest({
      id: `stock-tracking:${quoteId}:${Date.now()}`,
      quoteId,
      scrollAlignment: 'sticky-top'
    })
  }, [])

  const updateChipDistributionEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({
        ...state.settings,
        showChipDistribution: enabled
      })
    },
    [state.settings, updateSettings]
  )

  const updateBollingerBandsEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({
        ...state.settings,
        showBollingerBands: enabled
      })
    },
    [state.settings, updateSettings]
  )

  const exportConfig = useCallback(async () => {
    setConfigBusy(true)
    try {
      const result = await stockApi.exportConfig(state)
      if (!result.canceled) {
        const apiKeyMessage = result.apiKeyCount
          ? `，包含 ${result.apiKeyCount} 个明文 AI API Key，请妥善保管`
          : ''
        reportSuccess(`用户数据已导出${apiKeyMessage}`)
      }
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '用户数据导出失败')
    } finally {
      setConfigBusy(false)
    }
  }, [reportError, reportSuccess, state])

  const applyImportedData = useCallback(
    async (result: ConfigImportResult): Promise<boolean> => {
      if (result.canceled || !result.state) return false
      const backupSummary = result.backupSummary
      const apiKeyMessage = backupSummary
        ? backupSummary.apiKeyCount > 0
          ? `同时会恢复 ${backupSummary.apiKeyCount} 个 AI API Key。`
          : '备份中没有 AI API Key，当前已配置的 API Key 将被清除。'
        : ''
      const confirmed = await confirm({
        title: result.importId ? '导入用户数据并重启' : '导入并覆盖当前配置',
        message: result.importId
          ? `导入后将用备份中的 ${result.state.watchlist.length} 只股票、全部设置及 ${backupSummary?.fileCount ?? 0} 个持久化数据文件覆盖当前用户数据。${apiKeyMessage}应用将自动重启。`
          : `导入后将用文件中的 ${result.state.watchlist.length} 只股票和全部设置覆盖当前配置。`,
        confirmLabel: result.importId ? '导入并重启' : '继续导入',
        tone: 'danger'
      })
      if (!confirmed) return false

      const importedQuoteIds = new Set(result.state.watchlist.map((stock) => stock.quoteId))
      setSelectedQuoteId(null)
      setQuotes((current) => current.filter((quote) => importedQuoteIds.has(quote.quoteId)))
      if (result.importId) {
        await stockApi.applyConfigImport(result.importId)
        reportSuccess('用户数据导入完成，应用正在重启')
      } else {
        const saved = await persist(result.state)
        if (!saved) return false
        reportSuccess(`已导入 ${saved.watchlist.length} 只股票及全部设置`)
      }
      return true
    },
    [confirm, persist, reportSuccess]
  )

  const importConfig = useCallback(async () => {
    setConfigBusy(true)
    try {
      await applyImportedData(await stockApi.importConfig())
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '用户数据导入失败')
    } finally {
      setConfigBusy(false)
    }
  }, [applyImportedData, reportError])

  const connectGitHub = useCallback(async () => {
    setGitHubSyncBusy(true)
    setGitHubSyncError('')
    try {
      const authorization = await stockApi.startGitHubLogin()
      setGitHubDeviceAuthorization(authorization)
      reportSuccess(`GitHub 授权网页已打开，验证码 ${authorization.userCode} 已复制`)
      const result = await stockApi.completeGitHubLogin(authorization.loginId)
      setGitHubSyncSettings(result.settings)
      setGitHubDeviceAuthorization(null)
      reportSuccess('GitHub Gist 授权已保存，正在自动查找用户数据 Gist')
      await refreshGitHubGist()
    } catch (reason) {
      setGitHubDeviceAuthorization(null)
      const message = reason instanceof Error ? reason.message : 'GitHub 网页授权失败'
      setGitHubSyncError(message)
      reportError(message)
    } finally {
      setGitHubSyncBusy(false)
    }
  }, [refreshGitHubGist, reportError, reportSuccess])

  const disconnectGitHub = useCallback(async () => {
    setGitHubSyncBusy(true)
    try {
      setGitHubSyncSettings(await stockApi.disconnectGitHub())
      setGitHubSyncError('')
      setGitHubDeviceAuthorization(null)
      reportSuccess('已断开 GitHub 连接')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '断开 GitHub 失败'
      setGitHubSyncError(message)
      reportError(message)
    } finally {
      setGitHubSyncBusy(false)
    }
  }, [reportError, reportSuccess])

  const generateGitHubSyncPassword = useCallback(async () => {
    try {
      return await stockApi.generateGitHubSyncPassword()
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '安全密钥生成失败')
      return ''
    }
  }, [reportError])

  const saveGitHubSyncPassword = useCallback(
    async (password: string): Promise<boolean> => {
      setGitHubSyncBusy(true)
      setGitHubSyncPasswordSaving(true)
      try {
        setGitHubSyncSettings(await stockApi.saveGitHubSyncPassword(password))
        setGitHubSyncPassword(password.trim())
        setGitHubSyncError('')
        reportSuccess('GitHub Gist 同步密码已保存到本机')
        return true
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '同步密码保存失败'
        setGitHubSyncError(message)
        reportError(message)
        return false
      } finally {
        setGitHubSyncPasswordSaving(false)
        setGitHubSyncBusy(false)
      }
    },
    [reportError, reportSuccess]
  )

  const uploadUserDataToGitHub = useCallback(async () => {
    setGitHubSyncBusy(true)
    setGitHubSyncUploading(true)
    try {
      if (!githubSyncSettings.syncPasswordReady) throw new Error('请先设置并保存 Gist 同步密码')
      const latestSettings = await stockApi.refreshGitHubGist()
      setGitHubSyncSettings(latestSettings)
      const localUpdatedAt = latestSettings.localDataUpdatedAt
        ? Date.parse(latestSettings.localDataUpdatedAt)
        : Number.NaN
      const remoteUpdatedAt = latestSettings.remoteDataUpdatedAt
        ? Date.parse(latestSettings.remoteDataUpdatedAt)
        : Number.NaN
      const versionWarning = latestSettings.requiresRemoteRestore
        ? Number.isFinite(localUpdatedAt) && Number.isFinite(remoteUpdatedAt)
          ? localUpdatedAt < remoteUpdatedAt
            ? '本机数据更新时间早于远程备份，远程可能包含其他设备的新数据。'
            : localUpdatedAt > remoteUpdatedAt
              ? '本机数据更新时间晚于远程备份，但远程版本与本机上次同步记录不一致。'
              : '本机与远程显示相同的更新时间，但远程版本已经变化。'
          : '远程备份版本与本机上次同步记录不一致。'
        : ''
      const confirmed = await confirm({
        title: '上传用户数据到 GitHub Gist',
        message: latestSettings.gistId
          ? `${versionWarning}将使用本机同步密码加密全部用户数据并覆盖当前 Secret Gist，包括已配置的 AI API Key。`
          : '将使用本机同步密码加密全部用户数据，并自动创建一个 Secret Gist，包括已配置的 AI API Key。',
        confirmLabel: latestSettings.requiresRemoteRestore ? '仍然上传并覆盖' : '确认上传',
        tone: 'danger'
      })
      if (!confirmed) return
      const result = await stockApi.uploadUserDataToGitHub(
        state,
        latestSettings.requiresRemoteRestore
      )
      setGitHubSyncSettings(await stockApi.getGitHubSyncSettings())
      reportSuccess(`用户数据已加密上传到 GitHub Gist，版本 ${result.version.slice(0, 7)}`)
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : 'GitHub 上传失败')
    } finally {
      setGitHubSyncUploading(false)
      setGitHubSyncBusy(false)
    }
  }, [confirm, githubSyncSettings.syncPasswordReady, reportError, reportSuccess, state])

  const downloadUserDataFromGitHub = useCallback(async () => {
    setGitHubSyncBusy(true)
    setGitHubSyncDownloading(true)
    try {
      const result = await stockApi.downloadUserDataFromGitHub()
      setGitHubSyncSettings(await stockApi.getGitHubSyncSettings())
      const applied = await applyImportedData(result)
      if (applied && result.githubGistVersion) {
        setGitHubSyncSettings(await stockApi.confirmGitHubGistRestore(result.githubGistVersion))
      }
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : 'GitHub 下载失败')
    } finally {
      setGitHubSyncDownloading(false)
      setGitHubSyncBusy(false)
    }
  }, [applyImportedData, reportError])

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

  const recalculatePortfolioPerformanceStock = useCallback(
    async (quoteId: string) => {
      updateQuotes(await stockApi.refreshQuote(quoteId))
    },
    [updateQuotes]
  )

  const refreshTradingCalendar = async () => {
    setCalendarRefreshing(true)
    try {
      const tradingCalendar = await stockApi.refreshTradingCalendar()
      setState((current) => ({
        ...current,
        settings: { ...current.settings, tradingCalendar }
      }))
      const failedMarkets = (['CN', 'HK', 'US'] as const).filter(
        (market) => tradingCalendar.markets[market].lastError
      )
      if (failedMarkets.length > 0) {
        reportError(`交易日历部分更新失败：${failedMarkets.join('、')}`)
      } else {
        reportSuccess('A股、港股和美股交易日历已更新')
      }
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '交易日历刷新失败')
    } finally {
      setCalendarRefreshing(false)
    }
  }

  const refreshExchangeRates = async () => {
    setExchangeRatesRefreshing(true)
    try {
      const exchangeRates = await stockApi.refreshExchangeRates()
      setState((current) => ({
        ...current,
        settings: { ...current.settings, exchangeRates }
      }))
      reportSuccess(`人民币汇率中间价已更新至 ${exchangeRates.rateDate ?? '最新公布日'}`)
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '官方汇率刷新失败')
    } finally {
      setExchangeRatesRefreshing(false)
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
            <TitlebarToolsMenu
              onOpenDividendRanking={() => {
                loadDialog('dividend-ranking')
                setDividendRankingOpen(true)
              }}
              onOpenFundamentalScreening={() => {
                loadDialog('fundamental-screening')
                setFundamentalScreeningOpen(true)
              }}
              onOpenDailyMarketScan={() => {
                loadDialog('daily-scan')
                setDailyMarketScanOpen(true)
              }}
              onOpenStockTracking={() => {
                loadDialog('tracking')
                setStockTrackingOpen(true)
              }}
              onOpenCorporateActionCenter={() => setCorporateActionCenterOpen(true)}
              onOpenPortfolioPerformance={() => setPortfolioPerformanceOpen(true)}
            />
            {aiModulePresent ? (
              <button
                className="secondary-button ai-assistant-trigger"
                type="button"
                disabled={!aiRuntimeAvailable}
                onClick={() => {
                  setAiAssistantContext(null)
                  setAiAssistantOpen(true)
                }}
                title={
                  optionalModulesState.ai.status === 'initializing'
                    ? 'AI 模块正在初始化'
                    : optionalModulesState.ai.status === 'failed'
                      ? (optionalModulesState.ai.error ?? 'AI 模块初始化失败')
                      : 'AI 助手'
                }
              >
                <Bot size={17} />
                <span>
                  {optionalModulesState.ai.status === 'initializing'
                    ? 'AI 初始化中'
                    : optionalModulesState.ai.status === 'failed'
                      ? 'AI 不可用'
                      : 'AI 助手'}
                </span>
              </button>
            ) : null}
            <SettingsMenu
              settings={state.settings}
              onChange={updateSettings}
              onImportConfig={importConfig}
              onExportConfig={exportConfig}
              configBusy={configBusy}
              githubSyncSettings={githubSyncSettings}
              githubSyncPassword={githubSyncPassword}
              githubGistLoading={githubGistLoading}
              githubSyncPasswordSaving={githubSyncPasswordSaving}
              githubSyncError={githubSyncError}
              githubDeviceAuthorization={githubDeviceAuthorization}
              githubSyncBusy={githubSyncBusy}
              githubSyncUploading={githubSyncUploading}
              githubSyncDownloading={githubSyncDownloading}
              onConnectGitHub={connectGitHub}
              onDisconnectGitHub={disconnectGitHub}
              onGenerateGitHubSyncPassword={generateGitHubSyncPassword}
              onSaveGitHubSyncPassword={saveGitHubSyncPassword}
              onUploadUserDataToGitHub={uploadUserDataToGitHub}
              onDownloadUserDataFromGitHub={downloadUserDataFromGitHub}
              onRefreshTradingCalendar={refreshTradingCalendar}
              calendarRefreshing={calendarRefreshing}
              onRefreshExchangeRates={refreshExchangeRates}
              exchangeRatesRefreshing={exchangeRatesRefreshing}
              fundamentalDataState={fundamentalDataState}
              onUpdateFundamentalData={updateFundamentalData}
              cacheSummary={cacheSummary}
              cacheBusy={cacheBusy}
              onRefreshCacheSummary={refreshCacheSummary}
              onClearCaches={clearCaches}
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
                      重点 {state.settings.priorityRefreshSeconds} 秒 · 其余{' '}
                      {state.settings.regularRefreshSeconds} 秒刷新
                    </div>
                  </div>
                  <span>
                    {state.watchlist.length} 只股票 ·{' '}
                    {state.watchlist.filter((stock) => stock.isPriority).length} 只重点 ·{' '}
                    {portfolioSummary.positionCount} 只有持仓 · 点击股票行展开行情详情
                  </span>
                </div>
                <div id="portfolio-quality-slot" className="portfolio-quality-slot" />
                {marketIndexQuotes.length > 0 ? (
                  <div
                    className="market-index-summary panel-market-index-summary"
                    aria-label="大盘指数行情"
                  >
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
                  <span className={cardDirectionClass(portfolioSummary.todayProfit)}>
                    <small>今日总收益</small>
                    <strong
                      className={
                        portfolioSummary.todayProfit === null
                          ? 'is-flat'
                          : portfolioSummary.todayProfit >= 0
                            ? 'is-up'
                            : 'is-down'
                      }
                    >
                      {formatMoneyProfit(portfolioSummary.todayProfit, 'CNY')}
                    </strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.todayProfitPercent)}>
                    <small>今日收益率</small>
                    <strong
                      className={
                        portfolioSummary.todayProfitPercent === null
                          ? 'is-flat'
                          : portfolioSummary.todayProfitPercent >= 0
                            ? 'is-up'
                            : 'is-down'
                      }
                    >
                      {formatPercent(portfolioSummary.todayProfitPercent)}
                    </strong>
                  </span>
                  <span className={cardDirectionClass(portfolioSummary.profitPercent)}>
                    <small>总收益率</small>
                    <strong
                      className={
                        portfolioSummary.profitPercent === null
                          ? 'is-flat'
                          : portfolioSummary.profitPercent >= 0
                            ? 'is-up'
                            : 'is-down'
                      }
                    >
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
                dividendFinancingSnapshotDate={dividendFinancingOverview?.snapshotDate}
                dividendFinancingStaleReason={
                  dividendFinancingState.status === 'stale'
                    ? dividendFinancingState.staleReason
                    : null
                }
                fundamentalScreeningByCode={fundamentalScreeningByCode}
                fundamentalPeerComparisonsByCode={fundamentalPeerComparisonsByCode}
                fundamentalSnapshotDate={fundamentalOverview?.snapshotDate}
                fundamentalGeneratedAt={fundamentalOverview?.generatedAt}
                fundamentalStaleReason={
                  fundamentalDataState.status === 'stale' ? fundamentalDataState.staleReason : null
                }
                columnOrder={state.columnOrder}
                priorityRefreshSeconds={state.settings.priorityRefreshSeconds}
                regularRefreshSeconds={state.settings.regularRefreshSeconds}
                chipDistributionEnabled={state.settings.showChipDistribution}
                bollingerBandsEnabled={state.settings.showBollingerBands}
                selectedQuoteId={selectedQuoteId}
                stockSelectionRequest={stockSelectionRequest}
                detailNavigationRequest={detailNavigationRequest}
                tTradingAccounts={state.tTradingAccounts}
                corporateActionRecords={state.corporateActionRecords}
                tTradingFees={state.settings.tTradingFees}
                marketTradeFees={state.settings.marketTradeFees}
                tPlanDefaults={state.settings.tPlanDefaults}
                tFloatingProfitAlertDefaultThreshold={
                  state.settings.tFloatingProfitAlertDefaultThreshold
                }
                portfolioSummary={portfolioSummary}
                portfolioExposureText={portfolioExposureText}
                tradingCalendar={state.settings.tradingCalendar}
                exchangeRates={state.settings.exchangeRates}
                onSelect={selectWatchlistStock}
                onDetailNavigationHandled={handleDetailNavigationHandled}
                onToggleTaskbar={toggleTaskbar}
                onTogglePriority={togglePriority}
                onEditPosition={updatePosition}
                onUpdateTTrading={updateTTrading}
                onApplyCorporateAction={applyCorporateAction}
                onUpdateCorporateActionRecord={updateCorporateActionRecord}
                onUpdateStockAlerts={updateStockAlerts}
                stockTrackingProfiles={state.stockTrackingProfiles}
                onStartTracking={startManualTracking}
                onUpdateTracking={saveTrackingProfile}
                onStopTracking={stopTracking}
                onRestartTracking={restartTracking}
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
        <MarketTradingState tradingCalendar={state.settings.tradingCalendar} />
        <span className="status-separator" />
        <span>
          {error ? '行情连接异常，保留最近数据' : `最近更新 ${formatUpdateTime(lastUpdated)}`}
        </span>
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

      {error ? (
        <div className="error-toast">
          <WifiOff size={17} />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="success-toast">
          <CircleCheck size={17} />
          {notice}
        </div>
      ) : null}
      {loadedDialogs.has('dividend-ranking') ? (
        <Suspense fallback={null}>
          <DividendFinancingRankingDialog
            open={dividendRankingOpen}
            cachedSnapshot={dividendFinancingSnapshot}
            cachedChangeReport={dividendFinancingChangeReport}
            dataState={dividendFinancingState}
            watchlist={state.watchlist}
            trackingProfiles={state.stockTrackingProfiles}
            onAddStock={addDividendFinancingStock}
            onViewStock={viewWatchlistStockFromRanking}
            onSnapshotChange={setDividendFinancingSnapshot}
            onChangeReportChange={setDividendFinancingChangeReport}
            onClose={() => setDividendRankingOpen(false)}
          />
        </Suspense>
      ) : null}
      {loadedDialogs.has('fundamental-screening') ? (
        <Suspense fallback={null}>
          <FundamentalScreeningDialog
            open={fundamentalScreeningOpen}
            cachedSnapshot={fundamentalSnapshot}
            cachedChangeReport={fundamentalChangeReport}
            dataState={fundamentalDataState}
            watchlist={state.watchlist}
            trackingProfiles={state.stockTrackingProfiles}
            onAddStock={addFundamentalScreeningStock}
            onViewStock={viewWatchlistStockFromFundamentals}
            onSnapshotChange={setFundamentalSnapshot}
            onChangeReportChange={setFundamentalChangeReport}
            onClose={() => setFundamentalScreeningOpen(false)}
          />
        </Suspense>
      ) : null}
      {loadedDialogs.has('daily-scan') ? (
        <Suspense fallback={null}>
          <DailyMarketScanDialog
            open={dailyMarketScanOpen}
            watchlist={state.watchlist}
            trackingProfiles={state.stockTrackingProfiles}
            onAddStock={addDailyMarketScanStock}
            onViewStock={viewWatchlistStockFromDailyScan}
            onClose={() => setDailyMarketScanOpen(false)}
          />
        </Suspense>
      ) : null}
      {loadedDialogs.has('tracking') ? (
        <Suspense fallback={null}>
          <StockTrackingDialog
            open={stockTrackingOpen}
            profiles={state.stockTrackingProfiles}
            watchlist={state.watchlist}
            quotes={quotes}
            onUpdateProfile={saveTrackingProfile}
            onStopTracking={stopTracking}
            onRestartTracking={restartTracking}
            onDeleteStock={removeTrackedStock}
            onViewStock={viewWatchlistStockFromTracking}
            bollingerBandsEnabled={state.settings.showBollingerBands}
            onBollingerBandsEnabledChange={updateBollingerBandsEnabled}
            onClose={() => setStockTrackingOpen(false)}
          />
        </Suspense>
      ) : null}
      {corporateActionCenterOpen ? (
        <Suspense fallback={null}>
          <CorporateActionCenterDialog
            open
            watchlist={state.watchlist}
            records={state.corporateActionRecords}
            onViewStock={viewCorporateActionStock}
            onClose={() => setCorporateActionCenterOpen(false)}
          />
        </Suspense>
      ) : null}
      {portfolioPerformanceOpen ? (
        <Suspense fallback={null}>
          <PortfolioPerformanceDialog
            watchlist={state.watchlist}
            quotes={quotes}
            accounts={state.tTradingAccounts}
            exchangeRates={state.settings.exchangeRates}
            adjustments={state.portfolioPerformanceAdjustments ?? {}}
            onSaveAdjustments={savePortfolioPerformanceAdjustments}
            onRecalculateStock={recalculatePortfolioPerformanceStock}
            onClose={() => setPortfolioPerformanceOpen(false)}
          />
        </Suspense>
      ) : null}
      {aiRuntimeAvailable && AiAssistantDrawer ? (
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
