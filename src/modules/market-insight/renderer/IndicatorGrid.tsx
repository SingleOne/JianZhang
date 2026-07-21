import { CircleHelp, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatAmount, formatPercent, formatPrice } from '../../../lib/format'
import type { IndicatorValue } from '../shared/types'
import type { IndicatorExplanation } from './indicator-explanations'

interface IndicatorGridProps {
  title: string
  values: readonly IndicatorValue[]
  headingValueId?: string
  explanations?: Readonly<Record<string, IndicatorExplanation>>
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

interface IndicatorExplanationPopoverProps {
  groupTitle: string
  value: IndicatorValue
  explanation: IndicatorExplanation
  onClose: () => void
}

function IndicatorExplanationPopover({
  groupTitle,
  value,
  explanation,
  onClose
}: IndicatorExplanationPopoverProps) {
  const titleId = `indicator-explanation-${value.id}`
  return createPortal(
    <div className="insight-indicator-help-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="insight-indicator-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <header>
          <div>
            <small>{groupTitle} · {value.sourcePeriod}指标说明</small>
            <h4 id={titleId}>{value.label}</h4>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label={`关闭${value.label}说明`} title="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="insight-indicator-help-content">
          <p>{explanation.definition}</p>
          <section>
            <strong>计算方式</strong>
            <p className="insight-indicator-help-formula">{explanation.formula}</p>
          </section>
          <section>
            <strong>如何理解</strong>
            <ul>
              {explanation.interpretation.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section>
            <strong>使用提醒</strong>
            <p>{explanation.note}</p>
          </section>
        </div>
        <footer>
          <span>当前值</span>
          <strong className={`is-${value.state}`}>{formatIndicator(value)}</strong>
          <small>使用已完成的{value.sourcePeriod}数据计算</small>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function IndicatorGrid({ title, values, headingValueId, explanations }: IndicatorGridProps) {
  const [explainedIndicatorId, setExplainedIndicatorId] = useState<string | null>(null)
  if (values.length === 0) return null
  const headingValue = headingValueId
    ? values.find((value) => value.id === headingValueId)
    : undefined
  const gridValues = headingValue
    ? values.filter((value) => value.id !== headingValue.id)
    : values
  const explainedValue = explainedIndicatorId
    ? gridValues.find((value) => value.id === explainedIndicatorId)
    : undefined
  const explanation = explainedValue ? explanations?.[explainedValue.id] : undefined
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
            <div className={`insight-indicator ${explanations?.[value.id] ? 'has-description' : ''}`} key={value.id} title={`数据周期：${value.sourcePeriod}`}>
              {explanations?.[value.id] ? (
                <button
                  className="insight-indicator-label-button"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={explainedIndicatorId === value.id}
                  onClick={() => setExplainedIndicatorId(value.id)}
                  title={`点击查看${value.label}说明`}
                >
                  <span>{value.label}</span>
                  <CircleHelp size={11} />
                </button>
              ) : <span>{value.label}</span>}
              <strong className={`is-${value.state}`}>{formatIndicator(value)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {explainedValue && explanation ? (
        <IndicatorExplanationPopover
          groupTitle={title}
          value={explainedValue}
          explanation={explanation}
          onClose={() => setExplainedIndicatorId(null)}
        />
      ) : null}
    </section>
  )
}
