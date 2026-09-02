import { Folders, Search, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type { StockMarket, WatchStock } from '../../shared/types'
import { TableFilterDropdown, type TableFilterOption } from '../TableFilterDropdown'

interface TableStockSearchProps {
  stocks: WatchStock[]
  onChoose: (quoteId: string) => void
}

function TableStockSearch({ stocks, onChoose }: TableStockSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return stocks
    return stocks.filter(
      (stock) =>
        stock.name.toLocaleLowerCase('zh-CN').includes(normalized) ||
        stock.code.includes(normalized)
    )
  }, [query, stocks])

  const choose = (quoteId: string) => {
    setQuery('')
    setOpen(false)
    onChoose(quoteId)
  }

  return (
    <div
      className="table-stock-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className={`table-stock-search-field ${open ? 'is-open' : ''}`}>
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) choose(results[0].quoteId)
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder="搜索当前股票"
          aria-label="搜索当前表格股票"
          aria-expanded={open}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setOpen(true)
            }}
            aria-label="清空表格搜索"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="table-stock-search-results" role="listbox">
          {results.length > 0 ? (
            results.map((stock) => (
              <button
                className="table-stock-search-result"
                type="button"
                role="option"
                key={stock.quoteId}
                onClick={() => choose(stock.quoteId)}
              >
                <strong>{stock.name}</strong>
                <span>{stock.code}</span>
                <small>{stock.marketLabel}</small>
              </button>
            ))
          ) : (
            <div className="table-stock-search-empty">当前表格中没有匹配股票</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface WatchlistFiltersProps {
  customGroupFilter: string
  customGroupOptions: TableFilterOption[]
  sectorFilter: string
  sectorOptions: TableFilterOption[]
  marketFilter: StockMarket | 'all'
  marketOptions: TableFilterOption[]
  displayedStocks: WatchStock[]
  onCustomGroupChange: (value: string) => void
  onSectorChange: (value: string) => void
  onMarketChange: (value: StockMarket | 'all') => void
  onManageGroups: () => void
  onChooseStock: (quoteId: string) => void
}

export function WatchlistFilters({
  customGroupFilter,
  customGroupOptions,
  sectorFilter,
  sectorOptions,
  marketFilter,
  marketOptions,
  displayedStocks,
  onCustomGroupChange,
  onSectorChange,
  onMarketChange,
  onManageGroups,
  onChooseStock
}: WatchlistFiltersProps) {
  return (
    <Fragment>
      <TableFilterDropdown
        label=""
        value={marketFilter}
        options={marketOptions}
        onChange={(value) => onMarketChange(value as StockMarket | 'all')}
      />
      <TableFilterDropdown
        label=""
        value={customGroupFilter}
        options={customGroupOptions}
        onChange={onCustomGroupChange}
      />
      <TableFilterDropdown
        label=""
        value={sectorFilter}
        options={sectorOptions}
        searchable
        searchPlaceholder="搜索板块"
        onChange={onSectorChange}
      />
      <button className="secondary-button table-tool-button" type="button" onClick={onManageGroups}>
        <Folders size={15} />
        管理分组
      </button>
      <TableStockSearch stocks={displayedStocks} onChoose={onChooseStock} />
    </Fragment>
  )
}
