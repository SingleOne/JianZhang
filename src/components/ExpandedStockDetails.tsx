import { AlertCircle, BarChart3, Bot, Layers, Radar, RefreshCw, Sparkles, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import { estimateChipHistoryLimit, findChipAutoRange } from '../lib/chip-distribution'
import { formatAmount, formatPercent, formatPrice, formatVolume } from '../lib/format'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  isBeijingAutoRefreshTime,
  millisecondsUntilNextAutoRefreshWindow
} from '../shared/market-hours'
import type { KlineBar, KlinePeriod, KlineResult, StockQuote, WatchStock } from '../shared/types'
import { FundsFlowPanel } from './FundsFlowPanel'
import { ChipDistributionPanel } from './ChipDistributionPanel'
import { OrderBookPanel } from './OrderBookPanel'
import type { KlineVisibleRange, KlineVisibleRangeSource } from './PeriodKlineChart'
import type { MarketInsightSnapshot } from '../modules/market-insight/shared/types'

const CandlestickChart = lazy(() => import('./CandlestickChart'))
const PeriodKlineChart = lazy(() => import('./PeriodKlineChart'))
const SectorIndexPanel = lazy(() => import('./SectorIndexPanel'))
const MarketInsightPanel = __JIANZHANG_MARKET_INSIGHT_ENABLED__
  ? lazy(() => import('../modules/market-insight/renderer/register').then((module) => ({ default: module.MarketInsightPanel })))
  : null
const AiAnalysisPanel = __JIANZHANG_AI_MODULE_ENABLED__
  ? lazy(() => import('../modules/ai/renderer/register').then((module) => ({ default: module.AiAnalysisPanel })))
  : null
const AiTAdvicePanel = __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__
  ? lazy(() => import('../modules/ai-t-advice/renderer/register').then((module) => ({ default: module.TAdvicePanel })))
  : null

type PriceTab = Exclude<KlinePeriod, 'intraday'> | 'trend'
type DetailTab = PriceTab | 'funds' | 'sector' | 'insight' | 'ai' | 't-advice'
type HistoricalPeriod = Extract<KlinePeriod, 'daily' | 'weekly' | 'monthly'>

interface KlineCacheEntry {
  data: KlineResult
  cachedAt: number
  requestedLimit?: number
}

const klineCache = new Map<string, KlineCacheEntry>()
const PRICE_TABS: Array<{ id: PriceTab; label: string; description: string }> = [
  { id: 'trend', label: '分时', description: '集合竞价与盘中分时线' },
  { id: 'fiveDay', label: '五日', description: '五日分时线' },
  { id: 'daily', label: '日K', description: '日 K 线' },
  { id: 'weekly', label: '周K', description: '周 K 线' },
  { id: 'monthly', label: '月K', description: '月 K 线' }
]
const LEADING_PRICE_TABS = PRICE_TABS.filter((tab) => tab.id === 'trend')
const TRAILING_PRICE_TABS = PRICE_TABS.filter((tab) => tab.id !== 'trend')
const PRICE_TAB_IDS = new Set<PriceTab>(PRICE_TABS.map((tab) => tab.id))
const INITIAL_HISTORY_LIMITS: Record<HistoricalPeriod, number> = {
  daily: 120,
  weekly: 104,
  monthly: 60
}
const MAX_HISTORY_LIMITS: Record<HistoricalPeriod, number> = {
  daily: 1920,
  weekly: 1664,
  monthly: 960
}

function isHistoricalTab(tab: PriceTab): tab is HistoricalPeriod {
  return tab === 'daily' || tab === 'weekly' || tab === 'monthly'
}

function isPriceTab(tab: DetailTab): tab is PriceTab {
  return PRICE_TAB_IDS.has(tab as PriceTab)
}

function apiPeriod(tab: PriceTab): KlinePeriod {
  return tab === 'trend' ? 'intraday' : tab
}

function cacheKey(quoteId: string, tab: PriceTab): string {
  return `${quoteId}:${tab}`
}

interface ExpandedStockDetailsProps {
  stock: WatchStock
  quote?: StockQuote
  refreshSeconds: number
  autoRefreshOrderBook: boolean
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  onChipDistributionEnabledChange: (enabled: boolean) => void
  onBollingerBandsEnabledChange: (enabled: boolean) => void
}

