import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AppButton } from './AppButton'
import { AppInput } from './AppFormControls'
import './AppSelect.css'

export interface AppSelectOption<Value extends string> {
  value: Value
  label: string
  description?: string
  badge?: string
  badgeTone?: 'info' | 'success'
}

interface AppSelectProps<Value extends string> {
  value: Value
  options: readonly AppSelectOption<Value>[]
  label: string
  className?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  portal?: boolean
  onChange: (value: Value) => void
}

export function AppSelect<Value extends string>({
  value,
  options,
  label,
  className = '',
  disabled = false,
  searchable = false,
  searchPlaceholder = '搜索选项',
  portal = false,
  onChange
}: AppSelectProps<Value>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties>()
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.description ?? ''}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery)
      )
    : options

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    if (portal) {
      document.addEventListener('scroll', closeOnScroll, true)
      window.addEventListener('resize', close)
    }
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, portal])

  const toggle = () => {
    if (!open) {
      setQuery('')
      if (portal) {
        const rect = rootRef.current!.getBoundingClientRect()
        const width = Math.max(rect.width, 178)
        const below = window.innerHeight - rect.bottom - 12
        const above = rect.top - 12
        const placeAbove = below < 240 && above > below
        setMenuStyle({
          width,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          top: placeAbove ? undefined : rect.bottom + 5,
          bottom: placeAbove ? window.innerHeight - rect.top + 5 : undefined,
          maxHeight: Math.min(300, placeAbove ? above : below)
        })
      }
    }
    setOpen((current) => !current)
  }

  const choose = (nextValue: Value) => {
    onChange(nextValue)
    setOpen(false)
  }

  const menu =
    open && !disabled ? (
      <div
        className={`app-select-menu${portal ? ' is-portal' : ''}`}
        ref={menuRef}
        style={portal ? menuStyle : undefined}
      >
        {searchable ? (
          <label className="app-select-search">
            <Search size={14} aria-hidden="true" />
            <AppInput
              autoFocus
              value={query}
              placeholder={searchPlaceholder}
              aria-label={`${label}：${searchPlaceholder}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && filteredOptions[0]) {
                  event.preventDefault()
                  choose(filteredOptions[0].value)
                }
              }}
            />
          </label>
        ) : null}
        <div className="app-select-options" id={menuId} role="listbox" aria-label={label}>
          {filteredOptions.map((option) => {
            const selected = option.value === value
            return (
              <AppButton
                variant="plain"
                className={`app-select-option ${selected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                key={option.value}
                onClick={() => choose(option.value)}
              >
                <Check size={14} />
                <span className="app-select-option-content">
                  <span className="app-select-option-heading">
                    <strong>{option.label}</strong>
                    {option.badge ? (
                      <span className={`app-select-badge is-${option.badgeTone ?? 'info'}`}>
                        {option.badge}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </AppButton>
            )
          })}
          {filteredOptions.length === 0 ? (
            <div className="app-select-empty">没有匹配的选项</div>
          ) : null}
        </div>
      </div>
    ) : null

  return (
    <div className={`app-select ${className}`.trim()} ref={rootRef}>
      <AppButton
        variant="plain"
        className={`app-select-trigger ${open && !disabled ? 'is-open' : ''}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={menuId}
        aria-label={`${label}：${selectedOption.label}`}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="app-select-trigger-label">
          <span>{selectedOption.label}</span>
          {selectedOption.badge ? (
            <span className={`app-select-badge is-${selectedOption.badgeTone ?? 'info'}`}>
              {selectedOption.badge}
            </span>
          ) : null}
        </span>
        <ChevronDown size={14} />
      </AppButton>
      {menu && portal ? createPortal(menu, document.body) : menu}
    </div>
  )
}
