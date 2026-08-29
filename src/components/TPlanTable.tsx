import { formatCost, formatProfit, formatShares } from '../lib/format'
import type { TAlertSide, TPlanRow } from '../lib/t-alerts'

interface TPlanTableProps {
  side: TAlertSide
  rows: readonly TPlanRow[]
  alertEnabled: boolean
  emphasized: boolean
  openingPlan: boolean
  onUpdateLevel: (index: number, key: 'targetPercent' | 'quantity', value: number) => void
  onHandleAlert: (index?: number) => void
  onRestoreAlert: (index: number) => void
}

function valueClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatTargetPrice(value: number | null): string {
  return value === null ? '--' : value.toFixed(2)
}

export function TPlanTable({
  side,
  rows,
  alertEnabled,
  emphasized,
  openingPlan,
  onUpdateLevel,
  onHandleAlert,
  onRestoreAlert
}: TPlanTableProps) {
  const isBuy = side === 'buy'
  const triggeredCount = rows.filter((row) => row.alertStatus === 'triggered').length
  const sideLabel = isBuy ? '买入五档' : '卖出五档'
  const planHint = openingPlan
    ? isBuy
      ? '目标买入后的T仓仓位与成本'
      : '目标卖出后的反T仓位与成本'
    : isBuy
      ? '目标跌幅 -1% 至 -5%'
      : '目标涨幅 +1% 至 +5%'

  return (
    <section
      className={`t-plan-table is-${side} ${emphasized ? 'is-emphasized' : ''} ${openingPlan ? 'is-opening-plan' : ''}`}
    >
      <header className="t-plan-table-heading">
        <span>
          <strong>{sideLabel}</strong>
          <small>{planHint}</small>
        </span>
        {alertEnabled && triggeredCount > 0 ? (
          <button type="button" className="text-button" onClick={() => onHandleAlert()}>
            处理触发 {triggeredCount}
          </button>
        ) : null}
      </header>
      <div className="t-plan-levels">
        <div className="t-plan-level t-plan-level-head">
          <span>档位</span>
          <span>{isBuy ? '跌幅' : '涨幅'}</span>
          <span>目标价</span>
          <span>数量</span>
          {openingPlan ? (
            <>
              <span>{isBuy ? '买后T仓' : '卖后反T仓'}</span>
              <span>{isBuy ? '买后成本' : '卖后成本'}</span>
            </>
          ) : (
            <>
              <span title="本档价差收益">本档</span>
              <span title="累计价差收益">累计</span>
              <span title="全仓价差收益">全仓</span>
            </>
          )}
        </div>
        {rows.map((level) => {
          const status = level.alertStatus ?? 'armed'
          return (
            <div className="t-plan-level" key={level.index}>
              {alertEnabled && status !== 'armed' ? (
                <button
                  type="button"
                  className={`t-plan-alert-action is-${status}`}
                  onClick={() => {
                    if (status === 'triggered') onHandleAlert(level.index)
                    else onRestoreAlert(level.index)
                  }}
                  title={
                    status === 'triggered'
                      ? `标记 T${level.index + 1} 已处理`
                      : `恢复 T${level.index + 1} 提醒`
                  }
                >
                  T{level.index + 1}
                </button>
              ) : (
                <strong>T{level.index + 1}</strong>
              )}
              <label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={level.targetPercent}
                  onChange={(event) =>
                    onUpdateLevel(level.index, 'targetPercent', Number(event.target.value))
                  }
                />
                <span>%</span>
              </label>
              <span>{formatTargetPrice(level.targetPrice)}</span>
              <label>
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={level.quantity || ''}
                  onChange={(event) =>
                    onUpdateLevel(level.index, 'quantity', Number(event.target.value))
                  }
                />
                <span>股</span>
              </label>
              {openingPlan ? (
                <>
                  <span>{formatShares(level.projectedQuantity)}</span>
                  <span>{formatCost(level.projectedCost)}</span>
                </>
              ) : (
                <>
                  <span className={valueClass(level.expectedProfit)}>
                    {formatProfit(level.expectedProfit)}
                  </span>
                  <span className={valueClass(level.cumulativeProfit)}>
                    {formatProfit(level.cumulativeProfit)}
                  </span>
                  <span className={valueClass(level.fullPositionProfit)}>
                    {formatProfit(level.fullPositionProfit)}
                  </span>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
