import { formatAmount, formatPercent, formatPrice } from '../../../lib/format'
import type { IndicatorValue } from '../shared/types'

interface IndicatorGridProps {
  title: string
  values: readonly IndicatorValue[]
  headingValueId?: string
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

export function IndicatorGrid({ title, values, headingValueId }: IndicatorGridProps) {
  if (values.length === 0) return null
  const headingValue = headingValueId
    ? values.find((value) => value.id === headingValueId)
    : undefined
  const gridValues = headingValue
    ? values.filter((value) => value.id !== headingValue.id)
    : values
  return (
    <section className="insight-indicator-section">
      <div className="insight-indicator-heading">
        <h3>{title}</h3>
        {headingValue ? (
          <span className="insight-heading-value" title={`数据周期：${headingValue.sourcePeriod}`}>
            <span>{headingValue.label}</span>
            <strong className={`is-${headingValue.state}`}>{formatIndicator(headingValue)}</strong>
          </span>
        ) : null}
      </div>
      {gridValues.length > 0 ? (
        <div className="insight-indicator-grid">
          {gridValues.map((value) => (
            <div className="insight-indicator" key={value.id} title={`数据周期：${value.sourcePeriod}`}>
              <span>{value.label}</span>
              <strong className={`is-${value.state}`}>{formatIndicator(value)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
