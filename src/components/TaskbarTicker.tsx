import { useEffect, useMemo, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice } from '../lib/format'
import type { AppState, StockQuote } from '../shared/types'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

export function TaskbarTicker() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])

  useEffect(() => {
    void stockApi.getBootstrap().then((bootstrap) => {
      setState(bootstrap.state)
      setQuotes(bootstrap.quotes)
    })

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    return () => {
      unsubscribeQuotes()
      unsubscribeState()
    }
  }, [])

  const selectedStocks = useMemo(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return state.watchlist
      .filter((stock) => stock.showInTaskbar)
      .map((stock) => ({ stock, quote: quoteMap.get(stock.quoteId) }))
  }, [quotes, state.watchlist])

  return (
    <div className={`taskbar-ticker ${selectedStocks.length === 1 ? 'is-single' : ''}`}>
      {selectedStocks.map(({ stock, quote }) => {
        const direction = directionClass(quote?.changePercent)
        const arrow = direction === 'is-up' ? '↑' : direction === 'is-down' ? '↓' : '·'
        return (
          <div className={`taskbar-quote ${direction}`} key={stock.quoteId}>
            <span className="taskbar-stock-name">{stock.name}</span>
            <span className="taskbar-stock-arrow">{arrow}</span>
            <strong>{formatPrice(quote?.latest)}</strong>
            <span className="taskbar-stock-change">{formatPercent(quote?.changePercent)}</span>
          </div>
        )
      })}
    </div>
  )
}
