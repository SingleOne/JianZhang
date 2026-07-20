import { formatPercent, formatPrice, formatShares } from '../../../lib/format'
import type { TPlanDistance } from '../shared/types'

interface TPlanDistanceCardProps {
  distances: readonly TPlanDistance[]
}

export function TPlanDistanceCard({ distances }: TPlanDistanceCardProps) {
  const position = distances.find((item) => item.side === 'position')
  const buyLevels = distances.filter((item) => item.side === 'buy')
  const sellLevels = distances.filter((item) => item.side === 'sell')
  const distanceClass = (item: TPlanDistance) => (
    item.distancePercent === null || item.distancePercent === 0
      ? 'is-flat'
      : item.distancePercent > 0 ? 'is-up' : 'is-down'
  )
  const levelCards = (items: readonly TPlanDistance[]) => (
    <div className="insight-t-levels">
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.label}{item.isNearest ? <b>最近</b> : null}</span>
          <strong>{formatPrice(item.price)}</strong>
          <em className={distanceClass(item)}>{formatPercent(item.distancePercent)}</em>
          <small>{item.quantity === null ? '' : formatShares(item.quantity)}</small>
        </div>
      ))}
    </div>
  )

  return (
    <section className="insight-section">
      <div className="insight-t-heading">
        <h3>与既有 T 计划的距离</h3>
        {position ? (
          <span className="insight-t-heading-metric">
            <span>T 仓均价</span>
            <strong>{formatPrice(position.price)}</strong>
            <em className={distanceClass(position)}>{formatPercent(position.distancePercent)}</em>
            <small>{position.quantity === null ? '' : formatShares(position.quantity)}</small>
          </span>
        ) : null}
      </div>
      {distances.length === 0 ? <p className="insight-empty">当前没有可读取的 T 仓均价或既有双五档计划。</p> : (
        buyLevels.length > 0 || sellLevels.length > 0 ? (
          <div className="insight-t-plan-rows">
            {buyLevels.length > 0 ? (
              <div className="insight-t-plan-row is-buy">
                <strong>买入档</strong>
                {levelCards(buyLevels)}
              </div>
            ) : null}
            {sellLevels.length > 0 ? (
              <div className="insight-t-plan-row is-sell">
                <strong>卖出档</strong>
                {levelCards(sellLevels)}
              </div>
            ) : null}
          </div>
        ) : <p className="insight-empty">当前没有既有双五档计划。</p>
      )}
    </section>
  )
}