export function ExpandedStockDetails({
  stock,
  quote,
  refreshSeconds,
  autoRefreshOrderBook,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  onChipDistributionEnabledChange,
  onBollingerBandsEnabledChange
}: ExpandedStockDetailsProps) {
  const initialTrend = klineCache.get(cacheKey(stock.quoteId, 'trend'))?.data
  const [activeTab, setActiveTab] = useState<DetailTab>('trend')
  const [dataByTab, setDataByTab] = useState<Partial<Record<PriceTab, KlineResult>>>(() => (
    initialTrend ? { trend: initialTrend } : {}
  ))
  const [loadingTab, setLoadingTab] = useState<PriceTab | null>(initialTrend ? null : 'trend')
  const [errors, setErrors] = useState<Partial<Record<PriceTab, string>>>({})
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [hoveredBar, setHoveredBar] = useState<KlineBar | null>(null)
  const [historyLimits, setHistoryLimits] = useState<Record<HistoricalPeriod, number>>({
    ...INITIAL_HISTORY_LIMITS
  })
  const [dailyVisibleRange, setDailyVisibleRange] = useState<KlineVisibleRange | null>(null)
  const [chipAutoRangeMode, setChipAutoRangeMode] = useState(true)
  const [chipRangeRequestKey, setChipRangeRequestKey] = useState(0)
  const [marketInsightSnapshot, setMarketInsightSnapshot] = useState<MarketInsightSnapshot | null>(null)
  const [showInsightOverlay, setShowInsightOverlay] = useState(true)
  const [aiEnabled, setAiEnabled] = useState(false)
  const activeHistoricalLimit = isPriceTab(activeTab) && isHistoricalTab(activeTab)
    ? historyLimits[activeTab]
    : undefined

  useEffect(() => {
    setHoveredBar(null)
  }, [activeTab, stock.quoteId])

  useEffect(() => {
    setMarketInsightSnapshot(null)
    setDailyVisibleRange(null)
    setChipAutoRangeMode(true)
    setChipRangeRequestKey((current) => current + 1)
  }, [stock.quoteId])

  useEffect(() => {
    let active = true
    const api = window.aiApi
    if (AiAnalysisPanel && api) {
      void api.getStatus().then((status) => {
        if (active) setAiEnabled(status.enabled)
      }).catch(() => {
        if (active) setAiEnabled(false)
      })
    }
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleEnabledChange = (event: Event) => setAiEnabled(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener('ai:enabled-changed', handleEnabledChange)
    return () => window.removeEventListener('ai:enabled-changed', handleEnabledChange)
  }, [])

  useEffect(() => {
    if (!aiEnabled && (activeTab === 'ai' || activeTab === 't-advice')) setActiveTab('trend')
  }, [activeTab, aiEnabled])

  useEffect(() => {
    if (!isPriceTab(activeTab)) return

    const tab = activeTab
    const key = cacheKey(stock.quoteId, tab)
    const cached = klineCache.get(key)
    const isLiveChart = tab === 'trend' || tab === 'fiveDay'
    const requestedLimit = isHistoricalTab(tab) ? activeHistoricalLimit : undefined
    const cacheHasRequestedRange = requestedLimit === undefined
      || (cached?.requestedLimit ?? 0) >= requestedLimit
    const freshness = isLiveChart ? INTRADAY_REFRESH_MILLISECONDS : 5 * 60 * 1000
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      if (!isLiveChart) return
      refreshTimer = window.setTimeout(() => {
        if (isBeijingAutoRefreshTime()) {
          setRefreshVersion((current) => current + 1)
        } else {
          scheduleRefresh()
        }
      }, isBeijingAutoRefreshTime() ? freshness : millisecondsUntilNextAutoRefreshWindow())
    }

    if (refreshVersion === 0 && cached && cacheHasRequestedRange && Date.now() - cached.cachedAt < freshness) {
      setDataByTab((current) => ({ ...current, [tab]: cached.data }))
      setErrors((current) => ({ ...current, [tab]: '' }))
      setLoadingTab(null)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    setLoadingTab(tab)
    setErrors((current) => ({ ...current, [tab]: '' }))
    stockApi.getKline(stock.quoteId, apiPeriod(tab), requestedLimit)
      .then((result) => {
        if (!active) return
        const isFiveMinuteFallback = tab === 'trend' && result.intervalMinutes === 5
        const hasOneMinuteCache = Boolean(cached && cached.data.intervalMinutes !== 5)
        if (isFiveMinuteFallback && hasOneMinuteCache) {
          setErrors((current) => ({
            ...current,
            [tab]: result.fallbackReason || '1分钟分时数据刷新失败'
          }))
          return
        }
        klineCache.set(key, { data: result, cachedAt: Date.now(), requestedLimit })
        setDataByTab((current) => ({ ...current, [tab]: result }))
      })
      .catch((reason: unknown) => {
        if (!active) return
        setErrors((current) => ({
          ...current,
          [tab]: reason instanceof Error ? reason.message : `${PRICE_TABS.find((item) => item.id === tab)?.label}加载失败`
        }))
      })
      .finally(() => {
        if (!active) return
        setLoadingTab(null)
        scheduleRefresh()
      })

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [activeHistoricalLimit, activeTab, refreshVersion, stock.quoteId])

  const priceTab = isPriceTab(activeTab) ? activeTab : null
  const data = priceTab ? dataByTab[priceTab] ?? null : null
  const error = priceTab ? errors[priceTab] ?? '' : ''
  const tabMeta = priceTab ? PRICE_TABS.find((item) => item.id === priceTab) : undefined
  const isLoading = priceTab !== null && loadingTab === priceTab
  const historicalPeriod = priceTab && isHistoricalTab(priceTab) ? priceTab : null
  const isHistorical = historicalPeriod !== null
  const dailyBars = dataByTab.daily?.bars ?? []
  const chipAutoRange = useMemo(() => findChipAutoRange(dailyBars), [dailyBars])
  const chipDataStatus = dailyBars.length > 0
    ? chipAutoRange
      ? 'ready' as const
      : 'missing-turnover' as const
    : loadingTab === 'daily' || activeTab === 'daily' && !dataByTab.daily && !errors.daily
      ? 'loading' as const
      : errors.daily
        ? 'failed' as const
        : 'empty' as const
  const chipStatusDetail = chipDataStatus === 'failed'
    ? errors.daily
    : chipDataStatus === 'missing-turnover'
      ? dataByTab.daily?.fallbackReason
        ? `${dataByTab.daily.fallbackReason}；备用数据未提供完整换手率。`
        : undefined
      : undefined
  const chipVisibleRange = chipAutoRangeMode ? chipAutoRange : dailyVisibleRange ?? chipAutoRange
  const chipBars = useMemo(() => chipVisibleRange
    ? dailyBars.slice(chipVisibleRange.fromIndex, chipVisibleRange.toIndex + 1)
    : [], [chipVisibleRange, dailyBars])
  const isFiveMinuteFallback = priceTab === 'trend' && data?.intervalMinutes === 5
  const overviewBar = priceTab === 'trend' ? null : hoveredBar
  const changePercentByTime = useMemo(() => {
    const changes = new Map<string, number>()
    if (!isHistorical || !data) return changes

    for (let index = 1; index < data.bars.length; index += 1) {
      const previousClose = data.bars[index - 1].close
      if (previousClose !== 0) {
        changes.set(data.bars[index].time, (data.bars[index].close - previousClose) / previousClose * 100)
      }
    }
    return changes
  }, [data, isHistorical])
  const overview = overviewBar ? [
    ['开盘', formatPrice(overviewBar.open)],
    ['收盘', formatPrice(overviewBar.close)],
    ...(isHistorical ? [['涨幅', formatPercent(changePercentByTime.get(overviewBar.time))]] : []),
    ['最高', formatPrice(overviewBar.high)],
    ['最低', formatPrice(overviewBar.low)],
    ['成交量', formatVolume(overviewBar.volume)],
    ['成交额', formatAmount(overviewBar.amount)]
  ] : [
    ['今开', formatPrice(quote?.open)],
    ['昨收', formatPrice(quote?.previousClose)],
    ['最高', formatPrice(quote?.high)],
    ['最低', formatPrice(quote?.low)],
    ['成交量', formatVolume(quote?.volume)],
    ['成交额', formatAmount(quote?.amount)]
  ]

  const handleHoverBar = useCallback((bar: KlineBar | null) => {
    setHoveredBar(bar)
  }, [])

  const handleDailyVisibleRangeChange = useCallback((
    range: KlineVisibleRange,
    source: KlineVisibleRangeSource
  ) => {
    setDailyVisibleRange(range)
    if (source === 'user') setChipAutoRangeMode(false)
  }, [])

  const requestMoreHistory = useCallback((period: HistoricalPeriod) => {
    setHistoryLimits((current) => {
      const nextLimit = Math.min(MAX_HISTORY_LIMITS[period], current[period] * 2)
      return nextLimit === current[period] ? current : { ...current, [period]: nextLimit }
    })
  }, [])

  useEffect(() => {
    if (!chipDistributionEnabled || activeTab !== 'daily' || !chipAutoRange) return
    if (chipAutoRange.reachedThreshold || dailyBars.length < historyLimits.daily) return
    const estimatedLimit = estimateChipHistoryLimit(dailyBars, MAX_HISTORY_LIMITS.daily)
    if (estimatedLimit === null) return
    setHistoryLimits((current) => current.daily >= estimatedLimit
      ? current
      : { ...current, daily: estimatedLimit })
  }, [activeTab, chipAutoRange, chipDistributionEnabled, dailyBars, historyLimits.daily])

  const toggleChipDistribution = () => {
    const enabled = !chipDistributionEnabled
    if (enabled) {
      setDailyVisibleRange(null)
      setChipAutoRangeMode(true)
      setChipRangeRequestKey((current) => current + 1)
    }
    onChipDistributionEnabledChange(enabled)
  }

  const restoreChipAutoRange = () => {
    setDailyVisibleRange(null)
    setChipAutoRangeMode(true)
    setChipRangeRequestKey((current) => current + 1)
  }

  const retryCurrentTab = () => {
    if (priceTab) klineCache.delete(cacheKey(stock.quoteId, priceTab))
    setRefreshVersion((current) => current + 1)
  }

  return (
    <section className="stock-details" aria-label={`${stock.name} 行情详情`}>
      <div className="detail-tabs" role="tablist" aria-label="行情详情类型">
        {LEADING_PRICE_TABS.map((tab) => (
          <button
            className={activeTab === tab.id ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            <BarChart3 size={15} />
            {tab.label}
          </button>
        ))}
        <button
          className={activeTab === 'funds' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'funds'}
          onClick={() => setActiveTab('funds')}
        >
          <TrendingUp size={15} />
          资金流向
        </button>
        {MarketInsightPanel ? (
          <button
            className={activeTab === 'insight' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 'insight'}
            onClick={() => setActiveTab('insight')}
          >
            <Radar size={15} />
            市场观察
          </button>
        ) : null}
        {AiAnalysisPanel && aiEnabled ? (
          <button
            className={activeTab === 'ai' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 'ai'}
            onClick={() => setActiveTab('ai')}
          >
            <Bot size={15} />
            AI 分析
          </button>
        ) : null}
        {AiTAdvicePanel && aiEnabled ? (
          <button
            className={activeTab === 't-advice' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === 't-advice'}
            onClick={() => setActiveTab('t-advice')}
          >
            <Sparkles size={15} />
            做 T 参考
          </button>
        ) : null}
        {TRAILING_PRICE_TABS.map((tab) => (
          <button
            className={activeTab === tab.id ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            <BarChart3 size={15} />
            {tab.label}
          </button>
        ))}
        <button
          className={activeTab === 'sector' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'sector'}
          onClick={() => setActiveTab('sector')}
        >
          <Layers size={15} />
          板块
        </button>
      </div>

      {priceTab ? (
        <div className="trend-tab-panel" role="tabpanel">
          <div className="overview-header">
            <div>
              <strong>今日概览</strong>
              <span>{overviewBar?.time || data?.tradingDate || '最近交易日'} · {tabMeta?.description}</span>
              {isFiveMinuteFallback ? (
                <em className="intraday-fallback-badge">5分钟备用行情</em>
              ) : null}
            </div>
            <div className="chart-legend" aria-label="图表图例">
              <span className={isHistorical ? 'legend-candlestick' : 'legend-price'}>
                {isHistorical ? 'K线' : '价格'}
              </span>
              {priceTab === 'trend' ? <span className="legend-auction-price">集合竞价</span> : null}
              {priceTab === 'trend' ? <span className="legend-average-price">VWAP</span> : null}
              <span className="legend-volume">成交量</span>
              {priceTab === 'daily' ? (
                <button
                  className={`chip-distribution-toggle ${chipDistributionEnabled ? 'is-active' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={chipDistributionEnabled}
                  onClick={toggleChipDistribution}
                >
                  <span aria-hidden="true"><i /></span>
                  筹码分布
                </button>
              ) : null}
            </div>
          </div>
          <div className="overview-grid">
            {overview.map(([label, value]) => (
              <div className="overview-item" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className={`chart-panel ${priceTab === 'trend' ? 'has-order-book' : ''} ${historicalPeriod ? 'has-bollinger-toolbar' : ''} ${priceTab === 'daily' && chipDistributionEnabled ? 'has-chip-distribution' : ''}`}>
            <div className="chart-content">
              {error && data || isFiveMinuteFallback ? (
                <div className="chart-refresh-warning" title={isFiveMinuteFallback ? data?.fallbackReason : error}>
                  <AlertCircle size={14} />
                  <span>
                    {isFiveMinuteFallback
                      ? '1分钟分时暂不可用，当前显示5分钟备用行情'
                      : priceTab === 'trend'
                        ? '1分钟分时刷新失败，当前显示最近一次1分钟数据'
                        : `${tabMeta?.label}数据刷新失败，当前显示最近一次数据`}
                  </span>
                  <button type="button" onClick={retryCurrentTab}>重试</button>
                </div>
              ) : null}
              {isLoading && data && isHistorical ? (
                <div className="chart-history-loading">
                  {priceTab === 'daily' && chipDistributionEnabled && chipAutoRangeMode && chipAutoRange && !chipAutoRange.reachedThreshold
                    ? `正在补取更早日 K：累计换手 ${chipAutoRange.cumulativeTurnover.toFixed(2)}%，目标 100%`
                    : '正在加载更早数据…'}
                </div>
              ) : null}
              {isLoading && !data ? (
                <div className="chart-loading">
                  <BarChart3 size={28} />
                  <span>正在加载{tabMeta?.label}数据…</span>
                </div>
              ) : error && !data ? (
                <div className="chart-error">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                  <button className="secondary-button chart-retry-button" type="button" onClick={retryCurrentTab}>
                    <RefreshCw size={14} />
                    重新获取
                  </button>
                </div>
              ) : data && data.bars.length > 0 ? (
                <Suspense fallback={<div className="chart-loading">正在初始化图表…</div>}>
                  {historicalPeriod ? (
                    <PeriodKlineChart
                      bars={data.bars}
                      period={historicalPeriod}
                      onHoverBar={handleHoverBar}
                      onRequestMore={requestMoreHistory}
                      requestedVisibleBars={historicalPeriod === 'daily' && chipDistributionEnabled && chipAutoRangeMode
                        ? chipAutoRange?.barCount
                        : undefined}
                      visibleRangeRequestKey={chipRangeRequestKey}
                      onVisibleRangeChange={historicalPeriod === 'daily' ? handleDailyVisibleRangeChange : undefined}
                      bollingerBandsEnabled={bollingerBandsEnabled}
                      onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                      height={historicalPeriod === 'daily' && chipDistributionEnabled ? 360 : 320}
                    />
                  ) : (
                    <CandlestickChart
                      bars={data.bars}
                      variant={priceTab === 'fiveDay' ? 'fiveDay' : 'intraday'}
                      onHoverBar={priceTab === 'trend' ? undefined : handleHoverBar}
                      marketInsightOverlay={priceTab === 'trend' && showInsightOverlay ? marketInsightSnapshot?.chartOverlay : null}
                    />
                  )}
                </Suspense>
              ) : (
                <div className="chart-loading">最近交易日暂无{tabMeta?.label}数据</div>
              )}
            </div>
            {priceTab === 'trend' ? (
              <OrderBookPanel
                stock={stock}
                refreshSeconds={refreshSeconds}
                autoRefresh={autoRefreshOrderBook}
              />
            ) : priceTab === 'daily' && chipDistributionEnabled ? (
              <ChipDistributionPanel
                quoteId={stock.quoteId}
                quoteName={stock.name}
                bars={chipBars}
                dataStatus={chipDataStatus}
                statusDetail={chipStatusDetail}
                isAutoRange={chipAutoRangeMode}
                onRestoreAutoRange={restoreChipAutoRange}
              />
            ) : null}
          </div>
        </div>
      ) : activeTab === 'funds' ? (
        <div className="funds-tab-panel" role="tabpanel">
          <FundsFlowPanel stock={stock} />
        </div>
      ) : activeTab === 'sector' ? (
        <div className="sector-tab-panel" role="tabpanel">
          <Suspense fallback={<div className="chart-loading">正在加载板块详情…</div>}>
            <SectorIndexPanel stock={stock} />
          </Suspense>
        </div>
      ) : activeTab === 'ai' && AiAnalysisPanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化 AI 分析…</div>}>
          <AiAnalysisPanel stock={stock} quote={quote} />
        </Suspense>
      ) : activeTab === 't-advice' && AiTAdvicePanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化做 T 参考…</div>}>
          <AiTAdvicePanel stock={stock} quote={quote} />
        </Suspense>
      ) : MarketInsightPanel ? (
        <Suspense fallback={<div className="chart-loading">正在初始化市场观察…</div>}>
          <MarketInsightPanel
            stock={stock}
            quote={quote}
            onSnapshotChanged={setMarketInsightSnapshot}
            onChartOverlayEnabledChange={setShowInsightOverlay}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
