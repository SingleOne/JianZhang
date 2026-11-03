import { stockTOverview } from '../lib/stock-accounts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, stockApi } from '../lib/api'
import { useAppData } from '../lib/data-center/hooks'
import { formatPercent, formatPrice } from '../lib/format'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import { getTaskbarVisibleStocks } from '../lib/taskbar-visibility'
import { marketFromQuoteId } from '../shared/stock-market'
import { evaluateStopLoss } from '../shared/stop-loss'
import { applyAppThemePreference } from '../lib/theme'
import { observeContentHeight } from '../lib/observe-content-height'
import { useInitialRenderReady } from '../hooks/useInitialRenderReady'
import { AnimatedNumber } from './AnimatedNumber'
import { FiveLevelAlertBadges } from './FiveLevelAlertBadges'
import { TAlertBadges } from './TAlertBadges'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'
import './StopLoss.css'

function directionClass(changePercent: number | null | undefined): string {
  if (changePercent === null || changePercent === undefined || changePercent === 0) return 'is-flat'
  return changePercent > 0 ? 'is-up' : 'is-down'
}

export function TaskbarTicker() {
  const state = useAppData((snapshot) => snapshot.state)
  const quotes = useAppData((snapshot) => snapshot.quotes)
  const [initialized, setInitialized] = useState(false)
  const tickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyAppThemePreference(state.settings.theme)
  }, [state.settings.theme])

  useInitialRenderReady(initialized)

  useEffect(() => {
    let active = true

    void getInitialBootstrap().then(() => {
      if (!active) return
      setInitialized(true)
    })

    return () => {
      active = false
    }
  }, [])

  const selectedStocks = useMemo(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return getTaskbarVisibleStocks(state.watchlist).map((stock) => {
      const quote = quoteMap.get(stock.quoteId)
      const overview = stockTOverview(state.stockTradingBooks[stock.quoteId], quote?.latest, {
        market: stock.market ?? marketFromQuoteId(stock.quoteId),
        instrumentType: stock.instrumentType,
        feeState: {
          securitiesAccounts: state.securitiesAccounts,
          feeSchemes: state.feeSchemes,
          settings: state.settings
        }
      })
      return {
        stock,
        quote,
        alertBadges: overview.badges,
        floatingAlerts: overview.floatingAlerts,
        fiveLevelAlerts: overview.summaries.length ? quote?.fiveLevelLargeOrders : undefined,
        stopLoss: evaluateStopLoss(
          stock,
          quote,
          new Date(),
          state.settings.tradingCalendar.markets[stock.market ?? marketFromQuoteId(stock.quoteId)]
        ),
        stockAlertDirection: getTriggeredStockAlertDirection(stock.alertRules)
      }
    })
  }, [
    quotes,
    state.stockTradingBooks,
    state.watchlist,
    state.securitiesAccounts,
    state.feeSchemes,
    state.settings
  ])

  useLayoutEffect(() => {
    const ticker = tickerRef.current
    if (!ticker || selectedStocks.length === 0) return
    return observeContentHeight(ticker, (height) => {
      const { width } = ticker.getBoundingClientRect()
      void stockApi.resizeTaskbarTicker(Math.ceil(width), Math.ceil(height))
    })
  }, [selectedStocks.length])

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
            floatingAlerts,
            fiveLevelAlerts,
            stockAlertDirection,
            stopLoss
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
                {stopLoss?.reached ? (
                  <span
                    className="stop-loss-marker is-reached"
                    aria-label={`止损价 ${formatPrice(stopLoss.stopPrice)}，已达到止损线`}
                  >
                    止
                  </span>
                ) : null}
                <strong>
                  <AnimatedNumber value={quote?.latest} formatValue={formatPrice} />
                </strong>
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
