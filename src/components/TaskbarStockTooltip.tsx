import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares,
  formatSigned,
  formatUpdateTime
} from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { formatStockAlertValue, STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import { getTriggeredTAlertBadges, getTriggeredTFloatingProfitAlert } from '../lib/t-alerts'
import { calculateTBatchMetrics } from '../lib/t-trading'
import { getBatchTrades } from '../lib/trade-records'
import type { AppState, KlineBar, KlineResult, StockQuote, TaskbarLayout } from '../shared/types'

const SPARKLINE_WIDTH = 76
const SPARKLINE_HEIGHT = 26
const SPARKLINE_PADDING = 2
const FIFTEEN_MINUTES = 15 * 60_000

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatLargeOrderVolume(volume: number): string {
  return volume >= 10_000 ? `${(volume / 10_000).toFixed(2)}万` : volume.toLocaleString('zh-CN')
}

function minuteTimestamp(time: string): number | null {
  const parts = time.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!parts) return null
  return Date.UTC(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5])
  )
}

function recentFifteenMinutePrices(
  bars: readonly KlineBar[],
  latest: number | null | undefined
): number[] {
  const points = bars
    .map((bar) => ({ time: minuteTimestamp(bar.time), price: bar.close }))
    .filter((point): point is { time: number; price: number } => point.time !== null)
    .sort((left, right) => left.time - right.time)
  const latestTime = points.at(-1)?.time
  const prices =
    latestTime === undefined
      ? []
      : points
          .filter((point) => point.time >= latestTime - FIFTEEN_MINUTES)
          .map((point) => point.price)

  if (typeof latest === 'number' && Number.isFinite(latest) && prices.at(-1) !== latest) {
    prices.push(latest)
  }
  return prices
}

function MiniPriceSparkline({ prices }: { prices: readonly number[] }) {
  if (prices.length === 0) {
    return (
      <div className="taskbar-tooltip-sparkline is-flat">
        <dt>最近15分钟</dt>
        <dd>--</dd>
      </div>
    )
  }

  const minimum = Math.min(...prices)
  const maximum = Math.max(...prices)
  const range = maximum - minimum
  const availableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2
  const coordinates = prices.map((price, index) => ({
    x:
      prices.length === 1
        ? SPARKLINE_WIDTH / 2
        : SPARKLINE_PADDING +
          (index / (prices.length - 1)) * (SPARKLINE_WIDTH - SPARKLINE_PADDING * 2),
    y:
      range === 0
        ? SPARKLINE_HEIGHT / 2
        : SPARKLINE_PADDING + ((maximum - price) / range) * availableHeight
  }))
  const path =
    coordinates.length === 1
      ? `M ${SPARKLINE_PADDING} ${coordinates[0].y} L ${SPARKLINE_WIDTH - SPARKLINE_PADDING} ${coordinates[0].y}`
      : coordinates
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
          )
          .join(' ')
  const lastPoint = coordinates.at(-1)!
  const maximumIndex = prices.lastIndexOf(maximum)
  const minimumIndex = prices.lastIndexOf(minimum)
  const maximumPoint = coordinates[maximumIndex]
  const minimumPoint = coordinates[minimumIndex]
  const lastIndex = coordinates.length - 1
  const change = prices.at(-1)! - prices[0]

  return (
    <div className={`taskbar-tooltip-sparkline ${valueClass(change)}`}>
      <dt>最近15分钟</dt>
      <dd>
        <svg
          aria-label={`最近15分钟价格从 ${formatPrice(prices[0])} 变化至 ${formatPrice(prices.at(-1))}，最高 ${formatPrice(maximum)}，最低 ${formatPrice(minimum)}`}
          role="img"
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        >
          <path d={path} />
          <circle className="is-extreme" cx={maximumPoint.x} cy={maximumPoint.y} r="2.2" />
          {minimumIndex !== maximumIndex ? (
            <circle className="is-extreme" cx={minimumPoint.x} cy={minimumPoint.y} r="2.2" />
          ) : null}
          {lastIndex !== maximumIndex && lastIndex !== minimumIndex ? (
            <circle cx={lastPoint.x} cy={lastPoint.y} r="1.8" />
          ) : null}
        </svg>
        <span className="taskbar-tooltip-sparkline-range" aria-hidden="true">
          <span>
            <i>高</i> {formatPrice(maximum)}
          </span>
          <span>
            <i>低</i> {formatPrice(minimum)}
          </span>
        </span>
      </dd>
    </div>
  )
}

