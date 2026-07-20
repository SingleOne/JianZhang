import { useEffect, useMemo, useRef, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares
} from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { getTriggeredTAlertBadges } from '../lib/t-alerts'
import { calculateTBatchMetrics } from '../lib/t-trading'
import type { AppState, StockQuote, TaskbarLayout } from '../shared/types'
import { TAlertBadges } from './TAlertBadges'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function TaskbarTicker() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [layout, setLayout] = useState<TaskbarLayout>({ taskbarHeight: 48, detailHeight: 110 })
  const [showDetails, setShowDetails] = useState(false)
  const hoverTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    void stockApi.getBootstrap().then((bootstrap) => {
      setState(bootstrap.state)
      setQuotes(bootstrap.quotes)
    })

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeLayout = stockApi.onTaskbarLayout(setLayout)
    return () => {
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeLayout()
      window.clearTimeout(hoverTimerRef.current)
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
          alertBadges: getTriggeredTAlertBadges(account?.activeBatch),
          positionMetrics: calculatePositionMetrics(stock.position, quote, account),
          tMetrics: account?.activeBatch
            ? calculateTBatchMetrics(account.activeBatch, quote?.latest)
            : null
        }
      })
      .filter(({ stock, alertBadges }) => stock.showInTaskbar || alertBadges.length > 0)
  }, [quotes, state.tTradingAccounts, state.watchlist])

  const startDetailTimer = () => {
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(() => setShowDetails(true), 1000)
  }

  const hideDetails = () => {
    window.clearTimeout(hoverTimerRef.current)
    setShowDetails(false)
  }

  return (
    <div className="taskbar-ticker-shell">
      <aside
        className={`taskbar-detail-panel ${showDetails ? 'is-visible' : ''}`}
        style={{
          bottom: layout.taskbarHeight + 8,
          maxHeight: Math.max(72, layout.detailHeight - 12)
        }}
        aria-hidden={!showDetails}
      >
        <header>今日收益与 T 仓概览</header>
        <div className="taskbar-detail-list">
          {selectedStocks.map(({ stock, positionMetrics, tMetrics }) => (
            <section className="taskbar-detail-item" key={stock.quoteId}>
              <div className="taskbar-detail-heading">
                <strong>{stock.name}</strong>
                <span>
                  今日
                  <b className={valueClass(positionMetrics.todayProfit)}>
                    {formatProfit(positionMetrics.todayProfit)}
                  </b>
                  <b className={valueClass(positionMetrics.todayProfitPercent)}>
                    {formatPercent(positionMetrics.todayProfitPercent)}
                  </b>
                </span>
              </div>
              {tMetrics ? (
                <div className="taskbar-detail-t">
                  <span>{tMetrics.direction === 'reverse' ? '反T待回补' : '正T持有'} {formatShares(tMetrics.remainingQuantity)}</span>
                  <span>{tMetrics.direction === 'reverse' ? '基准价' : '成本'} {formatCost(tMetrics.averageCost)}</span>
                  <span className={valueClass(tMetrics.floatingProfit)}>浮动 {formatProfit(tMetrics.floatingProfit)}</span>
                </div>
              ) : (
                <div className="taskbar-detail-t is-empty">暂无进行中的 T 仓</div>
              )}
            </section>
          ))}
        </div>
      </aside>

      <div
        className={`taskbar-ticker ${selectedStocks.length === 1 ? 'is-single' : ''}`}
        style={{ height: layout.taskbarHeight }}
        onMouseEnter={startDetailTimer}
        onMouseLeave={hideDetails}
      >
        {selectedStocks.map(({ stock, quote, alertBadges }) => {
          const direction = directionClass(quote?.changePercent)
          const arrow = direction === 'is-up' ? '↑' : direction === 'is-down' ? '↓' : '·'
          return (
            <div className={`taskbar-quote ${direction}`} key={stock.quoteId}>
              <span className="taskbar-stock-name">{stock.name}</span>
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
