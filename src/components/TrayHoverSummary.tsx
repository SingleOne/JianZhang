import { useEffect, useMemo, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatProfit,
  formatSigned,
  formatShares
} from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import {
  getTriggeredTAlertBadges,
  getTriggeredTFloatingProfitAlert
} from '../lib/t-alerts'
import { calculateTBatchMetrics } from '../lib/t-trading'
import { getBatchTrades } from '../lib/trade-records'
import type { AppState, StockQuote } from '../shared/types'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function TrayHoverSummary() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])

  useEffect(() => {
    let active = true
    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)

    void stockApi.getBootstrap().then((bootstrap) => {
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
    return state.watchlist
      .map((stock) => {
        const quote = quoteMap.get(stock.quoteId)
        const account = state.tTradingAccounts[stock.quoteId]
        const activeTrades = getBatchTrades(account, account?.activeBatch)
        const alertBadges = getTriggeredTAlertBadges(account?.activeBatch, activeTrades)
        return {
          stock,
          quote,
          alertBadges,
          hasFiveLevelAlert: Boolean(account?.activeBatch) && Boolean(quote?.fiveLevelLargeOrders?.length),
          positionMetrics: calculatePositionMetrics(stock.position, quote, account),
          tMetrics: account?.activeBatch
            ? calculateTBatchMetrics(account.activeBatch, activeTrades, quote?.latest)
            : null,
          floatingProfitAlert: getTriggeredTFloatingProfitAlert(account?.activeBatch)
        }
      })
      .filter(({ stock, alertBadges, hasFiveLevelAlert, floatingProfitAlert }) => (
        stock.showInTaskbar || alertBadges.length > 0 || hasFiveLevelAlert || Boolean(floatingProfitAlert)
      ))
  }, [quotes, state.tTradingAccounts, state.watchlist])
  const todayProfitTotal = selectedStocks.reduce<number | null>((total, { positionMetrics }) => (
    positionMetrics.todayProfit === null
      ? total
      : (total ?? 0) + positionMetrics.todayProfit
  ), null)

  return (
    <aside className="tray-summary-panel">
      <header>
        <span>今日收益与 T 仓概览</span>
        <span className="tray-summary-total">
          今日收益合计
          <b className={valueClass(todayProfitTotal)}>{formatProfit(todayProfitTotal)}</b>
        </span>
      </header>
      <div className="tray-summary-list">
        {selectedStocks.map(({ stock, quote, positionMetrics, tMetrics, floatingProfitAlert }) => (
          <section className="tray-summary-item" key={stock.quoteId}>
            <div className="tray-summary-heading">
              <div className="tray-summary-stock">
                <strong>{stock.name}</strong>
                <b className={valueClass(quote?.change)}>
                  {formatPrice(quote?.latest)}（{formatSigned(quote?.change)}）
                </b>
              </div>
              <span>
                今日收益
                <b className={valueClass(positionMetrics.todayProfit)}>
                  {formatProfit(positionMetrics.todayProfit)}
                </b>
                <b className={valueClass(positionMetrics.todayProfitPercent)}>
                  {formatPercent(positionMetrics.todayProfitPercent)}
                </b>
              </span>
            </div>
            <div className="tray-summary-profit">
              <span>持仓市值 <b>{formatCurrency(positionMetrics.marketValue)}</b></span>
              <span>
                持仓收益
                <b className={valueClass(positionMetrics.totalProfit)}>
                  {formatProfit(positionMetrics.totalProfit)}
                </b>
                <b className={valueClass(positionMetrics.profitPercent)}>
                  {formatPercent(positionMetrics.profitPercent)}
                </b>
              </span>
            </div>
            {tMetrics ? (
              <div className="tray-summary-t">
                <span>{tMetrics.direction === 'reverse' ? '反T待回补' : '正T持有'} {formatShares(tMetrics.remainingQuantity)}</span>
                <span>{tMetrics.direction === 'reverse' ? '基准价' : '成本'} {formatCost(tMetrics.averageCost)}</span>
                <span className={valueClass(tMetrics.floatingProfit)}>
                  浮动 {formatProfit(tMetrics.floatingProfit)}
                  {tMetrics.floatingProfitRate === null ? null : (
                    <small className="tray-summary-floating-rate">
                      ({formatPercent(tMetrics.floatingProfitRate)})
                    </small>
                  )}
                  {floatingProfitAlert ? (
                    <TFloatingProfitAlertBadge
                      batch={state.tTradingAccounts[stock.quoteId]?.activeBatch}
                      floatingProfit={tMetrics.floatingProfit}
                      compact
                    />
                  ) : null}
                </span>
              </div>
            ) : (
              <div className="tray-summary-t is-empty">暂无进行中的 T 仓</div>
            )}
          </section>
        ))}
      </div>
    </aside>
  )
}
