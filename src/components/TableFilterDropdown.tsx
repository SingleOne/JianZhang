import { Check, ChevronDown, ChevronsUpDown, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface TableFilterOption {
  value: string
  label: string
  count: number
  description?: string
}

interface TableFilterDropdownProps {
  label: string
  value: string
  options: TableFilterOption[]
  searchable?: boolean
  searchPlaceholder?: string
  onChange: (value: string) => void
}

export function TableFilterDropdown({
  label,
  value,
  options,
  searchable = false,
  searchPlaceholder = '搜索选项',
  onChange
}: TableFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return options
    return options.filter((option) => (
      option.label.toLocaleLowerCase('zh-CN').includes(normalized)
      || option.description?.toLocaleLowerCase('zh-CN').includes(normalized)
    ))
  }, [options, query])

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
    if (searchable) window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, searchable])

  const choose = (nextValue: string) => {
    onChange(nextValue)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={`table-filter-dropdown ${searchable ? 'is-searchable' : 'is-lightweight'}`} ref={rootRef}>
      <button
        className={`table-filter-trigger ${open ? 'is-open' : ''}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${label}：${selectedOption.label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <strong>{selectedOption.label}</strong>
        <b>{selectedOption.count}</b>
        {searchable ? <ChevronsUpDown size={14} /> : <ChevronDown size={14} />}
      </button>

      {open ? (
        <div className="table-filter-menu" id={menuId} role="listbox" aria-label={label}>
          {searchable ? (
            <label className="table-filter-command-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && filteredOptions[0]) choose(filteredOptions[0].value)
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </label>
          ) : null}
          <div className="table-filter-options">
            {filteredOptions.map((option) => {
              const selected = option.value === value
              return (
                <button
                  className={`table-filter-option ${selected ? 'is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  key={option.value}
                  onClick={() => choose(option.value)}
                >
                  <span className="table-filter-option-main">
                    <Check size={14} aria-hidden="true" />
                    <span>
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                  </span>
                  <b>{option.count}</b>
                </button>
              )
            })}
            {filteredOptions.length === 0 ? (
              <div className="table-filter-options-empty">没有匹配的板块</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