export function TaskbarStockTooltip() {
  const shellRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [intraday, setIntraday] = useState<KlineResult | null>(null)
  const [intradayRequestVersion, setIntradayRequestVersion] = useState(0)
  const [layout, setLayout] = useState<TaskbarLayout>({
    taskbarHeight: 48,
    taskbarEdge: 'bottom'
  })

  useEffect(() => {
    let active = true
    let receivedTooltipEvent = false
    let receivedLayoutEvent = false

    const unsubscribeQuotes = stockApi.onQuotesUpdated(setQuotes)
    const unsubscribeState = stockApi.onStateUpdated(setState)
    const unsubscribeTooltip = stockApi.onTaskbarTooltipStock((nextQuoteId) => {
      receivedTooltipEvent = true
      setQuoteId(nextQuoteId)
      setIntradayRequestVersion((current) => current + 1)
    })
    const unsubscribeLayout = stockApi.onTaskbarLayout((nextLayout) => {
      receivedLayoutEvent = true
      setLayout(nextLayout)
    })

    void Promise.all([
      getInitialBootstrap(),
      stockApi.getTaskbarTooltipQuoteId(),
      stockApi.getTaskbarLayout()
    ]).then(([bootstrap, currentQuoteId, taskbarLayout]) => {
      if (!active) return
      setState(bootstrap.state)
      setQuotes(bootstrap.quotes)
      if (!receivedTooltipEvent) setQuoteId(currentQuoteId)
      if (!receivedLayoutEvent) setLayout(taskbarLayout)
    })

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeTooltip()
      unsubscribeLayout()
    }
  }, [])

  useEffect(() => {
    if (!quoteId) {
      setIntraday(null)
      return
    }
    let active = true
    setIntraday((current) => (current?.quoteId === quoteId ? current : null))
    void stockApi.getKline(quoteId, 'intraday').then(
      (result) => {
        if (active) setIntraday(result)
      },
      () => {
        if (active) setIntraday(null)
      }
    )
    return () => {
      active = false
    }
  }, [intradayRequestVersion, quoteId])

  const stock = state.watchlist.find((item) => item.quoteId === quoteId)
  const quote = quotes.find((item) => item.quoteId === quoteId)
  const currentIntraday = intraday?.quoteId === quoteId ? intraday : null
  const sparklinePrices = useMemo(
    () => recentFifteenMinutePrices(currentIntraday?.bars ?? [], quote?.latest),
    [currentIntraday, quote?.latest]
  )
  const account = quoteId ? state.tTradingAccounts[quoteId] : undefined
  const activeTrades = getBatchTrades(account, account?.activeBatch)
  const tAlertBadges = getTriggeredTAlertBadges(account?.activeBatch, activeTrades)
  const tMetrics = account?.activeBatch
    ? calculateTBatchMetrics(account.activeBatch, activeTrades, quote?.latest)
    : null
  const floatingProfitAlert = getTriggeredTFloatingProfitAlert(account?.activeBatch)
  const positionProfitOverride = stock
    ? calculateCurrentPositionProfitOverride(
        stock,
        quote,
        account,
        state.settings.exchangeRates,
        state.portfolioPerformanceAdjustments?.[stock.quoteId] ?? 0
      )
    : undefined
  const positionMetrics = calculatePositionMetrics(
    stock?.position,
    quote,
    account,
    state.settings.exchangeRates,
    positionProfitOverride
  )
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
    <div
      className={`taskbar-stock-tooltip-shell ${layout.taskbarEdge === 'top' ? 'is-taskbar-top' : ''}`}
      ref={shellRef}
    >
      <article className="taskbar-stock-tooltip">
        <header>
          <span className="taskbar-tooltip-identity">
            <strong>{stock?.name ?? quote?.name ?? '--'}</strong>
            <span>{stock?.code ?? quote?.code ?? '--'}</span>
          </span>
          <span className="taskbar-tooltip-header-meta">
            <span className="taskbar-tooltip-update-time">
              {formatUpdateTime(quote?.dataAt ?? quote?.updatedAt)}
            </span>
            <span className="taskbar-tooltip-market">{stock?.marketLabel ?? '实时行情'}</span>
          </span>
        </header>

        <div className={`taskbar-tooltip-price-row ${valueClass(quote?.changePercent)}`}>
          <strong>{formatPrice(quote?.latest)}</strong>
          <span>
            {formatSigned(quote?.change)} · {formatPercent(quote?.changePercent)}
          </span>
          <span
            className={`taskbar-tooltip-today-profit ${valueClass(positionMetrics.todayProfit)}`}
          >
            {formatMoneyProfit(positionMetrics.todayProfit, positionMetrics.currency)}
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
          <MiniPriceSparkline prices={sparklinePrices} />
        </dl>

        <section className="taskbar-tooltip-section">
          <div className="taskbar-tooltip-position-grid">
            <span>
              <small>持仓</small>
              <b>{formatShares(stock?.position?.quantity)}</b>
            </span>
            <span>
              <small>成本</small>
              <b>
                {stock?.position
                  ? formatMoney(stock.position.cost, positionMetrics.currency)
                  : '--'}
              </b>
            </span>
            <span>
              <small>市值</small>
              <b>{formatMoney(positionMetrics.marketValue, positionMetrics.currency)}</b>
            </span>
            <span>
              <small>收益</small>
              <b className={valueClass(positionMetrics.totalProfit)}>
                {formatMoneyProfit(positionMetrics.totalProfit, positionMetrics.currency)}
              </b>
            </span>
            <span>
              <small>收益率</small>
              <b className={valueClass(positionMetrics.profitPercent)}>
                {formatPercent(positionMetrics.profitPercent)}
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
                      {formatStockAlertValue(rule.metric, rule.target, stock?.currency)}，当前{' '}
                      {actualValue === null || actualValue === undefined
                        ? '--'
                        : formatStockAlertValue(rule.metric, actualValue, stock?.currency)}
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
      </article>
    </div>
  )
}
