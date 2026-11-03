import type { MarketCalendarDates } from '../shared/market-calendar'
import { StopLossEditor } from './StopLossEditor'
import { createStopLossRule, type StopLossRule } from '../shared/stop-loss'
import type { StockTradingBook } from '../shared/types'
import { BellRing, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AppButton } from './AppButton'
import { AppInput, AppSwitch } from './AppFormControls'
import { AppSelect } from './AppSelect'
import { formatPercent, formatPrice } from '../lib/format'
import { calculatePositionMetrics, type PositionProfitOverride } from '../lib/portfolio'
import { STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import {
  marketCapabilitiesForQuoteId,
  stockMarketIdentity,
  STOCK_CURRENCY_SYMBOLS
} from '../shared/stock-market'
import type {
  StockAlertMetric,
  StockAlertRule,
  StockQuote,
  ExchangeRateSettings,
  TTradingAccount,
  WatchStock
} from '../shared/types'

interface StockAlertDialogProps {
  stock: WatchStock
  quote: StockQuote | undefined
  calendar?: MarketCalendarDates
  account: TTradingAccount | StockTradingBook | undefined
  exchangeRates: ExchangeRateSettings
  profitOverride: PositionProfitOverride | undefined
  onSave: (rules: StockAlertRule[], stopLoss?: StopLossRule) => void
  onClose: () => void
}

type PriceDraftRule = Omit<StockAlertRule, 'target'> & { target: string }
type DraftRule = PriceDraftRule | { id: string; metric: 'stopLoss' }

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function StockAlertDialog({
  stock,
  quote,
  calendar,
  account,
  exchangeRates,
  profitOverride,
  onSave,
  onClose
}: StockAlertDialogProps) {
  const [stopLoss, setStopLoss] = useState(stock.stopLoss)
  const [stopLossError, setStopLossError] = useState('')
  const hasPosition = (stock.position?.quantity ?? 0) > 0
  const capabilities = marketCapabilitiesForQuoteId(stock.quoteId)
  const currency = stock.currency ?? stockMarketIdentity(stock.quoteId).currency
  const currencySymbol = STOCK_CURRENCY_SYMBOLS[currency]
  const metrics = calculatePositionMetrics(
    stock.position,
    quote,
    account,
    exchangeRates,
    profitOverride
  )
  const availableMetrics = Object.entries(STOCK_ALERT_METRIC_LABELS).filter(
    ([metric]) => metric !== 'profitPercent' || capabilities.profitAlert
  )
  const [rules, setRules] = useState<DraftRule[]>(() => [
    ...(stock.alertRules ?? [])
      .filter((rule) => rule.metric !== 'profitPercent' || capabilities.profitAlert)
      .map((rule) => ({
        ...rule,
        target: String(rule.target)
      })),
    ...(stock.stopLoss && hasPosition
      ? [{ id: crypto.randomUUID(), metric: 'stopLoss' as const }]
      : [])
  ])

  const currentValue = (metric: StockAlertMetric): number | null => {
    if (metric === 'price') return quote?.latest ?? null
    if (metric === 'changePercent') return quote?.changePercent ?? null
    return metrics.profitPercent
  }

  const addRule = () => {
    setRules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        metric: 'price',
        operator: 'gte',
        target: quote?.latest?.toString() ?? '',
        enabled: true,
        status: 'armed'
      }
    ])
  }

  const updateRule = (ruleId: string, changes: Partial<PriceDraftRule>) => {
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId && rule.metric !== 'stopLoss'
          ? { ...rule, ...changes, status: 'armed', triggeredAt: undefined }
          : rule
      )
    )
  }

  const changeMetric = (ruleId: string, metric: DraftRule['metric']) => {
    const previous = rules.find((rule) => rule.id === ruleId)!
    if (previous.metric === metric) return
    if (metric === 'stopLoss') {
      setStopLoss(createStopLossRule(stock, quote, 'trailingClose', 5, new Date(), calendar))
    } else if (previous.metric === 'stopLoss') {
      setStopLoss(undefined)
    }
    setStopLossError('')
    setRules((current) =>
      current.map((rule): DraftRule => {
        if (rule.id !== ruleId) return rule
        if (metric === 'stopLoss') return { id: rule.id, metric }
        const value = currentValue(metric)
        return {
          ...(rule.metric === 'stopLoss' ? { id: rule.id, operator: 'gte', enabled: true } : rule),
          metric,
          target: value === null ? '' : String(value),
          status: 'armed',
          triggeredAt: undefined
        }
      })
    )
  }

  const metricSelect = (rule: DraftRule, index: number) => (
    <AppSelect
      className="stock-alert-metric"
      value={rule.metric}
      options={[
        ...availableMetrics.map(([value, label]) => ({ value: value as StockAlertMetric, label })),
        ...(hasPosition && !rules.some((item) => item.id !== rule.id && item.metric === 'stopLoss')
          ? [{ value: 'stopLoss' as const, label: '止损线' }]
          : [])
      ]}
      onChange={(metric) => changeMetric(rule.id, metric)}
      label={`提醒条件 ${index + 1} 指标`}
      portal
    />
  )

  const deleteButton = (rule: DraftRule, index: number) => (
    <AppButton
      variant="icon"
      className="stock-alert-delete"
      onClick={() => {
        if (rule.metric === 'stopLoss') {
          setStopLoss(undefined)
          setStopLossError('')
        }
        setRules((current) => current.filter((item) => item.id !== rule.id))
      }}
      title="删除提醒条件"
      aria-label={`删除提醒条件 ${index + 1}`}
    >
      <Trash2 size={15} />
    </AppButton>
  )

  return createPortal(
    <div className="position-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="position-dialog stock-alert-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-alert-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <header className="position-dialog-header">
          <div>
            <span className="position-dialog-icon">
              <BellRing size={18} />
            </span>
            <span>
              <strong id="stock-alert-dialog-title">股价提醒</strong>
              <small>
                {stock.name} · {stock.code} · 可同时设置多条规则
              </small>
            </span>
          </div>
          <AppButton
            variant="plain"
            className="icon-button dialog-close"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </AppButton>
        </header>

        <form
          className="stock-alert-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (rules.some((rule) => rule.metric === 'stopLoss') && !stopLoss) {
              setStopLossError('请先设置有效的止损基准后再保存。')
              return
            }
            onSave(
              rules.flatMap((rule) =>
                rule.metric === 'stopLoss' ? [] : [{ ...rule, target: Number(rule.target) }]
              ),
              stopLoss
            )
          }}
        >
          <div className="stock-alert-current-values">
            <span>
              <small>当前股价</small>
              <strong>{formatPrice(quote?.latest)}</strong>
            </span>
            <span>
              <small>当日涨幅</small>
              <strong className={valueClass(quote?.changePercent)}>
                {formatPercent(quote?.changePercent)}
              </strong>
            </span>
            {capabilities.profitAlert ? (
              <span>
                <small>持仓收益率</small>
                <strong className={valueClass(metrics.profitPercent)}>
                  {formatPercent(metrics.profitPercent)}
                </strong>
              </span>
            ) : null}
          </div>

          <div className="stock-alert-list-heading">
            <span>
              <strong>提醒条件</strong>
              <small>条件首次满足时发送 Windows 系统通知；行情离开阈值后会自动恢复监控。</small>
            </span>
            <AppButton
              variant="plain"
              className="secondary-button stock-alert-add"
              type="button"
              onClick={addRule}
            >
              <Plus size={14} />
              添加条件
            </AppButton>
          </div>

          <div className="stock-alert-list">
            {rules.map((rule, index) => {
              if (rule.metric === 'stopLoss') {
                return (
                  <div className="stock-alert-rule stock-alert-stop-loss is-enabled" key={rule.id}>
                    <span className="stock-alert-rule-index">{index + 1}</span>
                    {metricSelect(rule, index)}
                    <StopLossEditor
                      stock={stock}
                      quote={quote}
                      calendar={calendar}
                      rule={stopLoss}
                      onChange={(next) => {
                        setStopLoss(next)
                        setStopLossError('')
                      }}
                    />
                    {deleteButton(rule, index)}
                  </div>
                )
              }
              const actualValue = currentValue(rule.metric)
              const targetValue = Number(rule.target)
              const percentageRule = rule.metric !== 'price'
              const statusLabel = !rule.enabled
                ? '已停用'
                : rule.metric === 'profitPercent' && !stock.position
                  ? '等待持仓'
                  : rule.status === 'triggered'
                    ? '当前已达到'
                    : '监控中'
              return (
                <div
                  className={`stock-alert-rule ${rule.enabled ? 'is-enabled' : ''}`}
                  key={rule.id}
                >
                  <span className="stock-alert-rule-index">{index + 1}</span>
                  {metricSelect(rule, index)}
                  <AppSelect
                    className={`stock-alert-operator is-${rule.operator}`}
                    value={rule.operator}
                    options={[
                      { value: 'gte', label: '达到或高于' },
                      { value: 'lte', label: '达到或低于' }
                    ]}
                    onChange={(operator) => updateRule(rule.id, { operator })}
                    label={`提醒条件 ${index + 1} 比较方式`}
                    portal
                  />
                  <label className="stock-alert-target">
                    <AppInput
                      className={
                        percentageRule
                          ? valueClass(Number.isFinite(targetValue) ? targetValue : 0)
                          : ''
                      }
                      type="number"
                      min={rule.metric === 'price' ? '0.01' : undefined}
                      step={rule.metric === 'price' ? '0.01' : '0.1'}
                      required
                      value={rule.target}
                      onChange={(event) => updateRule(rule.id, { target: event.target.value })}
                      aria-label={`提醒条件 ${index + 1} 设定值`}
                    />
                    <span>{rule.metric === 'price' ? currencySymbol : '%'}</span>
                  </label>
                  <span
                    className={`stock-alert-status ${rule.status === 'triggered' && rule.enabled ? `is-triggered is-triggered-${rule.operator}` : ''}`}
                  >
                    {statusLabel}
                    {actualValue !== null ? (
                      <small className={percentageRule ? valueClass(actualValue) : ''}>
                        当前{' '}
                        {rule.metric === 'price'
                          ? formatPrice(actualValue)
                          : formatPercent(actualValue)}
                      </small>
                    ) : null}
                  </span>
                  <AppSwitch
                    className="stock-alert-enable"
                    label="启用"
                    checked={rule.enabled}
                    onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                  />
                  {deleteButton(rule, index)}
                </div>
              )
            })}
            {rules.length === 0 ? (
              <div className="stock-alert-empty">
                {capabilities.profitAlert
                  ? '还没有提醒条件。点击“添加条件”后，可分别设置股价、当日涨幅或持仓收益率阈值。'
                  : '还没有提醒条件。点击“添加条件”后，可设置股价或当日涨跌幅阈值。'}
                {hasPosition ? '也可在条件选择框中选择“止损线”。' : null}
              </div>
            ) : null}
          </div>

          {stopLossError ? (
            <p className="stock-alert-error" role="alert">
              {stopLossError}
            </p>
          ) : null}

          <footer className="position-dialog-actions stock-alert-actions">
            <small>提醒依赖实时行情刷新，应用最小化到托盘后仍会继续监控。</small>
            <span>
              <AppButton
                variant="plain"
                className="secondary-button compact-button"
                type="button"
                onClick={onClose}
              >
                取消
              </AppButton>
              <AppButton variant="plain" className="primary-button compact-button" type="submit">
                保存提醒
              </AppButton>
            </span>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
