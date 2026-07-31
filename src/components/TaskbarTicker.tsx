import { useEffect, useMemo, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice } from '../lib/format'
import { getTriggeredTAlertBadges } from '../lib/t-alerts'
import { getBatchTrades } from '../lib/trade-records'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import type { AppState, StockQuote, TaskbarLayout } from '../shared/types'
import { FiveLevelAlertBadges } from './FiveLevelAlertBadges'
import { TAlertBadges } from './TAlertBadges'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

export function TaskbarTicker() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [layout, setLayout] = useState<TaskbarLayout>({ taskbarHeight: 48 })

  useEffect(() => {
    let active = true
    let receivedLayoutEvent = false

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeLayout = stockApi.onTaskbarLayout((nextLayout) => {
      receivedLayoutEvent = true
      setLayout(nextLayout)
    })

    void Promise.all([
      stockApi.getBootstrap(),
      stockApi.getTaskbarLayout()
    ]).then(([bootstrap, taskbarLayout]) => {
      if (!active) return
      setState(bootstrap.state)
      setQuotes(bootstrap.quotes)
      if (!receivedLayoutEvent) setLayout(taskbarLayout)
    })

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeLayout()
    }
  }, [])

  const selectedStocks = useMemo(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return state.watchlist
      .map((stock) => {
        const quote = quoteMap.get(stock.quoteId)
        const account = state.tTradingAccounts[stock.quoteId]
        return {
          stock,
          quote,
          alertBadges: getTriggeredTAlertBadges(
            account?.activeBatch,
            getBatchTrades(account, account?.activeBatch)
          ),
          fiveLevelAlerts: account?.activeBatch ? quote?.fiveLevelLargeOrders : undefined,
          stockAlertDirection: getTriggeredStockAlertDirection(stock.alertRules)
        }
      })
      .filter(({ stock, alertBadges, fiveLevelAlerts }) => (
        stock.showInTaskbar || alertBadges.length > 0 || Boolean(fiveLevelAlerts?.length)
      ))
  }, [quotes, state.tTradingAccounts, state.watchlist])

  return (
    <div className="taskbar-ticker-shell">
      <div
        className={`taskbar-ticker ${selectedStocks.length === 1 ? 'is-single' : ''}`}
        style={{ height: layout.taskbarHeight }}
      >
        {selectedStocks.map(({
          stock,
          quote,
          alertBadges,
          fiveLevelAlerts,
          stockAlertDirection
        }) => {
          const direction = directionClass(quote?.changePercent)
          const arrow = direction === 'is-up' ? '↑' : direction === 'is-down' ? '↓' : '·'
          return (
            <div
              className={`taskbar-quote ${direction} ${stockAlertDirection ? `is-stock-alert-triggered is-alert-${stockAlertDirection}` : ''}`}
              key={stock.quoteId}
            >
              <span className="taskbar-stock-name">{stock.name}</span>
              <FiveLevelAlertBadges alerts={fiveLevelAlerts} compact />
              <span className="taskbar-stock-arrow">{arrow}</span>
              <strong>{formatPrice(quote?.latest)}</strong>
              <span className="taskbar-stock-change">{formatPercent(quote?.changePercent)}</span>
              <TAlertBadges badges={alertBadges} compact />
            </div>
          )
        })}
      </div>
    </div>
  )
}
