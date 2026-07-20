import { formatPercent, formatPrice, formatShares } from '../../../lib/format'
import type { TPlanDistance } from '../shared/types'

interface TPlanDistanceCardProps {
  distances: readonly TPlanDistance[]
}

export function TPlanDistanceCard({ distances }: TPlanDistanceCardProps) {
  return (
    <section className="insight-section">
      <h3>与既有 T 计划的距离</h3>
      {distances.length === 0 ? <p className="insight-empty">当前没有可读取的 T 仓均价或既有双五档计划。</p> : (
        <div className="insight-t-levels">
          {distances.map((item) => (
            <div className={item.isNear ? 'is-near' : ''} key={item.id}>
              <span>{item.label}{item.isNearest ? <b>最近</b> : null}</span>
              <strong>{formatPrice(item.price)}</strong>
              <em className={item.distancePercent === null || item.distancePercent === 0 ? 'is-flat' : item.distancePercent > 0 ? 'is-up' : 'is-down'}>
                {formatPercent(item.distancePercent)}
              </em>
              <small>{item.quantity === null ? '' : formatShares(item.quantity)}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
