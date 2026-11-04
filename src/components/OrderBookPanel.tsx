import { useOrderBookResource } from '../lib/data-center/detail-hooks'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { formatPrice, formatUpdateTime } from '../lib/format'
import type { OrderBookLevel, WatchStock } from '../shared/types'

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
  const { data, loading, error, refresh } = useOrderBookResource(
    stock.quoteId,
    refreshSeconds,
    autoRefresh
  )

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
          onClick={() => refresh()}
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
