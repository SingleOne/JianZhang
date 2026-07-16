import { AlertCircle, BarChart3, RefreshCw, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatAmount, formatPrice, formatVolume } from '../lib/format'
import type { KlineResult, StockQuote, WatchStock } from '../shared/types'
import { FundsFlowPanel } from './FundsFlowPanel'

const CandlestickChart = lazy(() => import('./CandlestickChart'))

interface KlineCacheEntry {
  data: KlineResult
  cachedAt: number
}

const klineCache = new Map<string, KlineCacheEntry>()

interface ExpandedStockDetailsProps {
  stock: WatchStock
  quote?: StockQuote
  refreshSeconds: number
}

export function ExpandedStockDetails({ stock, quote, refreshSeconds }: ExpandedStockDetailsProps) {
  const [activeTab, setActiveTab] = useState<'trend' | 'funds'>('trend')
  const [data, setData] = useState<KlineResult | null>(() => klineCache.get(stock.quoteId)?.data ?? null)
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const cached = klineCache.get(stock.quoteId)
    const refreshMilliseconds = Math.max(3, refreshSeconds) * 1000
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      refreshTimer = window.setTimeout(() => {
        setRefreshVersion((current) => current + 1)
      }, refreshMilliseconds)
    }

    if (refreshVersion === 0 && cached && Date.now() - cached.cachedAt < refreshMilliseconds) {
      setData(cached.data)
      setError('')
      setLoading(false)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    if (!cached) setLoading(true)
    setError('')
    stockApi.getKline(stock.quoteId)
      .then((result) => {
        if (!active) return
        klineCache.set(stock.quoteId, { data: result, cachedAt: Date.now() })
        setData(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'K 线加载失败')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
        scheduleRefresh()
      })

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [refreshSeconds, refreshVersion, stock.quoteId])

  const overview = [
    ['今开', formatPrice(quote?.open)],
    ['昨收', formatPrice(quote?.previousClose)],
    ['最高', formatPrice(quote?.high)],
    ['最低', formatPrice(quote?.low)],
    ['成交量', formatVolume(quote?.volume)],
    ['成交额', formatAmount(quote?.amount)]
  ]

  return (
    <section className="stock-details" aria-label={`${stock.name} 行情详情`}>
      <div className="detail-tabs" role="tablist" aria-label="行情详情类型">
        <button
          className={activeTab === 'trend' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'trend'}
          onClick={() => setActiveTab('trend')}
        >
          <BarChart3 size={15} />
          分时走势
        </button>
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
      {activeTab === 'trend' ? <div className="trend-tab-panel" role="tabpanel">
        <div className="overview-header">
        <div>
          <strong>今日概览</strong>
          <span>{data?.tradingDate || '最近交易日'} · 盘中分时线</span>
        </div>
        <div className="chart-legend" aria-label="分时图图例">
          <span className="legend-price">价格</span>
          <span className="legend-average-price">成交均价</span>
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
            <span>分时数据刷新失败，当前显示最近一次数据</span>
            <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>重试</button>
          </div>
        ) : null}
        {loading && !data ? (
          <div className="chart-loading">
            <BarChart3 size={28} />
            <span>正在加载当日 K 线…</span>
          </div>
        ) : error && !data ? (
          <div className="chart-error">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              className="secondary-button chart-retry-button"
              type="button"
              onClick={() => setRefreshVersion((current) => current + 1)}
            >
              <RefreshCw size={14} />
              重新获取
            </button>
          </div>
        ) : data && data.bars.length > 0 ? (
          <Suspense fallback={<div className="chart-loading">正在初始化图表…</div>}>
            <CandlestickChart bars={data.bars} />
          </Suspense>
        ) : (
          <div className="chart-loading">最近交易日暂无 K 线数据</div>
        )}
        </div>
      </div> : (
        <div className="funds-tab-panel" role="tabpanel">
          <FundsFlowPanel stock={stock} refreshSeconds={refreshSeconds} />
        </div>
      )}
    </section>
  )
}
