import { BellRing, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatPercent, formatPrice } from '../lib/format'
import { calculatePositionMetrics } from '../lib/portfolio'
import { STOCK_ALERT_METRIC_LABELS } from '../lib/stock-alerts'
import type {
  StockAlertMetric,
  StockAlertRule,
  StockQuote,
  TTradingAccount,
  WatchStock
} from '../shared/types'

interface StockAlertDialogProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  onSave: (rules: StockAlertRule[]) => void
  onClose: () => void
}

type DraftRule = Omit<StockAlertRule, 'target'> & { target: string }

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function StockAlertDialog({
  stock,
  quote,
  account,
  onSave,
  onClose
}: StockAlertDialogProps) {
  const metrics = calculatePositionMetrics(stock.position, quote, account)
  const [rules, setRules] = useState<DraftRule[]>(() => (stock.alertRules ?? []).map((rule) => ({
    ...rule,
    target: String(rule.target)
  })))

  const currentValue = (metric: StockAlertMetric): number | null => {
    if (metric === 'price') return quote?.latest ?? null
    if (metric === 'changePercent') return quote?.changePercent ?? null
    return metrics.profitPercent
  }

  const addRule = () => {
    setRules((current) => [...current, {
      id: crypto.randomUUID(),
      metric: 'price',
      operator: 'gte',
      target: quote?.latest?.toString() ?? '',
      enabled: true,
      status: 'armed'
    }])
  }

  const updateRule = (ruleId: string, changes: Partial<DraftRule>) => {
    setRules((current) => current.map((rule) => (
      rule.id === ruleId
        ? { ...rule, ...changes, status: 'armed', triggeredAt: undefined }
        : rule
    )))
  }

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
            <span className="position-dialog-icon"><BellRing size={18} /></span>
            <span>
              <strong id="stock-alert-dialog-title">股价提醒</strong>
              <small>{stock.name} · {stock.code} · 可同时设置多条规则</small>
            </span>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <form
          className="stock-alert-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(rules.map(({ target, ...rule }) => ({
              ...rule,
              target: Number(target)
            })))
          }}
        >
          <div className="stock-alert-current-values">
            <span>
              <small>当前股价</small>
              <strong>{formatPrice(quote?.latest)}</strong>
            </span>
            <span>
              <small>当日涨幅</small>
              <strong className={valueClass(quote?.changePercent)}>{formatPercent(quote?.changePercent)}</strong>
            </span>
            <span>
              <small>持仓收益率</small>
              <strong className={valueClass(metrics.profitPercent)}>{formatPercent(metrics.profitPercent)}</strong>
            </span>
          </div>

          <div className="stock-alert-list-heading">
            <span>
              <strong>提醒条件</strong>
              <small>条件首次满足时发送 Windows 系统通知；行情离开阈值后会自动恢复监控。</small>
            </span>
            <button className="secondary-button stock-alert-add" type="button" onClick={addRule}>
              <Plus size={14} />
              添加条件
            </button>
          </div>

          <div className="stock-alert-list">
            {rules.map((rule, index) => {
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
                <div className={`stock-alert-rule ${rule.enabled ? 'is-enabled' : ''}`} key={rule.id}>
                  <span className="stock-alert-rule-index">{index + 1}</span>
                  <select
                    value={rule.metric}
                    onChange={(event) => {
                      const metric = event.target.value as StockAlertMetric
                      const nextValue = currentValue(metric)
                      updateRule(rule.id, {
                        metric,
                        target: nextValue === null ? '' : String(nextValue)
                      })
                    }}
                    aria-label={`提醒条件 ${index + 1} 指标`}
                  >
                    {Object.entries(STOCK_ALERT_METRIC_LABELS).map(([metric, label]) => (
                      <option value={metric} key={metric}>{label}</option>
                    ))}
                  </select>
                  <select
                    className={`stock-alert-operator is-${rule.operator}`}
                    value={rule.operator}
                    onChange={(event) => updateRule(rule.id, {
                      operator: event.target.value as StockAlertRule['operator']
                    })}
                    aria-label={`提醒条件 ${index + 1} 比较方式`}
                  >
                    <option value="gte">达到或高于</option>
                    <option value="lte">达到或低于</option>
                  </select>
                  <label className="stock-alert-target">
                    <input
                      className={percentageRule ? valueClass(Number.isFinite(targetValue) ? targetValue : 0) : ''}
                      type="number"
                      min={rule.metric === 'price' ? '0.001' : undefined}
                      step={rule.metric === 'price' ? '0.001' : '0.1'}
                      required
                      value={rule.target}
                      onChange={(event) => updateRule(rule.id, { target: event.target.value })}
                      aria-label={`提醒条件 ${index + 1} 设定值`}
                    />
                    <span>{rule.metric === 'price' ? '元' : '%'}</span>
                  </label>
                  <span className={`stock-alert-status ${rule.status === 'triggered' && rule.enabled ? `is-triggered is-triggered-${rule.operator}` : ''}`}>
                    {statusLabel}
                    {actualValue !== null ? (
                      <small className={percentageRule ? valueClass(actualValue) : ''}>
                        当前 {rule.metric === 'price' ? formatPrice(actualValue) : formatPercent(actualValue)}
                      </small>
                    ) : null}
                  </span>
                  <label className="stock-alert-enable">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                    />
                    <span>启用</span>
                  </label>
                  <button
                    className="icon-button stock-alert-delete"
                    type="button"
                    onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}
                    title="删除提醒条件"
                    aria-label={`删除提醒条件 ${index + 1}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
            {rules.length === 0 ? (
              <div className="stock-alert-empty">
                还没有提醒条件。点击“添加条件”后，可分别设置股价、当日涨幅或持仓收益率阈值。
              </div>
            ) : null}
          </div>

          <footer className="position-dialog-actions stock-alert-actions">
            <small>提醒依赖实时行情刷新，应用最小化到托盘后仍会继续监控。</small>
            <span>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button>
              <button className="primary-button compact-button" type="submit">保存提醒</button>
            </span>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
