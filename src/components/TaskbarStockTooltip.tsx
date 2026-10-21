import { stockTOverview } from '../lib/stock-accounts'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatCurrency,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatShares,
  formatSigned,
  formatUpdateTime
} from '../lib/format'
import { calculatePositionMetrics, getPositionHoldingDays } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { formatStockAlertValue, STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import {
  marketCapabilitiesForQuoteId,
  marketFromQuoteId,
  STOCK_CURRENCY_SYMBOLS
} from '../shared/stock-market'
import { applyAppThemePreference } from '../lib/theme'
import { observeContentHeight } from '../lib/observe-content-height'
import type {
  AppState,
  KlineBar,
  KlineResult,
  OrderBookLevel,
  StockOrderBook,
  StockQuote,
  TaskbarLayout
} from '../shared/types'
import { AppThemeController } from './AppThemeController'
import { AppButton } from './AppButton'

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

function formatOrderVolumeTotal(levels: readonly OrderBookLevel[] | undefined): string {
  const volumes = levels?.slice(0, 5).map((level) => level.volume)
  if (!volumes?.length || volumes.some((volume) => volume === null)) return '--'
  return `${formatLargeOrderVolume(volumes.reduce<number>((total, volume) => total + volume!, 0))}手`
}

function FiveLevelVolumes({ orderBook }: { orderBook: StockOrderBook | null }) {
  return (
    <div className="taskbar-tooltip-order-volumes">
      <dt>五档数量</dt>
      <dd>
        <span className="taskbar-tooltip-stacked-values">
          <span className="is-buy">
            <i>买</i> {formatOrderVolumeTotal(orderBook?.bids)}
          </span>
          <span className="is-sell">
            <i>卖</i> {formatOrderVolumeTotal(orderBook?.asks)}
          </span>
        </span>
      </dd>
    </div>
  )
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

function recentFifteenMinutePrices(bars: readonly KlineBar[]): number[] {
  const points = bars
    .map((bar) => ({ time: minuteTimestamp(bar.time), price: bar.close }))
    .filter((point): point is { time: number; price: number } => point.time !== null)
    .sort((left, right) => left.time - right.time)
  const latestTime = points.at(-1)?.time
  return latestTime === undefined
    ? []
    : points
        .filter((point) => point.time >= latestTime - FIFTEEN_MINUTES)
        .map((point) => point.price)
}

export function MiniPriceSparkline({
  prices,
  expanded = false
}: {
  prices: readonly number[]
  expanded?: boolean
}) {
  const fillId = useId()
  const width = expanded ? 360 : SPARKLINE_WIDTH
  const height = expanded ? 88 : SPARKLINE_HEIGHT
  if (prices.length === 0) {
    return (
      <div className={`taskbar-tooltip-sparkline is-flat${expanded ? ' is-expanded-chart' : ''}`}>
        <dt>最近15分钟</dt>
        <dd>--</dd>
      </div>
    )
  }

  const minimum = Math.min(...prices)
  const maximum = Math.max(...prices)
  const range = maximum - minimum
  const availableHeight = height - SPARKLINE_PADDING * 2
  const coordinates = prices.map((price, index) => ({
    x:
      prices.length === 1
        ? width / 2
        : SPARKLINE_PADDING + (index / (prices.length - 1)) * (width - SPARKLINE_PADDING * 2),
    y: range === 0 ? height / 2 : SPARKLINE_PADDING + ((maximum - price) / range) * availableHeight
  }))
  const path =
    coordinates.length === 1
      ? `M ${SPARKLINE_PADDING} ${coordinates[0].y} L ${width - SPARKLINE_PADDING} ${coordinates[0].y}`
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
    <div
      className={`taskbar-tooltip-sparkline ${valueClass(change)}${expanded ? ' is-expanded-chart' : ''}`}
    >
      <dt>最近15分钟</dt>
      <dd>
        <svg
          aria-label={`最近15分钟价格从 ${formatPrice(prices[0])} 变化至 ${formatPrice(prices.at(-1))}，最高 ${formatPrice(maximum)}，最低 ${formatPrice(minimum)}`}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio={expanded ? 'none' : undefined}
        >
          {expanded ? (
            <>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path
                d={`${path} L ${width - SPARKLINE_PADDING} ${height} L ${SPARKLINE_PADDING} ${height} Z`}
                style={{ fill: `url(#${fillId})`, stroke: 'none' }}
              />
            </>
          ) : null}
          <path d={path} vectorEffect={expanded ? 'non-scaling-stroke' : undefined} />
          {!expanded && maximumIndex !== lastIndex ? (
            <circle className="is-extreme" cx={maximumPoint.x} cy={maximumPoint.y} r="2.2" />
          ) : null}
          {!expanded && minimumIndex !== maximumIndex && minimumIndex !== lastIndex ? (
            <circle className="is-extreme" cx={minimumPoint.x} cy={minimumPoint.y} r="2.2" />
          ) : null}
          {expanded ? null : (
            <circle className="is-latest" cx={lastPoint.x} cy={lastPoint.y} r="2.4" />
          )}
        </svg>
        {expanded ? null : (
          <span className="taskbar-tooltip-stacked-values" aria-hidden="true">
            <span>
              <i>高</i> {formatPrice(maximum)}
            </span>
            <span>
              <i>低</i> {formatPrice(minimum)}
            </span>
          </span>
        )}
      </dd>
    </div>
  )
}

export function TaskbarStockTooltip() {
  const sequence = useRef(0)
  const [session, setSession] = useState<{ quoteId: string; sequence: number } | null>(null)

  useEffect(() => {
    let active = true
    let receivedTooltipEvent = false

    const updateSession = (quoteId: string | null) => {
      setSession(quoteId === null ? null : { quoteId, sequence: ++sequence.current })
    }
    const unsubscribeTooltip = stockApi.onTaskbarTooltipStock((quoteId) => {
      receivedTooltipEvent = true
      updateSession(quoteId)
    })

    void stockApi.getTaskbarTooltipQuoteId().then((quoteId) => {
      if (active && !receivedTooltipEvent) updateSession(quoteId)
    })

    return () => {
      active = false
      unsubscribeTooltip()
    }
  }, [])

  return session ? <TaskbarTooltipContent key={session.sequence} quoteId={session.quoteId} /> : null
}

function TaskbarTooltipContent({ quoteId }: { quoteId: string }) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<AppState>(initialState)
  const [stateReady, setStateReady] = useState(false)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [layout, setLayout] = useState<TaskbarLayout>({
    taskbarHeight: 48,
    taskbarEdge: 'bottom'
  })

  useEffect(() => {
    if (stateReady) applyAppThemePreference(state.settings.theme)
  }, [stateReady, state.settings.theme])

  useEffect(() => {
    let active = true
    let receivedQuotesEvent = false
    let receivedStateEvent = false
    let receivedLayoutEvent = false

    const unsubscribeQuotes = stockApi.onQuotesUpdated((nextQuotes) => {
      receivedQuotesEvent = true
      setQuotes(nextQuotes)
    })
    const unsubscribeState = stockApi.onStateUpdated((nextState) => {
      receivedStateEvent = true
      setState(nextState)
      setStateReady(true)
    })
    const unsubscribeLayout = stockApi.onTaskbarLayout((nextLayout) => {
      receivedLayoutEvent = true
      setLayout(nextLayout)
    })

    void Promise.all([stockApi.getBootstrap(), stockApi.getTaskbarLayout()]).then(
      ([bootstrap, taskbarLayout]) => {
        if (!active) return
        if (!receivedStateEvent) {
          setState(bootstrap.state)
          setStateReady(true)
        }
        if (!receivedQuotesEvent) setQuotes(bootstrap.quotes)
        if (!receivedLayoutEvent) setLayout(taskbarLayout)
      }
    )

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
      unsubscribeLayout()
    }
  }, [])

  useLayoutEffect(() => {
    if (!shellRef.current) return
    return observeContentHeight(shellRef.current, (height) => {
      void stockApi.resizeTaskbarTooltip(height)
    })
  }, [])

  return (
    <div
      className={`taskbar-stock-tooltip-shell ${layout.taskbarEdge === 'top' ? 'is-taskbar-top' : ''}`}
      ref={shellRef}
    >
      <AppThemeController />
      <StockQuoteDetails quoteId={quoteId} state={state} quotes={quotes} />
    </div>
  )
}

