import { AlertCircle, BarChart3, RefreshCw, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatAmount, formatPrice, formatVolume } from '../lib/format'
import { isBeijingAutoRefreshTime, millisecondsUntilNextAutoRefreshWindow } from '../shared/market-hours'
import type { KlinePeriod, KlineResult, StockQuote, WatchStock } from '../shared/types'
import { FundsFlowPanel } from './FundsFlowPanel'

const CandlestickChart = lazy(() => import('./CandlestickChart'))
const PeriodKlineChart = lazy(() => import('./PeriodKlineChart'))

type PriceTab = Exclude<KlinePeriod, 'intraday'> | 'trend'
type DetailTab = PriceTab | 'funds'

interface KlineCacheEntry {
  data: KlineResult
  cachedAt: number
}

const klineCache = new Map<string, KlineCacheEntry>()
const PRICE_TABS: Array<{ id: PriceTab; label: string; description: string }> = [
  { id: 'trend', label: '分时', description: '盘中分时线' },
  { id: 'fiveDay', label: '五日', description: '五日分时线' },
  { id: 'daily', label: '日K', description: '日 K 线' },
  { id: 'weekly', label: '周K', description: '周 K 线' },
  { id: 'monthly', label: '月K', description: '月 K 线' }
]

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
}

export function ExpandedStockDetails({ stock, quote, refreshSeconds }: ExpandedStockDetailsProps) {
  const initialTrend = klineCache.get(cacheKey(stock.quoteId, 'trend'))?.data
  const [activeTab, setActiveTab] = useState<DetailTab>('trend')
  const [dataByTab, setDataByTab] = useState<Partial<Record<PriceTab, KlineResult>>>(() => (
    initialTrend ? { trend: initialTrend } : {}
  ))
  const [loadingTab, setLoadingTab] = useState<PriceTab | null>(initialTrend ? null : 'trend')
  const [errors, setErrors] = useState<Partial<Record<PriceTab, string>>>({})
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (activeTab === 'funds') return

    const tab = activeTab
    const key = cacheKey(stock.quoteId, tab)
    const cached = klineCache.get(key)
    const isLiveChart = tab === 'trend' || tab === 'fiveDay'
    const freshness = isLiveChart ? Math.max(3, refreshSeconds) * 1000 : 5 * 60 * 1000
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

    if (refreshVersion === 0 && cached && Date.now() - cached.cachedAt < freshness) {
      setDataByTab((current) => ({ ...current, [tab]: cached.data }))
      setErrors((current) => ({ ...current, [tab]: '' }))
      setLoadingTab(null)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    if (!cached) setLoadingTab(tab)
    setErrors((current) => ({ ...current, [tab]: '' }))
    stockApi.getKline(stock.quoteId, apiPeriod(tab))
      .then((result) => {
        if (!active) return
        klineCache.set(key, { data: result, cachedAt: Date.now() })
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
  }, [activeTab, refreshSeconds, refreshVersion, stock.quoteId])

  const overview = [
    ['今开', formatPrice(quote?.open)],
    ['昨收', formatPrice(quote?.previousClose)],
    ['最高', formatPrice(quote?.high)],
    ['最低', formatPrice(quote?.low)],
    ['成交量', formatVolume(quote?.volume)],
    ['成交额', formatAmount(quote?.amount)]
  ]
  const priceTab = activeTab === 'funds' ? null : activeTab
  const data = priceTab ? dataByTab[priceTab] ?? null : null
  const error = priceTab ? errors[priceTab] ?? '' : ''
  const tabMeta = priceTab ? PRICE_TABS.find((item) => item.id === priceTab) : undefined
  const isLoading = priceTab !== null && loadingTab === priceTab
  const isHistorical = priceTab === 'daily' || priceTab === 'weekly' || priceTab === 'monthly'

  const retryCurrentTab = () => {
    if (priceTab) klineCache.delete(cacheKey(stock.quoteId, priceTab))
    setRefreshVersion((current) => current + 1)
  }

  return (
    <section className="stock-details" aria-label={`${stock.name} 行情详情`}>
      <div className="detail-tabs" role="tablist" aria-label="行情详情类型">
        {PRICE_TABS.map((tab) => (
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
      </div>

      {priceTab ? (
        <div className="trend-tab-panel" role="tabpanel">
          <div className="overview-header">
            <div>
              <strong>今日概览</strong>
              <span>{data?.tradingDate || '最近交易日'} · {tabMeta?.description}</span>
            </div>
            <div className="chart-legend" aria-label="图表图例">
              <span className={isHistorical ? 'legend-candlestick' : 'legend-price'}>
                {isHistorical ? 'K线' : '价格'}
              </span>
              {priceTab === 'trend' ? <span className="legend-average-price">成交均价</span> : null}
              <span className="legend-volume">成交量</span>
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
          <div className="chart-panel">
            {error && data ? (
              <div className="chart-refresh-warning">
                <AlertCircle size={14} />
                <span>{tabMeta?.label}数据刷新失败，当前显示最近一次数据</span>
                <button type="button" onClick={retryCurrentTab}>重试</button>
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
                {isHistorical ? (
                  <PeriodKlineChart bars={data.bars} period={priceTab} />
                ) : (
                  <CandlestickChart bars={data.bars} variant={priceTab === 'fiveDay' ? 'fiveDay' : 'intraday'} />
                )}
              </Suspense>
            ) : (
              <div className="chart-loading">最近交易日暂无{tabMeta?.label}数据</div>
            )}
          </div>
        </div>
      ) : (
        <div className="funds-tab-panel" role="tabpanel">
          <FundsFlowPanel stock={stock} refreshSeconds={refreshSeconds} />
        </div>
      )}
    </section>
  )
}
