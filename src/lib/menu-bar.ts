import type { AppState, StockQuote } from '../shared/types'
import { marketFromQuoteId } from '../shared/stock-market'
import { formatMoneyProfit, formatPercent, formatPrice } from './format'
import { STOCK_QUOTE_DATA_STATE_LABELS, stockQuoteDataState } from './quote-state'
import { getTriggeredStockAlertDirection } from './stock-alerts'
import { getTraySummaryStocks, getTrayTodayProfitTotal } from './tray-summary'

function colored(value: string, direction: number | null | undefined): string {
  if (!direction) return value
  return `\u001b[${direction > 0 ? 31 : 32}m${value}\u001b[0m`
}

export function getMenuBarQuoteStatus(
  state: AppState,
  quote: StockQuote | undefined,
  now = new Date()
) {
  return stockQuoteDataState(
    quote,
    now,
    quote
      ? state.settings.tradingCalendar.markets[quote.market ?? marketFromQuoteId(quote.quoteId)]
      : undefined
  )
}

export function getMenuBarPresentation(
  state: AppState,
  quotes: readonly StockQuote[],
  rotationIndex: number,
  now = new Date()
) {
  const stocks = getTraySummaryStocks(state, quotes)
  const { settings } = state
  if (!settings.showTaskbarTicker || stocks.length === 0) {
    return { title: '', tooltip: '见涨 · 点击查看行情，右键打开菜单', quoteId: null, titles: [] }
  }
  const fixedIndex = Math.max(
    0,
    stocks.findIndex(({ stock }) => stock.quoteId === settings.menuBarQuoteId)
  )
  const selected = stocks[(fixedIndex + rotationIndex) % stocks.length]
  const hasAlert = stocks.some(
    (item) =>
      getTriggeredStockAlertDirection(item.stock.alertRules) ||
      item.alertBadges.length > 0 ||
      item.floatingAlerts.length > 0
  )
  const alertPrefix = hasAlert ? '! ' : ''
  const tooltip = stocks
    .map((item) => {
      const dataState = getMenuBarQuoteStatus(state, item.quote, now)
      return `${item.stock.name} ${formatPrice(item.quote?.latest)} ${formatPercent(item.quote?.changePercent)} · ${STOCK_QUOTE_DATA_STATE_LABELS[dataState]}`
    })
    .join('\n')
  if (settings.menuBarDisplayMode === 'icon') {
    return { title: hasAlert ? '!' : '', tooltip, quoteId: null, titles: [] }
  }
  if (settings.menuBarDisplayMode === 'profit') {
    const total = getTrayTodayProfitTotal(stocks)
    const incomplete = stocks.some(
      (item) =>
        (item.stock.position ||
          item.positionMetrics.todayProfit !== null ||
          item.positionMetrics.holdingCostBasis !== null) &&
        item.positionMetrics.cnyTodayProfit === null
    )
    const statuses = stocks.map((item) => getMenuBarQuoteStatus(state, item.quote, now))
    const suffix = statuses.includes('stale')
      ? ' · 过期'
      : incomplete
        ? ' · 不完整'
        : statuses.includes('unknown')
          ? ' · 时间未知'
          : ''
    return {
      title: `${alertPrefix}今日 ${colored(formatMoneyProfit(total, 'CNY'), total)}${suffix}`,
      tooltip: `所选股票今日收益合计（人民币）\n${tooltip}`,
      quoteId: null,
      titles: []
    }
  }
  const titles = stocks.map(({ stock, quote }) => {
    const name = Array.from(
      stock.name.replaceAll('\u001b', '').replaceAll('\r', '').replaceAll('\n', '')
    )
      .slice(0, 6)
      .join('')
    const status = getMenuBarQuoteStatus(state, quote, now)
    const statusSuffix = status === 'live' ? '' : ` · ${STOCK_QUOTE_DATA_STATE_LABELS[status]}`
    return `${alertPrefix}${name} ${formatPrice(quote?.latest)} ${colored(formatPercent(quote?.changePercent), quote?.changePercent)}${statusSuffix}`
  })
  return {
    title: titles[(fixedIndex + rotationIndex) % stocks.length],
    tooltip,
    quoteId: selected.stock.quoteId,
    titles
  }
}

export type MenuBarPresentation = ReturnType<typeof getMenuBarPresentation>
