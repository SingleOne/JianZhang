import { useEffect, useMemo, useState } from 'react'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatSigned,
  formatShares
} from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { stockTOverview } from '../lib/stock-accounts'
import { getTaskbarVisibleStocks } from '../lib/taskbar-visibility'
import type { AppState, StockQuote } from '../shared/types'

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
      const account = state.stockTradingBooks[stock.quoteId]
      const overview = stockTOverview(account, quote?.latest, {
        market: stock.market ?? 'CN',
        instrumentType: stock.instrumentType,
        feeState: {
          securitiesAccounts: state.securitiesAccounts,
          feeSchemes: state.feeSchemes,
          settings: state.settings
        }
      })
      const profitOverride = calculateCurrentPositionProfitOverride(
        stock,
        quote,
        account,
        state.settings.exchangeRates,
        state.portfolioPerformanceAdjustments?.[stock.quoteId] ?? 0
      )
      return {
        stock,
        quote,
        positionMetrics: calculatePositionMetrics(
          stock.position,
          quote,
          account,
          state.settings.exchangeRates,
          profitOverride
        ),
        tSummaries: overview.summaries
      }
    })
  }, [
    quotes,
    state.portfolioPerformanceAdjustments,
    state.settings,
    state.securitiesAccounts,
    state.feeSchemes,
    state.stockTradingBooks,
    state.watchlist
  ])
  const todayProfitTotal = selectedStocks.reduce<number | null>(
    (total, { positionMetrics }) =>
      positionMetrics.cnyTodayProfit === null
        ? total
        : (total ?? 0) + positionMetrics.cnyTodayProfit,
    null
  )

  return (
    <aside className="tray-summary-panel">
      <header>
        <span>今日收益与 T 仓概览</span>
        <span className="tray-summary-total">
          今日收益合计
          <b className={valueClass(todayProfitTotal)}>
            {formatMoneyProfit(todayProfitTotal, 'CNY')}
          </b>
        </span>
      </header>
      <div className="tray-summary-list">
        {selectedStocks.map(({ stock, quote, positionMetrics, tSummaries }) => (
          <section className="tray-summary-item" key={stock.quoteId}>
            <div className="tray-summary-heading">
              <div className="tray-summary-stock">
                <strong>{stock.name}</strong>
                <b className={valueClass(quote?.change)}>
                  {formatPrice(quote?.latest)}（{formatSigned(quote?.change)}）
                </b>
              </div>
              <span>
                今日
                <b className={valueClass(positionMetrics.todayProfit)}>
                  {formatMoneyProfit(positionMetrics.todayProfit, positionMetrics.currency)}
                </b>
                <b className={valueClass(positionMetrics.todayProfitPercent)}>
                  {formatPercent(positionMetrics.todayProfitPercent)}
                </b>
              </span>
            </div>
            <div className="tray-summary-profit">
              <span>
                持仓 <b>{formatMoney(positionMetrics.marketValue, positionMetrics.currency)}</b>
              </span>
              <span>
                <b className={valueClass(positionMetrics.totalProfit)}>
                  {formatMoneyProfit(positionMetrics.totalProfit, positionMetrics.currency)}
                </b>
                <b className={valueClass(positionMetrics.profitPercent)}>
                  {formatPercent(positionMetrics.profitPercent)}
                </b>
              </span>
            </div>
            {tSummaries.length ? (
              tSummaries.map(({ account: owner, metrics: tMetrics }) => (
                <div className="tray-summary-t" key={owner.accountId}>
                  <span>{owner.accountName}</span>
                  <span>
                    {tMetrics.direction === 'reverse' ? '反T' : '正T'}{' '}
                    {formatShares(tMetrics.remainingQuantity)}
                  </span>
                  <span>
                    {tMetrics.direction === 'reverse' ? '基准' : '成本'}{' '}
                    {formatCost(tMetrics.averageCost)}
                  </span>
                  <span className={valueClass(tMetrics.floatingProfit)}>
                    浮动 {formatMoneyProfit(tMetrics.floatingProfit, positionMetrics.currency)}
                    {tMetrics.floatingProfitRate === null ? null : (
                      <small className="tray-summary-floating-rate">
                        ({formatPercent(tMetrics.floatingProfitRate)})
                      </small>
                    )}
                  </span>
                </div>
              ))
            ) : (
              <div className="tray-summary-t is-empty">暂无进行中的 T 仓</div>
            )}
          </section>
        ))}
      </div>
    </aside>
  )
}