export function StockQuoteDetails({
  quoteId,
  state,
  quotes,
  embedded = false
}: {
  quoteId: string
  state: AppState
  quotes: readonly StockQuote[]
  embedded?: boolean
}) {
  const [intraday, setIntraday] = useState<KlineResult | null>(null)
  const [orderBook, setOrderBook] = useState<StockOrderBook | null>(null)

  useEffect(() => {
    let active = true
    void stockApi.getKline(quoteId, 'intraday').then(
      (result) => {
        if (active) setIntraday(result)
      },
      () => {
        if (active) setIntraday(null)
      }
    )
    if (marketCapabilitiesForQuoteId(quoteId).orderBook) {
      void stockApi.getOrderBook(quoteId).then(
        (result) => {
          if (active) setOrderBook(result)
        },
        () => {
          if (active) setOrderBook(null)
        }
      )
    }
    return () => {
      active = false
    }
  }, [quoteId])

  const stock = state.watchlist.find((item) => item.quoteId === quoteId)
  const quote = quotes.find((item) => item.quoteId === quoteId)
  const market = stock?.market ?? marketFromQuoteId(quoteId)
  const tradingCalendar = state.settings.tradingCalendar.markets[market]
  const holdingDays = getPositionHoldingDays(
    stock?.position,
    tradingCalendar.closedDates,
    market,
    tradingCalendar.halfDayDates
  )
  const currentIntraday = intraday?.quoteId === quoteId ? intraday : null
  const currentOrderBook = orderBook?.quoteId === quoteId ? orderBook : null
  const sparklinePrices = useMemo(
    () => recentFifteenMinutePrices(currentIntraday?.bars ?? []),
    [currentIntraday]
  )
  const account = state.stockTradingBooks[quoteId]
  const overview = stockTOverview(account, quote?.latest, {
    market,
    instrumentType: stock?.instrumentType,
    feeState: state
  })
  const tAlertBadges = overview.badges
  const floatingProfitAlert = overview.floatingAlert
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
  const fiveLevelAlerts = overview.summaries.length ? (quote?.fiveLevelLargeOrders ?? []) : []
  const alertCount =
    triggeredStockAlerts.length +
    tAlertBadges.length +
    fiveLevelAlerts.length +
    (floatingProfitAlert ? 1 : 0)

  return (
    <article className={`taskbar-stock-tooltip${embedded ? ' is-inline' : ''}`}>
      {embedded ? null : (
        <header>
          <span className="taskbar-tooltip-identity">
            <strong>{stock?.name ?? quote?.name ?? '--'}</strong>
            <span>{stock?.code ?? quote?.code ?? '--'}</span>
            {quote?.sector ? (
              <span className="taskbar-tooltip-sector" title={quote.sector.name}>
                <span>{quote.sector.name}</span>
                <b className={valueClass(quote.sector.changePercent)}>
                  {formatPercent(quote.sector.changePercent)}
                </b>
              </span>
            ) : null}
            <span className="taskbar-tooltip-market">{stock?.marketLabel ?? '实时行情'}</span>
          </span>
          <span className="taskbar-tooltip-header-meta">
            <span className="taskbar-tooltip-update-time">
              {formatUpdateTime(quote?.dataAt ?? quote?.updatedAt)}
            </span>
          </span>
        </header>
      )}

      <div className={`taskbar-tooltip-price-row ${valueClass(quote?.changePercent)}`}>
        <strong>{embedded ? formatCurrency(quote?.latest) : formatPrice(quote?.latest)}</strong>
        {embedded ? (
          <span className="taskbar-tooltip-price-change">
            <span>{formatSigned(quote?.change)}</span>
            <span>{formatPercent(quote?.changePercent)}</span>
          </span>
        ) : (
          <span>
            {formatSigned(quote?.change)} {formatPercent(quote?.changePercent)}
          </span>
        )}
        <span className={`taskbar-tooltip-today-profit ${valueClass(positionMetrics.todayProfit)}`}>
          {embedded ? <span className="taskbar-tooltip-today-label">今日</span> : null}
          {formatMoneyProfit(positionMetrics.todayProfit, positionMetrics.currency)}
        </span>
      </div>

      <dl className="taskbar-tooltip-details">
        <div>
          <dt>今开</dt>
          <dd>{embedded ? formatCurrency(quote?.open) : formatPrice(quote?.open)}</dd>
        </div>
        <div>
          <dt>最高</dt>
          <dd>{embedded ? formatCurrency(quote?.high) : formatPrice(quote?.high)}</dd>
        </div>
        <div>
          <dt>最低</dt>
          <dd>{embedded ? formatCurrency(quote?.low) : formatPrice(quote?.low)}</dd>
        </div>
        <div>
          <dt>换手</dt>
          <dd>
            {embedded
              ? formatPercent(quote?.turnoverRate).replace(/^\+/, '')
              : formatPercent(quote?.turnoverRate)}
          </dd>
        </div>
        {embedded ? null : (
          <>
            <MiniPriceSparkline prices={sparklinePrices} />
            <FiveLevelVolumes orderBook={currentOrderBook} />
          </>
        )}
      </dl>

      {embedded ? (
        <dl className="taskbar-tooltip-inline-market">
          <MiniPriceSparkline prices={sparklinePrices} expanded />
          <FiveLevelVolumes orderBook={currentOrderBook} />
        </dl>
      ) : null}

      <section className="taskbar-tooltip-section">
        <div className="taskbar-tooltip-position-grid">
          <span>
            <small>持仓</small>
            <b>{formatShares(stock?.position?.quantity)}</b>
          </span>
          <span>
            <small>天数</small>
            <b>{holdingDays === null ? '--' : `${holdingDays} 天`}</b>
          </span>
          <span>
            <small>成本</small>
            <b>
              {positionMetrics.holdingCost !== null
                ? `${STOCK_CURRENCY_SYMBOLS[positionMetrics.currency]}${formatCost(positionMetrics.holdingCost)}`
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

      {overview.summaries.map(({ account: owner, metrics: tMetrics }) => (
        <section className="taskbar-tooltip-section" key={owner.accountId}>
          <div className="taskbar-tooltip-t-summary">
            <strong>
              {owner.accountName} · {tMetrics.direction === 'reverse' ? '反T' : '正T'}
            </strong>
            <span>剩余 {formatShares(tMetrics.remainingQuantity)}</span>
            <span>成本 {formatCost(tMetrics.averageCost)}</span>
            <span className={valueClass(tMetrics.floatingProfit)}>
              浮动 {formatMoneyProfit(tMetrics.floatingProfit, positionMetrics.currency)}
              {embedded && tMetrics.floatingProfitRate !== null ? (
                <span className={valueClass(tMetrics.floatingProfitRate)}>
                  {' '}
                  ({formatPercent(tMetrics.floatingProfitRate)})
                </span>
              ) : null}
            </span>
          </div>
        </section>
      ))}

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
              <li
                className={`is-${badge.side}`}
                key={`${badge.accountId}-${badge.side}-${badge.index}`}
              >
                <b>T价位</b>
                <span>
                  {badge.accountName} · {badge.side === 'buy' ? '买入' : '卖出'} {badge.label}
                  ，目标价 {formatPrice(badge.targetPrice)}
                </span>
              </li>
            ))}
            {fiveLevelAlerts.map((alert) => (
              <li className={`is-five-level-order is-${alert.side}`} key={alert.side}>
                <b>五档大单</b>
                <span>
                  {alert.side === 'buy' ? '买' : '卖'}
                  {alert.level} 价格 {formatPrice(alert.price)}，挂单{' '}
                  {formatLargeOrderVolume(alert.volume)}，其余四档{' '}
                  {formatLargeOrderVolume(alert.otherLevelsVolume)}
                </span>
              </li>
            ))}
            {overview.floatingAlerts.map((summary) => (
              <li key={summary.account.accountId} className={`is-${summary.floatingAlert}`}>
                <b>T浮动收益</b>
                <span>
                  {summary.account.accountName} · 当前{' '}
                  {formatMoneyProfit(summary.metrics.floatingProfit, positionMetrics.currency)}
                  ，提醒值{' '}
                  {formatMoneyProfit(
                    (summary.floatingAlert === 'profit' ? 1 : -1) *
                      summary.batch.floatingProfitAlert!.threshold,
                    positionMetrics.currency
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {embedded ? (
        <div className="menu-bar-detail-actions">
          <AppButton variant="plain" onClick={() => void stockApi.showMainWindow(quoteId)}>
            在主窗口查看
          </AppButton>
        </div>
      ) : null}
    </article>
  )
}
