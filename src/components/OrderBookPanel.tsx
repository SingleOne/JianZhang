import { AlertCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatPrice, formatUpdateTime } from '../lib/format'
import { isBeijingAutoRefreshTime, millisecondsUntilNextAutoRefreshWindow } from '../shared/market-hours'
import type { OrderBookLevel, StockOrderBook, WatchStock } from '../shared/types'

interface OrderBookCacheEntry {
  data: StockOrderBook
  cachedAt: number
}

const orderBookCache = new Map<string, OrderBookCacheEntry>()

interface OrderBookPanelProps {
  stock: WatchStock
  refreshSeconds: number
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

export function OrderBookPanel({ stock, refreshSeconds }: OrderBookPanelProps) {
  const initialData = orderBookCache.get(stock.quoteId)?.data ?? null
  const [data, setData] = useState<StockOrderBook | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const cached = orderBookCache.get(stock.quoteId)
    const refreshMilliseconds = Math.max(3, refreshSeconds) * 1000
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      refreshTimer = window.setTimeout(() => {
        if (isBeijingAutoRefreshTime()) {
          setRefreshVersion((current) => current + 1)
        } else {
          scheduleRefresh()
        }
      }, isBeijingAutoRefreshTime() ? refreshMilliseconds : millisecondsUntilNextAutoRefreshWindow())
    }

    if (refreshVersion === 0 && cached && Date.now() - cached.cachedAt < refreshMilliseconds) {
      setData(cached.data)
      setError('')
      setLoading(false)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    setLoading(true)
    setError('')
    stockApi.getOrderBook(stock.quoteId)
      .then((result) => {
        if (!active) return
        orderBookCache.set(stock.quoteId, { data: result, cachedAt: Date.now() })
        setData(result)
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
  }, [refreshSeconds, refreshVersion, stock.quoteId])

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
          {error ? <div className="order-book-warning">刷新失败，当前为上次数据</div> : null}
        </>
      )}
    </aside>
  )
}
