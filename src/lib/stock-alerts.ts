import type {
  ExchangeRateSettings,
  PortfolioPerformanceAdjustments,
  StockAlertMetric,
  StockAlertRule,
  StockQuote,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import { DEFAULT_EXCHANGE_RATE_SETTINGS } from '../shared/types'
import { calculatePositionMetrics } from './portfolio'
import { calculateCurrentPositionProfitOverride } from './portfolio-performance'
import { formatPercent, formatPrice } from './format'
import {
  marketCapabilitiesForQuoteId,
  stockMarketIdentity,
  STOCK_CURRENCY_SYMBOLS
} from '../shared/stock-market'
import type { StockCurrency } from '../shared/stock-market'

export const STOCK_ALERT_METRIC_LABELS: Record<StockAlertMetric, string> = {
  price: '股价',
  changePercent: '当日涨幅',
  profitPercent: '持仓收益率'
}

export type TriggeredStockAlertDirection = 'gte' | 'lte' | 'both'

export function getTriggeredStockAlertDirection(
  rules: readonly StockAlertRule[] | undefined
): TriggeredStockAlertDirection | null {
  const triggeredRules = rules?.filter((rule) => rule.enabled && rule.status === 'triggered') ?? []
  const hasGte = triggeredRules.some((rule) => rule.operator === 'gte')
  const hasLte = triggeredRules.some((rule) => rule.operator === 'lte')
  if (hasGte && hasLte) return 'both'
  if (hasGte) return 'gte'
  if (hasLte) return 'lte'
  return null
}

export interface TriggeredStockAlert {
  stock: WatchStock
  rule: StockAlertRule
  actualValue: number
}

export interface StockAlertUpdate {
  watchlist: WatchStock[]
  triggered: TriggeredStockAlert[]
  changed: boolean
}

function getMetricValue(
  metric: StockAlertMetric,
  stock: WatchStock,
  quote: StockQuote,
  accounts: TTradingAccounts,
  exchangeRates: ExchangeRateSettings,
  adjustments: Readonly<PortfolioPerformanceAdjustments>
): number | null {
  if (metric === 'price') return quote.latest
  if (metric === 'changePercent') return quote.changePercent
  const account = accounts[stock.quoteId]
  const profitOverride = calculateCurrentPositionProfitOverride(
    stock,
    quote,
    account,
    exchangeRates,
    Number.isFinite(adjustments[stock.quoteId]) ? adjustments[stock.quoteId] : 0
  )
  return calculatePositionMetrics(stock.position, quote, account, exchangeRates, profitOverride)
    .profitPercent
}

function isConditionMet(rule: StockAlertRule, actualValue: number): boolean {
  return rule.operator === 'gte' ? actualValue >= rule.target : actualValue <= rule.target
}

export function applyStockAlertTriggers(
  watchlist: WatchStock[],
  quotes: StockQuote[],
  accounts: TTradingAccounts,
  exchangeRates: ExchangeRateSettings = DEFAULT_EXCHANGE_RATE_SETTINGS,
  adjustments: Readonly<PortfolioPerformanceAdjustments> = {}
): StockAlertUpdate {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  const triggered: TriggeredStockAlert[] = []
  let changed = false

  const nextWatchlist = watchlist.map((stock) => {
    const quote = quoteMap.get(stock.quoteId)
    if (!quote || !stock.alertRules?.length) return stock
    const capabilities = marketCapabilitiesForQuoteId(stock.quoteId)

    let stockChanged = false
    const alertRules = stock.alertRules.map((rule) => {
      if (rule.metric === 'profitPercent' && !capabilities.profitAlert) {
        if (rule.status !== 'triggered') return rule
        stockChanged = true
        return { ...rule, status: 'armed' as const, triggeredAt: undefined }
      }
      if (!rule.enabled) {
        if (rule.status !== 'triggered') return rule
        stockChanged = true
        return { ...rule, status: 'armed' as const, triggeredAt: undefined }
      }

      const actualValue = getMetricValue(
        rule.metric,
        stock,
        quote,
        accounts,
        exchangeRates,
        adjustments
      )
      if (actualValue === null) return rule

      const conditionMet = isConditionMet(rule, actualValue)
      const wasTriggered = rule.status === 'triggered'
      if (conditionMet === wasTriggered) return rule

      stockChanged = true
      if (conditionMet) {
        const nextRule = {
          ...rule,
          status: 'triggered' as const,
          triggeredAt: new Date().toISOString()
        }
        triggered.push({ stock, rule: nextRule, actualValue })
        return nextRule
      }

      return { ...rule, status: 'armed' as const, triggeredAt: undefined }
    })

    if (!stockChanged) return stock
    changed = true
    return { ...stock, alertRules }
  })

  return { watchlist: nextWatchlist, triggered, changed }
}

export function formatStockAlertValue(
  metric: StockAlertMetric,
  value: number,
  currency: StockCurrency = 'CNY'
): string {
  return metric === 'price'
    ? `${STOCK_CURRENCY_SYMBOLS[currency]}${formatPrice(value)}`
    : formatPercent(value)
}

export function formatStockAlertNotification(alert: TriggeredStockAlert): {
  title: string
  body: string
} {
  const metricLabel = STOCK_ALERT_METRIC_LABELS[alert.rule.metric]
  const operatorLabel = alert.rule.operator === 'gte' ? '达到或高于' : '达到或低于'
  const currency = alert.stock.currency ?? stockMarketIdentity(alert.stock.quoteId).currency
  return {
    title: `${alert.stock.name} ${metricLabel}提醒`,
    body: `当前${metricLabel} ${formatStockAlertValue(alert.rule.metric, alert.actualValue, currency)}，已${operatorLabel}设定值 ${formatStockAlertValue(alert.rule.metric, alert.rule.target, currency)}`
  }
}
