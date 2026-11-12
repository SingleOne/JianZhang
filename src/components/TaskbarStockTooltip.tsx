import { stockTOverview } from '../lib/stock-accounts'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, stockApi } from '../lib/api'
import {
  formatCost,
  formatCurrency,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatShares,
  formatSigned,
  formatUpdateTime,
  formatVolume
} from '../lib/format'
import {
  calculatePositionMetrics,
  getAvailablePositionQuantity,
  getPositionHoldingDays
} from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import { getTPlanRows } from '../lib/t-alerts'
import { formatStockAlertValue, STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import { evaluateStopLoss } from '../shared/stop-loss'
import {
  currencyForMarket,
  marketCapabilitiesForQuoteId,
  marketFromQuoteId,
  marketLabelForQuoteId,
  STOCK_CURRENCY_SYMBOLS,
  volumeUnitForMarket,
  type StockVolumeUnit
} from '../shared/stock-market'
import { applyAppThemePreference } from '../lib/theme'
import { observeContentHeight } from '../lib/observe-content-height'
import { isMarketOpen, millisecondsUntilNextMarketOpen } from '../shared/market-hours'
import { dataCenter } from '../lib/api'
import {
  useAppData,
  useAppSetting,
  useAppSettings,
  useStockQuote,
  useStockTradingBook,
  useAccountFeeData
} from '../lib/data-center/hooks'
import { useDetailResource, useKlineResource } from '../lib/data-center/detail-hooks'
import type { KlineBar, StockOrderBook, TaskbarLayout } from '../shared/types'
import { AppThemeController } from './AppThemeController'
import { AppButton } from './AppButton'
import { AnimatedNumber } from './AnimatedNumber'

const SPARKLINE_WIDTH = 76
const SPARKLINE_HEIGHT = 26
const SPARKLINE_PADDING = 2
const EXPANDED_SPARKLINE_WIDTH = 360
const EXPANDED_SPARKLINE_PADDING = 4
const FIFTEEN_MINUTES = 15 * 60_000
const ORDER_BOOK_LEVEL_LABELS = ['一', '二', '三', '四', '五']

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatLargeOrderVolume(volume: number | null | undefined): string {
  if (volume === null || volume === undefined) return '--'
  return volume >= 10_000 ? `${(volume / 10_000).toFixed(2)}万` : volume.toLocaleString('zh-CN')
}

function formatTaskbarVolume(volume: number | null | undefined, unit: StockVolumeUnit): string {
  if (volume !== null && volume !== undefined && unit === 'lot' && volume < 10_000) {
    return `${volume.toLocaleString('zh-CN')}手`
  }
  return formatVolume(volume, unit)
}

function FiveLevelOrderBook({ orderBook }: { orderBook: StockOrderBook | null }) {
  return (
    <div className="taskbar-tooltip-order-book">
      <dt>五档盘口（手）</dt>
      <dd>
        {[
          { side: 'buy', label: '买', levels: orderBook?.bids },
          { side: 'sell', label: '卖', levels: orderBook?.asks }
        ].map(({ side, label, levels }) => (
          <div className={`taskbar-tooltip-order-side is-${side}`} key={side}>
            {ORDER_BOOK_LEVEL_LABELS.map((levelLabel, index) => (
              <div className="taskbar-tooltip-order-row" key={levelLabel}>
                <span>
                  {label}
                  {levelLabel}
                </span>
                <span>
                  {levels?.[index]?.price === 0 ? (
                    '-'
                  ) : (
                    <AnimatedNumber value={levels?.[index]?.price} formatValue={formatPrice} />
                  )}
                </span>
                <span>{formatLargeOrderVolume(levels?.[index]?.volume)}</span>
              </div>
            ))}
          </div>
        ))}
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

function recentFifteenMinuteBars(bars: readonly KlineBar[]): KlineBar[] {
  const points = bars
    .map((bar) => ({ time: minuteTimestamp(bar.time), bar }))
    .filter((point): point is { time: number; bar: KlineBar } => point.time !== null)
    .sort((left, right) => left.time - right.time)
  const latestTime = points.at(-1)?.time
  return latestTime === undefined
    ? []
    : points.filter((point) => point.time > latestTime - FIFTEEN_MINUTES).map((point) => point.bar)
}

function sparklineX(index: number, count: number, width: number, padding: number): number {
  return count === 1 ? width / 2 : padding + (index / (count - 1)) * (width - padding * 2)
}

function MiniVolumeHistogram({
  bars,
  volumeUnit,
  chartHeight
}: {
  bars: readonly KlineBar[]
  volumeUnit: StockVolumeUnit
  chartHeight: number
}) {
  const width = EXPANDED_SPARKLINE_WIDTH
  const height = chartHeight * 0.25
  const maximum = Math.max(...bars.map((bar) => bar.volume))
  const barWidth = Math.min(8, ((width - EXPANDED_SPARKLINE_PADDING * 2) / bars.length) * 0.65)

  return (
    <g className="taskbar-tooltip-volume-chart">
      {bars.map((bar, index) => {
        const barHeight = maximum === 0 ? 0 : (bar.volume / maximum) * (height - 2)
        const x = sparklineX(index, bars.length, width, EXPANDED_SPARKLINE_PADDING)
        return (
          <rect
            key={bar.time}
            className={valueClass(bar.close - bar.open)}
            x={(x - barWidth / 2).toFixed(2)}
            y={(chartHeight - barHeight).toFixed(2)}
            width={barWidth.toFixed(2)}
            height={barHeight.toFixed(2)}
          >
            <title>
              {bar.time.slice(11, 16)} 成交量 {bar.volume.toLocaleString('zh-CN')}
              {volumeUnit === 'lot' ? '手' : '股'}
            </title>
          </rect>
        )
      })}
    </g>
  )
}

export function MiniPriceSparkline({
  prices,
  volumeBars,
  volumeUnit = 'lot',
  intervalMinutes = 1,
  expanded = false
}: {
  prices: readonly number[]
  volumeBars?: readonly KlineBar[]
  volumeUnit?: StockVolumeUnit
  intervalMinutes?: 1 | 5
  expanded?: boolean
}) {
  const fillId = useId()
  const width = expanded ? EXPANDED_SPARKLINE_WIDTH : SPARKLINE_WIDTH
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
  const hasVolume = expanded && volumeBars !== undefined && volumeBars.length > 0
  const volumeTotal = volumeBars?.reduce((sum, bar) => sum + bar.volume, 0) ?? 0
  const latestVolume = volumeBars?.at(-1)?.volume
  const priceHeight = hasVolume ? height * 0.75 : height
  const paddingX = expanded ? EXPANDED_SPARKLINE_PADDING : SPARKLINE_PADDING
  const paddingY = expanded ? 20 : SPARKLINE_PADDING
  const availableHeight = priceHeight - paddingY * 2
  const coordinates = prices.map((price, index) => ({
    x: sparklineX(index, prices.length, width, paddingX),
    y: range === 0 ? priceHeight / 2 : paddingY + ((maximum - price) / range) * availableHeight
  }))
  const path =
    coordinates.length === 1
      ? `M ${paddingX} ${coordinates[0].y} L ${width - paddingX} ${coordinates[0].y}`
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
      <dt className="taskbar-tooltip-chart-heading">
        <span className="taskbar-tooltip-period-heading">
          <span>最近15分钟</span>
          {hasVolume ? (
            <span title="最近15分钟成交量合计">{formatTaskbarVolume(volumeTotal, volumeUnit)}</span>
          ) : null}
        </span>
        {hasVolume ? (
          <span className="taskbar-tooltip-volume-heading">
            最新量{intervalMinutes === 5 ? '（5分钟）' : ''}{' '}
            {formatTaskbarVolume(latestVolume, volumeUnit)}
          </span>
        ) : null}
      </dt>
      <dd>
        <svg
          aria-label={`最近15分钟价格从 ${formatPrice(prices[0])} 变化至 ${formatPrice(prices.at(-1))}，最高 ${formatPrice(maximum)}，最低 ${formatPrice(minimum)}${hasVolume ? `，每${intervalMinutes === 1 ? '' : intervalMinutes}分钟成交量，合计 ${formatTaskbarVolume(volumeTotal, volumeUnit)}，最新一根 ${formatTaskbarVolume(latestVolume, volumeUnit)}` : ''}`}
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
                d={`${path} L ${width - paddingX} ${priceHeight} L ${paddingX} ${priceHeight} Z`}
                style={{ fill: `url(#${fillId})`, stroke: 'none' }}
              />
            </>
          ) : null}
          {hasVolume ? (
            <MiniVolumeHistogram bars={volumeBars} volumeUnit={volumeUnit} chartHeight={height} />
          ) : null}
          <path d={path} vectorEffect={expanded ? 'non-scaling-stroke' : undefined} />
          {expanded || maximumIndex !== lastIndex ? (
            <circle
              className="is-extreme is-maximum"
              cx={maximumPoint.x}
              cy={maximumPoint.y}
              r="2.2"
            />
          ) : null}
          {minimumIndex !== maximumIndex && (expanded || minimumIndex !== lastIndex) ? (
            <circle
              className="is-extreme is-minimum"
              cx={minimumPoint.x}
              cy={minimumPoint.y}
              r="2.2"
            />
          ) : null}
          {expanded ? null : (
            <circle className="is-latest" cx={lastPoint.x} cy={lastPoint.y} r="2.4" />
          )}
        </svg>
        {expanded ? (
          [
            { kind: 'maximum', label: '最高', price: maximum, point: maximumPoint },
            { kind: 'minimum', label: '最低', price: minimum, point: minimumPoint }
          ].map(({ kind, label, price, point }) => (
            <span
              key={kind}
              className={`taskbar-tooltip-extreme-label is-${kind}${point.x > width / 2 ? ' is-right-aligned' : ''}`}
              style={{ left: `${(point.x / width) * 100}%`, top: `${(point.y / height) * 100}%` }}
              aria-hidden="true"
            >
              {label} {formatPrice(price)}
            </span>
          ))
        ) : (
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
  const theme = useAppSetting('theme')
  const [stateReady, setStateReady] = useState(false)
  const [layout, setLayout] = useState<TaskbarLayout>({
    taskbarHeight: 48,
    taskbarEdge: 'bottom'
  })

  useEffect(() => {
    if (stateReady) applyAppThemePreference(theme)
  }, [stateReady, theme])

  useEffect(() => {
    let active = true
    let receivedLayoutEvent = false

    const unsubscribeLayout = stockApi.onTaskbarLayout((nextLayout) => {
      receivedLayoutEvent = true
      setLayout(nextLayout)
    })

    void Promise.all([getInitialBootstrap(), stockApi.getTaskbarLayout()]).then(
      ([, taskbarLayout]) => {
        if (!active) return
        setStateReady(true)
        if (!receivedLayoutEvent) setLayout(taskbarLayout)
      }
    )

    return () => {
      active = false
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
      <StockQuoteDetails quoteId={quoteId} />
    </div>
  )
}

export function StockQuoteDetails({
  quoteId,
  embedded = false
}: {
  quoteId: string
  embedded?: boolean
}) {
  const stock = useAppData((snapshot) =>
    snapshot.state.watchlist.find((item) => item.quoteId === quoteId)
  )
  const quote = useStockQuote(quoteId)
  const account = useStockTradingBook(quoteId)
  const feeState = useAccountFeeData()
  const settings = useAppSettings([
    'tradingCalendar',
    'autoRefreshQuotes',
    'priorityRefreshSeconds',
    'regularRefreshSeconds',
    'exchangeRates'
  ])
  const adjustment = useAppData(
    (snapshot) => snapshot.state.portfolioPerformanceAdjustments?.[quoteId] ?? 0
  )
  const cumulativeProfit = useAppData(
    (snapshot) => snapshot.state.portfolioPerformanceCache?.cumulativeProfitByQuoteId[quoteId]
  )
  const market = stock?.market ?? marketFromQuoteId(quoteId)
  const currency = stock?.currency ?? currencyForMarket(market)
  const tradingCalendar = settings.tradingCalendar.markets[market]
  const refreshSeconds = stock?.isPriority
    ? settings.priorityRefreshSeconds
    : settings.regularRefreshSeconds
  const demand = useMemo(
    () =>
      settings.autoRefreshQuotes
        ? {
            interval: Math.max(3, refreshSeconds) * 1000,
            canRefresh: () => isMarketOpen(market, new Date(), tradingCalendar),
            nextWindow: () => millisecondsUntilNextMarketOpen(market, new Date(), tradingCalendar)
          }
        : undefined,
    [settings.autoRefreshQuotes, refreshSeconds, market, tradingCalendar]
  )
  // Keep the tooltip's original one-shot sparkline behavior.
  const intraday = useKlineResource(quoteId, 'intraday', undefined, true, false).data
  const orderBook = useDetailResource(
    marketCapabilitiesForQuoteId(quoteId).orderBook
      ? dataCenter.details.orderBook(quoteId)
      : undefined,
    true,
    demand
  ).data

  const holdingDays = getPositionHoldingDays(
    stock?.position,
    tradingCalendar.closedDates,
    market,
    tradingCalendar.halfDayDates
  )
  const currentIntraday = intraday?.quoteId === quoteId ? intraday : null
  const currentOrderBook = orderBook?.quoteId === quoteId ? orderBook : null
  const sparklineBars = useMemo(
    () => recentFifteenMinuteBars(currentIntraday?.bars ?? []),
    [currentIntraday]
  )
  const availablePositionQuantity = getAvailablePositionQuantity(stock?.position, account, market)
  const overview = stockTOverview(account, quote?.latest, {
    market,
    instrumentType: stock?.instrumentType,
    feeState
  })
  const tAlertBadges = overview.badges
  const floatingProfitAlert = overview.floatingAlert
  const positionProfitOverride = stock
    ? calculateCurrentPositionProfitOverride(
        stock,
        quote,
        account,
        settings.exchangeRates,
        adjustment
      )
    : undefined
  const positionMetrics = calculatePositionMetrics(
    stock?.position,
    quote,
    account,
    settings.exchangeRates,
    positionProfitOverride
  )
  const hasPosition = (stock?.position?.quantity ?? 0) > 0
  const displayedTotalProfit = hasPosition ? positionMetrics.totalProfit : cumulativeProfit
  const displayedProfitCurrency = hasPosition ? positionMetrics.currency : 'CNY'
  const displayedProfitPercent = hasPosition ? positionMetrics.profitPercent : null
  const triggeredStockAlerts =
    stock?.alertRules?.filter((rule) => rule.enabled && rule.status === 'triggered') ?? []
  const fiveLevelAlerts = overview.summaries.length ? (quote?.fiveLevelLargeOrders ?? []) : []
  const stopLoss = stock ? evaluateStopLoss(stock, quote, new Date(), tradingCalendar) : null
  const alertCount =
    triggeredStockAlerts.length +
    tAlertBadges.length +
    fiveLevelAlerts.length +
    (floatingProfitAlert ? 1 : 0) +
    (stopLoss?.reached ? 1 : 0)

  return (
    <article className={`taskbar-stock-tooltip${embedded ? ' is-inline' : ''}`}>
      {embedded ? null : (
        <header>
          <span className="taskbar-tooltip-identity">
            <strong>{stock?.name ?? quote?.name ?? '--'}</strong>
            <span>{stock?.code ?? quote?.code ?? '--'}</span>
            <span className="taskbar-tooltip-market">{stock?.marketLabel ?? '实时行情'}</span>
          </span>
          <span className="taskbar-tooltip-header-meta">
            <span className="taskbar-tooltip-cumulative-profit" title="已清仓收益（人民币）">
              <span>已清仓收益</span>
              <b className={valueClass(cumulativeProfit)}>
                {formatMoneyProfit(cumulativeProfit, 'CNY')}
              </b>
            </span>
            <span className="taskbar-tooltip-update-time">
              {formatUpdateTime(quote?.dataAt ?? quote?.updatedAt)}
            </span>
          </span>
        </header>
      )}

      <div className={`taskbar-tooltip-price-row ${valueClass(quote?.changePercent)}`}>
        <strong>
          <span
            className={embedded ? 'menu-bar-animated-value' : undefined}
            data-menu-bar-value={embedded ? 'price' : undefined}
          >
            <AnimatedNumber value={quote?.latest} formatValue={formatCurrency} />
          </span>
        </strong>
        <span className="taskbar-tooltip-price-change">
          <span>
            <span
              className={embedded ? 'menu-bar-animated-value' : undefined}
              data-menu-bar-value={embedded ? 'change' : undefined}
            >
              <AnimatedNumber value={quote?.change} formatValue={formatSigned} />
            </span>
          </span>
          <span>
            <span
              className={embedded ? 'menu-bar-animated-value' : undefined}
              data-menu-bar-value={embedded ? 'changePercent' : undefined}
            >
              {formatPercent(quote?.changePercent)}
            </span>
          </span>
        </span>
        {quote?.sector ? (
          <span className="taskbar-tooltip-sector" title={quote.sector.name}>
            <span>{quote.sector.name}</span>
            <b className={valueClass(quote.sector.changePercent)}>
              {formatPercent(quote.sector.changePercent)}
            </b>
          </span>
        ) : null}
        <span className={`taskbar-tooltip-today-profit ${valueClass(positionMetrics.todayProfit)}`}>
          <span className="taskbar-tooltip-today-label">今日</span>
          <span
            className={embedded ? 'menu-bar-animated-value' : undefined}
            data-menu-bar-value={embedded ? 'todayProfit' : undefined}
          >
            <AnimatedNumber
              value={positionMetrics.todayProfit}
              formattedValue={formatMoneyProfit(
                positionMetrics.todayProfit,
                positionMetrics.currency
              )}
            />
          </span>
        </span>
      </div>

      <dl className="taskbar-tooltip-details">
        <div>
          <dt>今开</dt>
          <dd>
            <AnimatedNumber value={quote?.open} formatValue={formatCurrency} />
          </dd>
        </div>
        <div>
          <dt>最高</dt>
          <dd>
            <AnimatedNumber value={quote?.high} formatValue={formatCurrency} />
          </dd>
        </div>
        <div>
          <dt>最低</dt>
          <dd>
            <AnimatedNumber value={quote?.low} formatValue={formatCurrency} />
          </dd>
        </div>
        <div>
          <dt>换手</dt>
          <dd>{formatPercent(quote?.turnoverRate).replace(/^\+/, '')}</dd>
        </div>
        <div>
          <dt>均价</dt>
          <dd>
            <AnimatedNumber value={quote?.averagePrice} formatValue={formatCurrency} />
          </dd>
        </div>
      </dl>

      <dl className="taskbar-tooltip-inline-market">
        <MiniPriceSparkline
          prices={sparklineBars.map((bar) => bar.close)}
          volumeBars={sparklineBars}
          volumeUnit={volumeUnitForMarket(market)}
          intervalMinutes={currentIntraday?.intervalMinutes}
          expanded
        />
        <FiveLevelOrderBook orderBook={currentOrderBook} />
      </dl>

      <section className="taskbar-tooltip-section">
        <div className="taskbar-tooltip-position-grid">
          <span>
            <small>持仓 | 可用（股）</small>
            <b>
              {stock?.position?.quantity.toLocaleString('zh-CN') ?? '--'} |{' '}
              {hasPosition ? (availablePositionQuantity?.toLocaleString('zh-CN') ?? '--') : '--'}
            </b>
          </span>
          <span>
            <small>天数</small>
            <b>{holdingDays === null ? '--' : `${holdingDays} 天`}</b>
          </span>
          <span>
            <small>成本</small>
            <b>
              <AnimatedNumber
                value={positionMetrics.holdingCost}
                formattedValue={
                  positionMetrics.holdingCost !== null
                    ? `${STOCK_CURRENCY_SYMBOLS[positionMetrics.currency]}${formatCost(positionMetrics.holdingCost)}`
                    : '--'
                }
              />
            </b>
          </span>
          <span>
            <small>市值</small>
            <b>
              <AnimatedNumber
                value={positionMetrics.marketValue}
                formattedValue={formatMoney(positionMetrics.marketValue, positionMetrics.currency)}
              />
            </b>
          </span>
          <span>
            <small>{hasPosition ? '收益' : '已清仓收益'}</small>
            <b className={valueClass(displayedTotalProfit)}>
              <AnimatedNumber
                value={displayedTotalProfit}
                formattedValue={formatMoneyProfit(displayedTotalProfit, displayedProfitCurrency)}
              />
            </b>
          </span>
          <span>
            <small>收益率</small>
            <b className={valueClass(displayedProfitPercent)}>
              {formatPercent(displayedProfitPercent)}
            </b>
          </span>
        </div>
      </section>

      {overview.summaries.map(({ batch, trades, feeContext, metrics: tMetrics }) => {
        const closingSide = tMetrics.direction === 'reverse' ? 'buy' : 'sell'
        const latest = quote?.latest
        const levels = getTPlanRows(
          batch,
          trades,
          closingSide,
          feeState.settings.tTradingFees,
          stock?.marketLabel ?? marketLabelForQuoteId(quoteId),
          {
            market,
            marketTradeFees: feeState.settings.marketTradeFees,
            accountFeeContext: feeContext,
            stampDutyExempt: stock?.instrumentType === 'etf',
            instrumentType: stock?.instrumentType
          }
        ).flatMap(({ index, quantity, targetPrice, fullPositionProfit }) =>
          quantity > 0 && targetPrice !== null ? [{ index, targetPrice, fullPositionProfit }] : []
        )
        const nextLevel =
          latest == null
            ? undefined
            : (levels.find((level) =>
                closingSide === 'buy' ? latest >= level.targetPrice : latest <= level.targetPrice
              ) ?? levels.at(-1))

        return (
          <section className="taskbar-tooltip-section" key={batch.id}>
            <div className="taskbar-tooltip-t-summary">
              <strong>{tMetrics.direction === 'reverse' ? '反T' : '正T'}</strong>
              <span>剩余 {formatShares(tMetrics.remainingQuantity)}</span>
              <span>
                成本 <AnimatedNumber value={tMetrics.averageCost} formatValue={formatCost} />
              </span>
              <span>
                {closingSide === 'buy' ? '买入' : '卖出'}{' '}
                {nextLevel ? `T${nextLevel.index + 1}` : '--'}
                {nextLevel ? (
                  <>
                    <AnimatedNumber value={nextLevel.targetPrice} formatValue={formatPrice} />
                    <AnimatedNumber
                      value={nextLevel.fullPositionProfit}
                      formattedValue={`(${formatMoneyProfit(nextLevel.fullPositionProfit, currency)})`}
                      className={valueClass(nextLevel.fullPositionProfit)}
                    />
                  </>
                ) : null}
              </span>
              <span className={valueClass(tMetrics.floatingProfit)}>
                浮动{' '}
                <AnimatedNumber
                  value={tMetrics.floatingProfit}
                  formattedValue={formatMoneyProfit(
                    tMetrics.floatingProfit,
                    positionMetrics.currency
                  )}
                />
                {tMetrics.floatingProfitRate !== null ? (
                  <span className={valueClass(tMetrics.floatingProfitRate)}>
                    {' '}
                    ({formatPercent(tMetrics.floatingProfitRate)})
                  </span>
                ) : null}
              </span>
            </div>
          </section>
        )
      })}

      {alertCount > 0 ? (
        <section className="taskbar-tooltip-section taskbar-tooltip-alert-section">
          <ul className="taskbar-tooltip-alert-list">
            {stopLoss?.reached ? (
              <li className="is-lte">
                <b>止损提醒</b>
                <span>
                  已达到止损线，止损价 {formatPrice(stopLoss.stopPrice)}，当前{' '}
                  <AnimatedNumber value={stopLoss.latest} formatValue={formatPrice} />
                </span>
              </li>
            ) : null}
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
                    {rule.metric === 'price' ? (
                      <AnimatedNumber
                        value={rule.target}
                        formattedValue={formatStockAlertValue(
                          rule.metric,
                          rule.target,
                          stock?.currency
                        )}
                      />
                    ) : (
                      formatStockAlertValue(rule.metric, rule.target, stock?.currency)
                    )}
                    ，当前{' '}
                    {rule.metric === 'price' ? (
                      <AnimatedNumber
                        value={actualValue}
                        formattedValue={
                          actualValue === null || actualValue === undefined
                            ? '--'
                            : formatStockAlertValue(rule.metric, actualValue, stock?.currency)
                        }
                      />
                    ) : actualValue === null || actualValue === undefined ? (
                      '--'
                    ) : (
                      formatStockAlertValue(rule.metric, actualValue, stock?.currency)
                    )}
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
                  ，目标价 <AnimatedNumber value={badge.targetPrice} formatValue={formatPrice} />
                </span>
              </li>
            ))}
            {fiveLevelAlerts.map((alert) => (
              <li className={`is-five-level-order is-${alert.side}`} key={alert.side}>
                <b>五档大单</b>
                <span>
                  {alert.side === 'buy' ? '买' : '卖'}
                  {alert.level} 价格{' '}
                  <AnimatedNumber value={alert.price} formatValue={formatPrice} />
                  ，挂单 {formatLargeOrderVolume(alert.volume)}，其余四档{' '}
                  {formatLargeOrderVolume(alert.otherLevelsVolume)}
                </span>
              </li>
            ))}
            {overview.floatingAlerts.map((summary) => {
              const threshold =
                (summary.floatingAlert === 'profit' ? 1 : -1) *
                summary.batch.floatingProfitAlert!.threshold
              return (
                <li key={summary.account.accountId} className={`is-${summary.floatingAlert}`}>
                  <b>T浮动收益</b>
                  <span>
                    {summary.account.accountName} · 当前{' '}
                    <AnimatedNumber
                      value={summary.metrics.floatingProfit}
                      className={valueClass(summary.metrics.floatingProfit)}
                      formattedValue={formatMoneyProfit(
                        summary.metrics.floatingProfit,
                        positionMetrics.currency
                      )}
                    />
                    ，提醒值{' '}
                    <AnimatedNumber
                      value={threshold}
                      className={valueClass(threshold)}
                      formattedValue={formatMoneyProfit(threshold, positionMetrics.currency)}
                    />
                  </span>
                </li>
              )
            })}
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
