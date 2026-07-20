import { formatAmount, formatPercent, formatPrice } from '../../../lib/format'
import type { IndicatorValue } from '../shared/types'

interface IndicatorGridProps {
  title: string
  values: readonly IndicatorValue[]
}

function formatIndicator(value: IndicatorValue): string {
  if (value.value === null) return '--'
  if (value.id === 'price-volume-state') return value.state === 'up' ? '量价同向走强' : value.state === 'down' ? '量价同向走弱' : '量价平衡'
  if (value.unit === 'price') return formatPrice(value.value)
  if (value.unit === 'percent') return formatPercent(value.value)
  if (value.unit === 'amount') return formatAmount(value.value)
  if (value.unit === 'ratio') return value.id.includes('imbalance')
    ? value.value.toFixed(2)
    : `${value.value.toFixed(2)} 倍`
  return value.value.toFixed(2)
}

export function IndicatorGrid({ title, values }: IndicatorGridProps) {
  if (values.length === 0) return null
  return (
    <section className="insight-indicator-section">
      <h3>{title}</h3>
      <div className="insight-indicator-grid">
        {values.map((value) => (
          <div className="insight-indicator" key={value.id} title={`数据周期：${value.sourcePeriod}`}>
            <span>{value.label}</span>
            <strong className={`is-${value.state}`}>{formatIndicator(value)}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}
