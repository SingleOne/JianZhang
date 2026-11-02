import type { MarketCalendarDates } from '../shared/market-calendar'
import { useState } from 'react'
import { createStopLossRule, evaluateStopLoss, type StopLossRule } from '../shared/stop-loss'
import type { StockQuote, WatchStock } from '../shared/types'
import { formatPrice } from '../lib/format'
import { AppButton } from './AppButton'
import { AppInput, AppSwitch } from './AppFormControls'
import { AppSelect } from './AppSelect'
import './StopLoss.css'

const MODES = [
  {
    value: 'trailingClose' as const,
    label: '收盘价移动',
    description: '已记录的最高收盘价，只上移不下移'
  },
  { value: 'fixedCost' as const, label: '成本价固定', description: '锁定设置时的汇总持仓成本' }
]

export function StopLossEditor({
  stock,
  quote,
  rule,
  calendar,
  onChange
}: {
  stock: WatchStock
  quote?: StockQuote
  rule?: StopLossRule
  calendar?: MarketCalendarDates
  onChange: (rule: StopLossRule | undefined) => void
}) {
  const [mode, setMode] = useState<StopLossRule['mode']>(rule?.mode ?? 'trailingClose')
  const [percent, setPercent] = useState(String(rule?.percent ?? 5))
  const [error, setError] = useState('')
  if ((stock.position?.quantity ?? 0) <= 0) return null
  const reset = (nextMode = mode) => {
    const next = createStopLossRule(stock, quote, nextMode, Number(percent), new Date(), calendar)
    if (!next) {
      setError(
        nextMode === 'trailingClose'
          ? '请先刷新行情，取得有效的昨日收盘价；比例须大于 0 且小于 100。'
          : '当前成本须为正数，比例须大于 0 且小于 100。'
      )
      return false
    }
    setError('')
    onChange(next)
    return true
  }
  const snapshot = evaluateStopLoss({ ...stock, stopLoss: rule }, quote, new Date(), calendar)
  return (
    <section className="stop-loss-editor" aria-label="止损线设置">
      <AppSwitch
        label="启用止损线"
        className="stop-loss-switch"
        checked={Boolean(rule)}
        onChange={(event) => {
          if (event.target.checked) reset()
          else {
            onChange(undefined)
            setError('')
          }
        }}
      />
      <div className="stop-loss-fields">
        <AppSelect
          label="止损线模式"
          value={mode}
          options={MODES}
          onChange={(value) => {
            if (!rule || reset(value)) setMode(value)
          }}
        />
        <label>
          止损比例（%）
          <AppInput
            type="number"
            min="0.01"
            max="99.99"
            step="0.01"
            required={Boolean(rule)}
            disabled={!rule}
            value={percent}
            onChange={(event) => {
              const value = event.target.value
              setPercent(value)
              const number = Number(value)
              if (rule && number > 0 && number < 100) onChange({ ...rule, percent: number })
            }}
          />
        </label>
        {rule ? <AppButton onClick={() => reset()}>重设基准</AppButton> : null}
      </div>
      {snapshot ? (
        <div className="stop-loss-preview" aria-live="polite">
          <span>
            {rule?.mode === 'trailingClose' ? '已记录最高收盘价' : '锁定成本'}{' '}
            {formatPrice(snapshot.referencePrice)}
          </span>
          <strong>止损价 {formatPrice(snapshot.stopPrice)}</strong>
          <span>
            {snapshot.reached === null
              ? '等待有效行情'
              : snapshot.reached
                ? '已达到止损线'
                : '未达到止损线'}
          </span>
        </div>
      ) : null}
      <p>
        按当前汇总持仓设置。关闭或清仓后删除配置；保存后各模块共用计算结果。重设基准可能降低止损价。
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
