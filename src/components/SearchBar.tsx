import { Plus, Search, X } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import type { SearchResult } from '../shared/types'

interface SearchBarProps {
  onAdd: (stock: SearchResult) => void
  existingQuoteIds: Set<string>
  onError: (message: string) => void
}

export function SearchBar({ onAdd, existingQuoteIds, onError }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const normalized = deferredQuery.trim()
    if (!normalized) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    const timer = window.setTimeout(() => {
      stockApi.searchStocks(normalized)
        .then((items) => {
          setResults(items)
          setOpen(true)
        })
        .catch((error: unknown) => onError(error instanceof Error ? error.message : '搜索失败'))
        .finally(() => setSearching(false))
    }, 220)

    return () => window.clearTimeout(timer)
  }, [deferredQuery, onError])

  const choose = (stock: SearchResult) => {
    onAdd(stock)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const addFirst = () => {
    if (results[0]) choose(results[0])
  }

  return (
    <div className="search-composer" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <div className={`search-field ${open && query ? 'is-open' : ''}`}>
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => query && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addFirst()
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="输入股票代码或名称"
          aria-label="搜索股票"
        />
        {searching ? <span className="search-loader" aria-label="正在搜索" /> : null}
        {query && !searching ? (
          <button className="clear-search" onClick={() => setQuery('')} aria-label="清空搜索">
            <X size={15} />
          </button>
        ) : null}
      </div>
      <button className="primary-button" onClick={addFirst} disabled={!results[0]}>
        <Plus size={17} />
        添加自选
      </button>

      {open && query ? (
        <div className="search-results" role="listbox">
          {results.length > 0 ? results.map((stock) => {
            const exists = existingQuoteIds.has(stock.quoteId)
            return (
              <button key={stock.quoteId} className="search-result" onClick={() => choose(stock)} role="option">
                <span className="search-result-main">
                  <strong>{stock.name}</strong>
                  <span>{stock.code}</span>
                </span>
                <span className="search-result-market">{stock.marketLabel}</span>
                <span className={exists ? 'already-added' : 'result-action'}>{exists ? '已添加' : '添加'}</span>
              </button>
            )
          }) : (
            <div className="empty-search">未找到匹配的 A 股</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
