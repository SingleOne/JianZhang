import type {
  StockAlertMetric,
  StockAlertRule,
  StockQuote,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import { calculatePositionMetrics } from './portfolio'

export const STOCK_ALERT_METRIC_LABELS: Record<StockAlertMetric, string> = {
  price: '股价',
  changePercent: '当日涨幅',
  profitPercent: '持仓收益率'
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
  accounts: TTradingAccounts
): number | null {
  if (metric === 'price') return quote.latest
  if (metric === 'changePercent') return quote.changePercent
  return calculatePositionMetrics(stock.position, quote, accounts[stock.quoteId]).profitPercent
}

function isConditionMet(rule: StockAlertRule, actualValue: number): boolean {
  return rule.operator === 'gte'
    ? actualValue >= rule.target
    : actualValue <= rule.target
}

export function applyStockAlertTriggers(
  watchlist: WatchStock[],
  quotes: StockQuote[],
  accounts: TTradingAccounts
): StockAlertUpdate {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  const triggered: TriggeredStockAlert[] = []
  let changed = false

  const nextWatchlist = watchlist.map((stock) => {
    const quote = quoteMap.get(stock.quoteId)
    if (!quote || !stock.alertRules?.length) return stock

    let stockChanged = false
    const alertRules = stock.alertRules.map((rule) => {
      if (!rule.enabled) {
        if (rule.status !== 'triggered') return rule
        stockChanged = true
        return { ...rule, status: 'armed' as const, triggeredAt: undefined }
      }

      const actualValue = getMetricValue(rule.metric, stock, quote, accounts)
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

export function formatStockAlertValue(metric: StockAlertMetric, value: number): string {
  if (metric === 'price') {
    return value >= 100 ? value.toFixed(2) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function formatStockAlertNotification(alert: TriggeredStockAlert): {
  title: string
  body: string
} {
  const metricLabel = STOCK_ALERT_METRIC_LABELS[alert.rule.metric]
  const operatorLabel = alert.rule.operator === 'gte' ? '达到或高于' : '达到或低于'
  return {
    title: `${alert.stock.name} ${metricLabel}提醒`,
    body: `当前${metricLabel} ${formatStockAlertValue(alert.rule.metric, alert.actualValue)}，已${operatorLabel}设定值 ${formatStockAlertValue(alert.rule.metric, alert.rule.target)}`
  }
}
