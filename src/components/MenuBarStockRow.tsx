import { useId, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatPercent, formatPrice, formatSigned, formatUpdateTime } from '../lib/format'
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
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}

export function MenuBarStockRow({
  summary,
  status,
  expanded,
  onToggle,
  children
}: MenuBarStockRowProps) {
  const { stock, quote, positionMetrics, alertBadges, floatingAlerts } = summary
  const priceAlert = getTriggeredStockAlertDirection(stock.alertRules)
  const statusLabel = STOCK_QUOTE_DATA_STATE_LABELS[status]

  const triggerId = useId()
  const detailsId = useId()

  return (
    <section
      className={`tray-summary-item menu-bar-stock-row${expanded ? ' is-expanded' : ''}`}
      aria-label={stock.name}
    >
      <AppButton
        id={triggerId}
        variant="plain"
        className="menu-bar-stock-toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        title={`${expanded ? '收起' : '展开'}${stock.name}详细行情`}
        onClick={onToggle}
      >
        <span className="menu-bar-quote-row">
          <span className="menu-bar-stock-identity">
            <strong className="menu-bar-stock-name">{stock.name}</strong>
            <span className="menu-bar-stock-code">{stock.code}</span>
            {expanded ? (
              <>
                <span className="menu-bar-stock-market">{stock.marketLabel}</span>
                <span className="menu-bar-stock-time">
                  {formatUpdateTime(quote?.dataAt ?? quote?.updatedAt).slice(0, 5)}
                </span>
              </>
            ) : (
              <span className={`menu-bar-status is-${status}`}>{statusLabel}</span>
            )}
          </span>
          {expanded ? null : (
            <span className="menu-bar-quote-values">
              <b className={valueClass(quote?.change)}>{formatPrice(quote?.latest)}</b>
              <span className={valueClass(quote?.change)}>{formatSigned(quote?.change)}</span>
              <b className={valueClass(quote?.changePercent)}>
                {formatPercent(quote?.changePercent)}
              </b>
            </span>
          )}
          <ChevronRight className="menu-bar-expand-icon" size={14} aria-hidden="true" />
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
      </AppButton>
      <div
        id={detailsId}
        className="menu-bar-stock-details"
        role="region"
        aria-labelledby={triggerId}
        hidden={!expanded}
      >
        {expanded ? children : null}
      </div>
    </section>
  )
}
