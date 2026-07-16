import { CircleCheck, RefreshCw, Signal, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppTitlebar } from './components/AppTitlebar'
import { SearchBar } from './components/SearchBar'
import { SettingsMenu } from './components/SettingsMenu'
import { WatchlistTable } from './components/WatchlistTable'
import { initialState, isDesktopRuntime, stockApi } from './lib/api'
import { formatPercent, formatProfit, formatUpdateTime } from './lib/format'
import { calculatePortfolioSummary } from './lib/portfolio'
import type {
  AppSettings,
  AppState,
  SearchResult,
  StockPosition,
  StockQuote,
  WatchlistColumnId
} from './shared/types'

export default function App() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null)
  const [source, setSource] = useState<'eastmoney' | 'demo'>('eastmoney')
  const [initializing, setInitializing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
        setSelectedQuoteId((current) =>
          current && bootstrap.state.watchlist.some((stock) => stock.quoteId === current) ? current : null
        )
      })
      .catch((reason: unknown) => reportError(reason instanceof Error ? reason.message : '应用初始化失败'))
      .finally(() => setInitializing(false))

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeSelection = stockApi.onSelectStock(setSelectedQuoteId)
    const unsubscribeError = stockApi.onDataError(reportError)
    return () => {
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeSelection()
      unsubscribeError()
    }
  }, [reportError])

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

  const quoteIds = useMemo(() => new Set(state.watchlist.map((stock) => stock.quoteId)), [state.watchlist])
  const portfolioSummary = useMemo(
    () => calculatePortfolioSummary(state.watchlist, quotes),
    [quotes, state.watchlist]
  )
  const lastUpdated = quotes.reduce<string | undefined>((latest, quote) => {
    if (!latest || quote.updatedAt > latest) return quote.updatedAt
    return latest
  }, undefined)

  const persist = useCallback(async (nextState: AppState) => {
    setState(nextState)
    try {
      const saved = await stockApi.saveState(nextState)
      setState(saved)
      if (!isDesktopRuntime) setQuotes(await stockApi.refreshQuotes())
      return saved
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '设置保存失败')
      return null
    }
  }, [reportError])

  const addStock = useCallback((result: SearchResult) => {
    const existing = state.watchlist.find((stock) => stock.quoteId === result.quoteId)
    if (existing) {
      setSelectedQuoteId(existing.quoteId)
      return
    }
    const nextState = {
      ...state,
      watchlist: [...state.watchlist, { ...result, showInTaskbar: false }]
    }
    setSelectedQuoteId(result.quoteId)
    void persist(nextState)
  }, [persist, state])

  const removeStock = useCallback((quoteId: string) => {
    const nextWatchlist = state.watchlist.filter((stock) => stock.quoteId !== quoteId)
    if (selectedQuoteId === quoteId) setSelectedQuoteId(null)
    setQuotes((current) => current.filter((quote) => quote.quoteId !== quoteId))
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, selectedQuoteId, state])

  const toggleTaskbar = useCallback((quoteId: string) => {
    const nextWatchlist = state.watchlist.map((stock) =>
      stock.quoteId === quoteId ? { ...stock, showInTaskbar: !stock.showInTaskbar } : stock
    )
    void persist({ ...state, watchlist: nextWatchlist })
  }, [persist, state])

  const updatePosition = useCallback((quoteId: string, position: StockPosition | undefined) => {
    const nextWatchlist = state.watchlist.map((stock) =>
      stock.quoteId === quoteId ? { ...stock, position } : stock
    )
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

  const updateSettings = useCallback((settings: AppSettings) => {
    void persist({ ...state, settings })
  }, [persist, state])

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
      const confirmed = window.confirm(
        `导入后将用文件中的 ${result.state.watchlist.length} 只股票和全部设置覆盖当前配置，是否继续？`
      )
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
  }, [persist, reportError, reportSuccess])

  const refreshNow = async () => {
    setRefreshing(true)
    try {
      setQuotes(await stockApi.refreshQuotes())
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="app-shell">
      <AppTitlebar lastUpdated={lastUpdated} />
      <main className="app-main">
        <div className="workspace">
          <section className="command-bar" aria-label="自选股操作">
            <SearchBar onAdd={addStock} existingQuoteIds={quoteIds} onError={reportError} />
            <div className="command-actions">
              <button className="secondary-button refresh-button" onClick={refreshNow} disabled={refreshing}>
                <RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} />
                立即刷新
              </button>
              <SettingsMenu
                settings={state.settings}
                onChange={updateSettings}
                onImportConfig={importConfig}
                onExportConfig={exportConfig}
                configBusy={configBusy}
              />
            </div>
          </section>

          <section className="watchlist-panel" aria-label="我的自选">
            <div className="panel-heading">
              <div className="panel-title">
                <h1>我的自选</h1>
                <span>{state.watchlist.length} 只股票 · {portfolioSummary.positionCount} 只有持仓 · 点击股票行展开行情详情</span>
              </div>
              <div className="panel-heading-side">
                <div className="portfolio-summary" aria-label="全部持仓收益汇总">
                  <span>
                    <small>今日总收益</small>
                    <strong className={portfolioSummary.todayProfit === null ? 'is-flat' : portfolioSummary.todayProfit >= 0 ? 'is-up' : 'is-down'}>
                      {formatProfit(portfolioSummary.todayProfit)}
                    </strong>
                  </span>
                  <span>
                    <small>持仓总收益</small>
                    <strong className={portfolioSummary.totalProfit === null ? 'is-flat' : portfolioSummary.totalProfit >= 0 ? 'is-up' : 'is-down'}>
                      {formatProfit(portfolioSummary.totalProfit)}
                    </strong>
                  </span>
                  <span>
                    <small>总收益率</small>
                    <strong className={portfolioSummary.profitPercent === null ? 'is-flat' : portfolioSummary.profitPercent >= 0 ? 'is-up' : 'is-down'}>
                      {formatPercent(portfolioSummary.profitPercent)}
                    </strong>
                  </span>
                </div>
                <div className="auto-refresh-state">
                  <span className="live-dot" />
                  每 {state.settings.refreshSeconds} 秒自动刷新
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
                quotes={quotes}
                columnOrder={state.columnOrder}
                refreshSeconds={state.settings.refreshSeconds}
                selectedQuoteId={selectedQuoteId}
                onSelect={(quoteId) => setSelectedQuoteId((current) => current === quoteId ? null : quoteId)}
                onToggleTaskbar={toggleTaskbar}
                onEditPosition={updatePosition}
                onReorder={reorderWatchlist}
                onPin={pinStock}
                onColumnOrderChange={updateColumnOrder}
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
        <span className="status-spacer" />
        <span>红涨绿跌 · 行情仅供参考</span>
      </footer>

      {error ? <div className="error-toast"><WifiOff size={17} />{error}</div> : null}
      {notice ? <div className="success-toast"><CircleCheck size={17} />{notice}</div> : null}
    </div>
  )
}
