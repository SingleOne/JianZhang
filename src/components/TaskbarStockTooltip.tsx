import { useEffect, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice, formatSigned, formatUpdateTime } from '../lib/format'
import type { AppState, StockQuote } from '../shared/types'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

export function TaskbarStockTooltip() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [quoteId, setQuoteId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let receivedTooltipEvent = false

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeTooltip = stockApi.onTaskbarTooltipStock((nextQuoteId) => {
      receivedTooltipEvent = true
      setQuoteId(nextQuoteId)
    })

    void Promise.all([stockApi.getBootstrap(), stockApi.getTaskbarTooltipQuoteId()]).then(
      ([bootstrap, currentQuoteId]) => {
        if (!active) return
        setState(bootstrap.state)
        setQuotes(bootstrap.quotes)
        if (!receivedTooltipEvent) setQuoteId(currentQuoteId)
      }
    )

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeTooltip()
    }
  }, [])

  const stock = state.watchlist.find((item) => item.quoteId === quoteId)
  const quote = quotes.find((item) => item.quoteId === quoteId)
  const direction = directionClass(quote?.changePercent)

  return (
    <div className="taskbar-stock-tooltip-shell">
      <article className={`taskbar-stock-tooltip ${direction}`}>
        <header>
          <span className="taskbar-tooltip-identity">
            <strong>{stock?.name ?? quote?.name ?? '--'}</strong>
            <span>{stock?.code ?? quote?.code ?? '--'}</span>
          </span>
          <span className="taskbar-tooltip-market">{stock?.marketLabel ?? '实时行情'}</span>
        </header>

        <div className="taskbar-tooltip-price-row">
          <strong>{formatPrice(quote?.latest)}</strong>
          <span>
            {formatSigned(quote?.change)} · {formatPercent(quote?.changePercent)}
          </span>
        </div>

        <dl className="taskbar-tooltip-details">
          <div>
            <dt>今开</dt>
            <dd>{formatPrice(quote?.open)}</dd>
          </div>
          <div>
            <dt>最高</dt>
            <dd>{formatPrice(quote?.high)}</dd>
          </div>
          <div>
            <dt>最低</dt>
            <dd>{formatPrice(quote?.low)}</dd>
          </div>
          <div>
            <dt>换手</dt>
            <dd>{formatPercent(quote?.turnoverRate)}</dd>
          </div>
        </dl>

        <footer>更新于 {formatUpdateTime(quote?.updatedAt)}</footer>
      </article>
    </div>
  )
}
