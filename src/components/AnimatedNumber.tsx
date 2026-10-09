import { memo, useState, type CSSProperties } from 'react'
import './AnimatedNumber.css'

type NumberValue = number | null | undefined

interface AnimatedNumberProps {
  value: NumberValue
  formatValue?: (value: NumberValue) => string
  className?: string
  durationMs?: number
}

interface NumberDisplay {
  value: NumberValue
  text: string
  previousText: string | null
  direction: 'up' | 'down' | null
  revision: number
}

function formatNumber(value: NumberValue): string {
  return value === null || value === undefined ? '--' : String(value)
}

/** Slides the whole number in the direction of its change, using the supplied display format. */
export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  formatValue = formatNumber,
  className = '',
  durationMs = 1000
}: AnimatedNumberProps) {
  const text = formatValue(value)
  const [display, setDisplay] = useState<NumberDisplay>(() => ({
    value,
    text,
    previousText: null,
    direction: null,
    revision: 0
  }))

  // Keep the previous committed display for the transition without an effect or a delayed update.
  if (!Object.is(value, display.value) || text !== display.text) {
    let direction: NumberDisplay['direction'] = null
    if (
      value !== null &&
      value !== undefined &&
      display.value !== null &&
      display.value !== undefined &&
      value !== display.value &&
      text !== display.text
    ) {
      direction = value > display.value ? 'up' : 'down'
    }
    setDisplay({
      value,
      text,
      previousText: direction ? display.text : null,
      direction,
      revision: display.revision + 1
    })
  }

  return (
    <span
      className={`animated-number ${className}`.trim()}
      style={{ '--animated-number-duration': `${durationMs}ms` } as CSSProperties}
    >
      <span
        key={display.revision}
        className="animated-number-motion"
        data-direction={display.direction ?? undefined}
      >
        {display.previousText !== null ? (
          <span className="animated-number-previous" aria-hidden="true">
            {display.previousText}
          </span>
        ) : null}
        <span
          className="animated-number-current"
          onAnimationEnd={() => {
            setDisplay((current) =>
              current.revision === display.revision
                ? { ...current, previousText: null, direction: null }
                : current
            )
          }}
        >
          {display.text}
        </span>
      </span>
    </span>
  )
})
