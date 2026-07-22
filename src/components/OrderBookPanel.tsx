import { AlertCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatPrice, formatUpdateTime } from '../lib/format'
import { isBeijingAutoRefreshTime, millisecondsUntilNextAutoRefreshWindow } from '../shared/market-hours'
import type { OrderBookLevel, StockOrderBook, WatchStock } from '../shared/types'

interface OrderBookPanelProps {
  stock: WatchStock
  refreshSeconds: number
  autoRefresh: boolean
}

function priceClass(price: number | null, previousClose: number | null): string {
  if (price === null || previousClose === null || price === previousClose) return 'is-flat'
  return price > previousClose ? 'is-up' : 'is-down'
}

function formatOrderVolume(volume: number | null): string {
  if (volume === null) return '--'
  if (volume >= 10_000) return `${(volume / 10_000).toFixed(2)}万`
  return volume.toLocaleString('zh-CN')
}

function OrderBookRow({
  label,
  level,
  previousClose
}: {
  label: string
  level: OrderBookLevel
  previousClose: number | null
}) {
  return (
    <div className="order-book-row">
      <span>{label}</span>
      <strong className={priceClass(level.price, previousClose)}>{formatPrice(level.price)}</strong>
      <span>{formatOrderVolume(level.volume)}</span>
    </div>
  )
}

export function OrderBookPanel({ stock, refreshSeconds, autoRefresh }: OrderBookPanelProps) {
  const [data, setData] = useState<StockOrderBook | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const refreshMilliseconds = Math.max(3, refreshSeconds) * 1000
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      if (!autoRefresh) return
      refreshTimer = window.setTimeout(() => {
        if (isBeijingAutoRefreshTime()) {
          setRefreshVersion((current) => current + 1)
        } else {
          scheduleRefresh()
        }
      }, isBeijingAutoRefreshTime() ? refreshMilliseconds : millisecondsUntilNextAutoRefreshWindow())
    }

    setLoading(true)
    setError('')
    stockApi.getOrderBook(stock.quoteId)
      .then((result) => {
        if (!active) return
        setData(result)
        setError(result.refreshError ?? '')
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '五档盘口加载失败')
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
  }, [autoRefresh, refreshSeconds, refreshVersion, stock.quoteId])

  const previousClose = data?.previousClose ?? null
  const asks = data?.asks.slice().reverse() ?? []
  const bids = data?.bids ?? []
  const hasOrders = [...asks, ...bids].some((level) => level.price !== null)

  return (
    <aside className="order-book-panel" aria-label={`${stock.name} 五档盘口`}>
      <header>
        <div>
          <strong>五档盘口</strong>
          <span>委托量（手）</span>
        </div>
        <button
          type="button"
          aria-label="刷新五档盘口"
          title="刷新五档盘口"
          onClick={() => setRefreshVersion((current) => current + 1)}
        >
          <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
        </button>
      </header>

      {loading && !data ? (
        <div className="order-book-state">正在加载盘口…</div>
      ) : error && !data ? (
        <div className="order-book-state is-error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="order-book-levels">
            {asks.map((level, index) => (
              <OrderBookRow
                key={`ask-${5 - index}`}
                label={`卖${5 - index}`}
                level={level}
                previousClose={previousClose}
              />
            ))}
            <div className="order-book-latest">
              <span>最新</span>
              <strong className={priceClass(data?.latest ?? null, previousClose)}>
                {formatPrice(data?.latest)}
              </strong>
              <small>{formatUpdateTime(data?.updatedAt)}</small>
            </div>
            {bids.map((level, index) => (
              <OrderBookRow
                key={`bid-${index + 1}`}
                label={`买${index + 1}`}
                level={level}
                previousClose={previousClose}
              />
            ))}
          </div>
          {!hasOrders ? <div className="order-book-empty">收盘后暂无挂单</div> : null}
          {error ? (
            <div className="order-book-warning">
              <AlertCircle size={14} />
              <span>盘口刷新失败，当前显示 {formatUpdateTime(data?.updatedAt)} 的缓存</span>
            </div>
          ) : null}
        </>
      )}
    </aside>
  )
}
