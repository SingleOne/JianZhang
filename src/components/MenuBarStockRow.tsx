import { stockApi } from '../lib/api'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatShares,
  formatSigned
} from '../lib/format'
import type { getMenuBarQuoteStatus } from '../lib/menu-bar'
import { STOCK_QUOTE_DATA_STATE_LABELS } from '../lib/quote-state'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import type { getTraySummaryStocks } from '../lib/tray-summary'
import { AppButton } from './AppButton'
import { TAlertBadges } from './TAlertBadges'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'

function valueClass(value: number | null | undefined): string {
  return value ? (value > 0 ? 'is-up' : 'is-down') : 'is-flat'
}

interface MenuBarStockRowProps {
  summary: ReturnType<typeof getTraySummaryStocks>[number]
  status: ReturnType<typeof getMenuBarQuoteStatus>
}

export function MenuBarStockRow({ summary, status }: MenuBarStockRowProps) {
  const { stock, quote, positionMetrics, tSummaries, alertBadges, floatingAlerts } = summary
  const priceAlert = getTriggeredStockAlertDirection(stock.alertRules)
  const statusLabel = STOCK_QUOTE_DATA_STATE_LABELS[status]

  return (
    <section className="tray-summary-item menu-bar-stock-row" aria-label={stock.name}>
      <div className="menu-bar-quote-row">
        <div className="menu-bar-stock-identity">
          <AppButton
            variant="plain"
            className="menu-bar-stock-link"
            title={`${stock.name} · ${stock.code} · ${statusLabel}`}
            onClick={() => void stockApi.showMainWindow(stock.quoteId)}
          >
            {stock.name}
          </AppButton>
          <span className="menu-bar-stock-code">{stock.code}</span>
          <span className={`menu-bar-status is-${status}`}>{statusLabel}</span>
        </div>
        <span className="menu-bar-quote-values">
          <b className={valueClass(quote?.change)}>{formatPrice(quote?.latest)}</b>
          <span className={valueClass(quote?.change)}>{formatSigned(quote?.change)}</span>
          <b className={valueClass(quote?.changePercent)}>{formatPercent(quote?.changePercent)}</b>
        </span>
      </div>
      <div className="menu-bar-metrics-line">
        <span className="menu-bar-metric">
          今日
          <b className={valueClass(positionMetrics.todayProfit)}>
            {formatMoneyProfit(positionMetrics.todayProfit, positionMetrics.currency)}
          </b>
          <span className={valueClass(positionMetrics.todayProfitPercent)}>
            ({formatPercent(positionMetrics.todayProfitPercent)})
          </span>
        </span>
        <span className="menu-bar-metric">
          持仓
          <b className={valueClass(positionMetrics.totalProfit)}>
            {formatMoneyProfit(positionMetrics.totalProfit, positionMetrics.currency)}
          </b>
          <span className={valueClass(positionMetrics.profitPercent)}>
            ({formatPercent(positionMetrics.profitPercent)})
          </span>
        </span>
        <span className="menu-bar-metric">
          市值 <b>{formatMoney(positionMetrics.marketValue, positionMetrics.currency)}</b>
        </span>
        {priceAlert || alertBadges.length > 0 || floatingAlerts.length > 0 ? (
          <span className="menu-bar-alerts">
            <TAlertBadges badges={alertBadges} compact />
            {floatingAlerts.map((item) => (
              <TFloatingProfitAlertBadge
                key={item.account.accountId}
                accountName={item.account.accountName}
                batch={item.batch}
                floatingProfit={item.metrics.floatingProfit}
                currency={positionMetrics.currency}
                compact
              />
            ))}
            {priceAlert ? <span className="menu-bar-alert">股价提醒</span> : null}
          </span>
        ) : null}
      </div>
      {tSummaries.map(({ account: owner, metrics }) => (
        <div className="menu-bar-t-summary" key={owner.accountId}>
          <span className="menu-bar-metric">
            {owner.accountName} · {metrics.direction === 'reverse' ? '反T' : '正T'}
            <b>{formatShares(metrics.remainingQuantity)}</b>
          </span>
          <span className="menu-bar-metric">
            {metrics.direction === 'reverse' ? '基准' : '成本'}
            <b>{formatCost(metrics.averageCost)}</b>
          </span>
          <span className="menu-bar-metric">
            浮动
            <b className={valueClass(metrics.floatingProfit)}>
              {formatMoneyProfit(metrics.floatingProfit, positionMetrics.currency)}
            </b>
            {metrics.floatingProfitRate === null ? null : (
              <span className={valueClass(metrics.floatingProfitRate)}>
                ({formatPercent(metrics.floatingProfitRate)})
              </span>
            )}
          </span>
        </div>
      ))}
    </section>
  )
}
