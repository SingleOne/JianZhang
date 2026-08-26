import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

export interface AppSelectOption<Value extends string> {
  value: Value
  label: string
  description?: string
}

interface AppSelectProps<Value extends string> {
  value: Value
  options: readonly AppSelectOption<Value>[]
  label: string
  className?: string
  onChange: (value: Value) => void
}

export function AppSelect<Value extends string>({
  value,
  options,
  label,
  className = '',
  onChange
}: AppSelectProps<Value>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = (nextValue: Value) => {
    onChange(nextValue)
    setOpen(false)
  }

  return (
    <div className={`app-select ${className}`.trim()} ref={rootRef}>
      <button
        className={`app-select-trigger ${open ? 'is-open' : ''}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${label}：${selectedOption.label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="app-select-menu" id={menuId} role="listbox" aria-label={label}>
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                className={`app-select-option ${selected ? 'is-selected' : ''}`}
                type="button"
                role="option"
                aria-selected={selected}
                key={option.value}
                onClick={() => choose(option.value)}
              >
                <Check size={14} />
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
