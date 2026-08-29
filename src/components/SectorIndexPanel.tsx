import { AlertCircle, BarChart3, RefreshCw } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatAmount, formatPercent, formatPrice, formatSigned } from '../lib/format'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  isBeijingAutoRefreshTime,
  millisecondsUntilNextAutoRefreshWindow
} from '../shared/market-hours'
import type { SectorIndexResult, WatchStock } from '../shared/types'

const CandlestickChart = lazy(() => import('./CandlestickChart'))
const SECTOR_INDEX_REFRESH_MILLISECONDS = INTRADAY_REFRESH_MILLISECONDS

interface SectorIndexCacheEntry {
  data: SectorIndexResult
  cachedAt: number
}

const sectorIndexCache = new Map<string, SectorIndexCacheEntry>()

interface SectorIndexPanelProps {
  stock: WatchStock
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export default function SectorIndexPanel({ stock }: SectorIndexPanelProps) {
  const [data, setData] = useState<SectorIndexResult | null>(
    () => sectorIndexCache.get(stock.quoteId)?.data ?? null
  )
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const cached = sectorIndexCache.get(stock.quoteId)
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      refreshTimer = window.setTimeout(
        () => {
          if (isBeijingAutoRefreshTime()) {
            setRefreshVersion((current) => current + 1)
          } else {
            scheduleRefresh()
          }
        },
        isBeijingAutoRefreshTime()
          ? SECTOR_INDEX_REFRESH_MILLISECONDS
          : millisecondsUntilNextAutoRefreshWindow()
      )
    }

    if (
      refreshVersion === 0 &&
      cached &&
      Date.now() - cached.cachedAt < SECTOR_INDEX_REFRESH_MILLISECONDS
    ) {
      setData(cached.data)
      setError('')
      setLoading(false)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    if (!cached) setLoading(true)
    setError('')
    stockApi
      .getSectorIndex(stock.quoteId)
      .then((result) => {
        if (!active) return
        sectorIndexCache.set(stock.quoteId, { data: result, cachedAt: Date.now() })
        setData(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '板块指数加载失败')
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
  }, [refreshVersion, stock.quoteId])

  if (loading && !data) {
    return (
      <div className="chart-loading">
        <BarChart3 size={28} />
        <span>正在加载所属板块指数…</span>
      </div>
    )
  }

  if (error && !data) {
    return (
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
    )
  }

  const quote = data?.quote
  const trendBars = data?.trend.bars.filter((bar) => bar.time.slice(11, 16) >= '09:30') ?? []
  const summary = [
    ['最新点位', formatPrice(quote?.latest), valueClass(quote?.change)],
    ['涨跌', formatSigned(quote?.change), valueClass(quote?.change)],
    ['涨跌幅', formatPercent(quote?.changePercent), valueClass(quote?.changePercent)],
    ['今开', formatPrice(quote?.open), ''],
    ['最高', formatPrice(quote?.high), ''],
    ['最低', formatPrice(quote?.low), ''],
    ['昨收', formatPrice(quote?.previousClose), ''],
    ['成交额', formatAmount(quote?.amount), '']
  ]

  return (
    <div className="sector-index-panel">
      {error && data ? (
        <div className="funds-flow-warning">
          <AlertCircle size={14} />
          <span>板块指数刷新失败，当前显示最近一次数据</span>
          <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>
            重试
          </button>
        </div>
      ) : null}
      <div className="sector-index-heading">
        <div>
          <strong>{data?.boardName}</strong>
          <span>{data?.boardCode} · 所属主行业板块指数</span>
        </div>
        <div className="sector-index-latest">
          <strong className={valueClass(quote?.change)}>{formatPrice(quote?.latest)}</strong>
          <span className={valueClass(quote?.changePercent)}>
            {formatPercent(quote?.changePercent)}
          </span>
        </div>
      </div>
      <div className="overview-grid sector-index-summary">
        {summary.map(([label, value, className]) => (
          <div className="overview-item" key={label}>
            <span>{label}</span>
            <strong className={className}>{value}</strong>
          </div>
        ))}
      </div>
      <div className="overview-header sector-index-chart-heading">
        <div>
          <strong>板块分时</strong>
          <span>{data?.trend.tradingDate || '最近交易日'} · 连续竞价走势</span>
        </div>
        <div className="chart-legend" aria-label="板块图表图例">
          <span className="legend-price">价格</span>
          <span className="legend-volume">成交量</span>
        </div>
      </div>
      <div className="chart-panel">
        {data && trendBars.length > 0 ? (
          <Suspense fallback={<div className="chart-loading">正在初始化板块分时图…</div>}>
            <CandlestickChart bars={trendBars} market="CN" variant="sectorIntraday" />
          </Suspense>
        ) : (
          <div className="chart-loading">最近交易日暂无板块分时数据</div>
        )}
      </div>
    </div>
  )
}
