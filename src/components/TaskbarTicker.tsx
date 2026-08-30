import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice } from '../lib/format'
import { getTriggeredTAlertBadges, getTriggeredTFloatingProfitAlert } from '../lib/t-alerts'
import { calculateTBatchMetrics } from '../lib/t-trading'
import { getBatchTrades } from '../lib/trade-records'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import { getTaskbarVisibleStocks } from '../lib/taskbar-visibility'
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
      const account = state.tTradingAccounts[stock.quoteId]
      return {
        stock,
        quote,
        alertBadges: getTriggeredTAlertBadges(
          account?.activeBatch,
          getBatchTrades(account, account?.activeBatch)
        ),
        tMetrics: account?.activeBatch
          ? calculateTBatchMetrics(
              account.activeBatch,
              getBatchTrades(account, account.activeBatch),
              quote?.latest
            )
          : null,
        floatingProfitAlert: getTriggeredTFloatingProfitAlert(account?.activeBatch),
        fiveLevelAlerts: account?.activeBatch ? quote?.fiveLevelLargeOrders : undefined,
        stockAlertDirection: getTriggeredStockAlertDirection(stock.alertRules)
      }
    })
  }, [quotes, state.tTradingAccounts, state.watchlist])

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
          ({
            stock,
            quote,
            alertBadges,
            tMetrics,
            floatingProfitAlert,
            fiveLevelAlerts,
            stockAlertDirection
          }) => {
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
                {floatingProfitAlert ? (
                  <TFloatingProfitAlertBadge
                    batch={state.tTradingAccounts[stock.quoteId]?.activeBatch}
                    floatingProfit={tMetrics?.floatingProfit}
                    compact
                    showTitle={false}
                  />
                ) : null}
              </div>
            )
          }
        )}
      </div>
    </div>
  )
}
