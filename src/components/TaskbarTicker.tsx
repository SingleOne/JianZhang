import { stockTOverview } from '../lib/stock-accounts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice } from '../lib/format'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import { getTaskbarVisibleStocks } from '../lib/taskbar-visibility'
import { marketFromQuoteId } from '../shared/stock-market'
import type { AppState, StockQuote } from '../shared/types'
import { FiveLevelAlertBadges } from './FiveLevelAlertBadges'
import { TAlertBadges } from './TAlertBadges'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

export function TaskbarTicker() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const tickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)

    void getInitialBootstrap().then((bootstrap) => {
      if (!active) return
      setState(bootstrap.state)
      setQuotes(bootstrap.quotes)
    })

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
    }
  }, [])

  const selectedStocks = useMemo(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return getTaskbarVisibleStocks(state.watchlist).map((stock) => {
      const quote = quoteMap.get(stock.quoteId)
      const overview = stockTOverview(state.stockTradingBooks[stock.quoteId], quote?.latest, {
        market: stock.market ?? marketFromQuoteId(stock.quoteId),
        instrumentType: stock.instrumentType
      })
      return {
        stock,
        quote,
        alertBadges: overview.badges,
        floatingAlerts: overview.floatingAlerts,
        fiveLevelAlerts: overview.summaries.length ? quote?.fiveLevelLargeOrders : undefined,
        stockAlertDirection: getTriggeredStockAlertDirection(stock.alertRules)
      }
    })
  }, [quotes, state.stockTradingBooks, state.watchlist])

  useLayoutEffect(() => {
    const ticker = tickerRef.current
    if (!ticker || selectedStocks.length === 0) return
    const bounds = ticker.getBoundingClientRect()
    void stockApi.resizeTaskbarTicker(Math.ceil(bounds.width), Math.ceil(bounds.height))
  }, [selectedStocks])

  return (
    <div className="taskbar-ticker-shell">
      <div
        ref={tickerRef}
        className={`taskbar-ticker ${selectedStocks.length === 1 ? 'is-single' : ''}`}
      >
        {selectedStocks.map(
          ({ stock, quote, alertBadges, floatingAlerts, fiveLevelAlerts, stockAlertDirection }) => {
            const direction = directionClass(quote?.changePercent)
            return (
              <div
                className={`taskbar-quote ${direction} ${stockAlertDirection ? `is-stock-alert-triggered is-alert-${stockAlertDirection}` : ''}`}
                key={stock.quoteId}
                onMouseEnter={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  void stockApi.setTaskbarTooltip({
                    quoteId: stock.quoteId,
                    left: bounds.left,
                    width: bounds.width
                  })
                }}
                onMouseLeave={() => void stockApi.setTaskbarTooltip(null)}
              >
                <span className="taskbar-stock-name">{stock.name}</span>
                <strong>{formatPrice(quote?.latest)}</strong>
                <span className="taskbar-stock-change">{formatPercent(quote?.changePercent)}</span>
                <FiveLevelAlertBadges alerts={fiveLevelAlerts} compact showTitle={false} />
                <TAlertBadges badges={alertBadges} compact showTitle={false} />
                {floatingAlerts.map((summary) => (
                  <TFloatingProfitAlertBadge
                    key={summary.account.accountId}
                    accountName={summary.account.accountName}
                    batch={summary.batch}
                    floatingProfit={summary.metrics.floatingProfit}
                    currency={stock.currency ?? quote?.currency ?? 'CNY'}
                    compact
                    showTitle={false}
                  />
                ))}
              </div>
            )
          }
        )}
      </div>
    </div>
  )
}
