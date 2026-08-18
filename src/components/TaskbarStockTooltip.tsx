import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares,
  formatSigned,
  formatUpdateTime
} from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { formatStockAlertValue, STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import { getTriggeredTAlertBadges, getTriggeredTFloatingProfitAlert } from '../lib/t-alerts'
import { calculateTBatchMetrics } from '../lib/t-trading'
import { getBatchTrades } from '../lib/trade-records'
import type { AppState, StockQuote } from '../shared/types'

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatLargeOrderVolume(volume: number): string {
  return volume >= 10_000 ? `${(volume / 10_000).toFixed(2)}万` : volume.toLocaleString('zh-CN')
}

export function TaskbarStockTooltip() {
  const shellRef = useRef<HTMLDivElement>(null)
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
  const account = quoteId ? state.tTradingAccounts[quoteId] : undefined
  const activeTrades = getBatchTrades(account, account?.activeBatch)
  const tAlertBadges = getTriggeredTAlertBadges(account?.activeBatch, activeTrades)
  const tMetrics = account?.activeBatch
    ? calculateTBatchMetrics(account.activeBatch, activeTrades, quote?.latest)
    : null
  const floatingProfitAlert = getTriggeredTFloatingProfitAlert(account?.activeBatch)
  const positionMetrics = calculatePositionMetrics(stock?.position, quote, account)
  const triggeredStockAlerts =
    stock?.alertRules?.filter((rule) => rule.enabled && rule.status === 'triggered') ?? []
  const fiveLevelAlerts = account?.activeBatch ? (quote?.fiveLevelLargeOrders ?? []) : []
  const alertCount =
    triggeredStockAlerts.length +
    tAlertBadges.length +
    fiveLevelAlerts.length +
    (floatingProfitAlert ? 1 : 0)

  useLayoutEffect(() => {
    if (!shellRef.current) return
    void stockApi.resizeTaskbarTooltip(shellRef.current.scrollHeight)
  })

  return (
    <div className="taskbar-stock-tooltip-shell" ref={shellRef}>
      <article className="taskbar-stock-tooltip">
        <header>
          <span className="taskbar-tooltip-identity">
            <strong>{stock?.name ?? quote?.name ?? '--'}</strong>
            <span>{stock?.code ?? quote?.code ?? '--'}</span>
          </span>
          <span className="taskbar-tooltip-market">{stock?.marketLabel ?? '实时行情'}</span>
        </header>

        <div className={`taskbar-tooltip-price-row ${valueClass(quote?.changePercent)}`}>
          <strong>{formatPrice(quote?.latest)}</strong>
          <span>
            {formatSigned(quote?.change)} · {formatPercent(quote?.changePercent)}
          </span>
          <span
            className={`taskbar-tooltip-today-profit ${valueClass(positionMetrics.todayProfit)}`}
          >
            {formatProfit(positionMetrics.todayProfit)}
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

        <section className="taskbar-tooltip-section">
          <div className="taskbar-tooltip-position-grid">
            <span>
              <small>持仓股数</small>
              <b>{formatShares(stock?.position?.quantity)}</b>
            </span>
            <span>
              <small>持仓成本</small>
              <b>{formatCost(stock?.position?.cost)}</b>
            </span>
            <span>
              <small>持仓市值</small>
              <b>{formatCurrency(positionMetrics.marketValue)}</b>
            </span>
            <span>
              <small>持仓收益</small>
              <b className={valueClass(positionMetrics.totalProfit)}>
                {formatProfit(positionMetrics.totalProfit)}
                <em>{formatPercent(positionMetrics.profitPercent)}</em>
              </b>
            </span>
          </div>
        </section>

        {tMetrics ? (
          <section className="taskbar-tooltip-section">
            <div className="taskbar-tooltip-t-summary">
              <strong>{tMetrics.direction === 'reverse' ? '反T' : '正T'}</strong>
              <span>剩余 {formatShares(tMetrics.remainingQuantity)}</span>
              <span>
                {tMetrics.direction === 'reverse' ? '基准' : '成本'}{' '}
                {formatCost(tMetrics.averageCost)}
              </span>
              <span className={valueClass(tMetrics.floatingProfit)}>
                浮动 {formatProfit(tMetrics.floatingProfit)}（
                {formatPercent(tMetrics.floatingProfitRate)}）
              </span>
            </div>
          </section>
        ) : null}

        {alertCount > 0 ? (
          <section className="taskbar-tooltip-section taskbar-tooltip-alert-section">
            <ul className="taskbar-tooltip-alert-list">
              {triggeredStockAlerts.map((rule) => {
                const actualValue =
                  rule.metric === 'price'
                    ? quote?.latest
                    : rule.metric === 'changePercent'
                      ? quote?.changePercent
                      : positionMetrics.profitPercent
                return (
                  <li className={`is-${rule.operator}`} key={rule.id}>
                    <b>股价提醒</b>
                    <span>
                      {STOCK_ALERT_METRIC_LABELS[rule.metric]}
                      {rule.operator === 'gte' ? ' ≥ ' : ' ≤ '}
                      {formatStockAlertValue(rule.metric, rule.target)}，当前{' '}
                      {actualValue === null || actualValue === undefined
                        ? '--'
                        : formatStockAlertValue(rule.metric, actualValue)}
                    </span>
                  </li>
                )
              })}
              {tAlertBadges.map((badge) => (
                <li className={`is-${badge.side}`} key={`${badge.side}-${badge.index}`}>
                  <b>T价位</b>
                  <span>
                    {badge.side === 'buy' ? '买入' : '卖出'} {badge.label}，目标价{' '}
                    {formatPrice(badge.targetPrice)}
                  </span>
                </li>
              ))}
              {fiveLevelAlerts.map((alert) => (
                <li className={`is-${alert.side}`} key={alert.side}>
                  <b>五档大单</b>
                  <span>
                    {alert.side === 'buy' ? '买' : '卖'}
                    {alert.level} 价格 {formatPrice(alert.price)}，挂单{' '}
                    {formatLargeOrderVolume(alert.volume)}，其余四档{' '}
                    {formatLargeOrderVolume(alert.otherLevelsVolume)}
                  </span>
                </li>
              ))}
              {floatingProfitAlert && account?.activeBatch?.floatingProfitAlert ? (
                <li className={`is-${floatingProfitAlert}`}>
                  <b>T浮动收益</b>
                  <span>
                    当前 {formatProfit(tMetrics?.floatingProfit)}，提醒值{' '}
                    {formatProfit(
                      floatingProfitAlert === 'profit'
                        ? account.activeBatch.floatingProfitAlert.threshold
                        : -account.activeBatch.floatingProfitAlert.threshold
                    )}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <footer>行情更新于 {formatUpdateTime(quote?.updatedAt)}</footer>
      </article>
    </div>
  )
}
