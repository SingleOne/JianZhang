import { BriefcaseBusiness, Camera, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCurrency, formatPercent, formatPrice, formatProfit, formatShares } from '../lib/format'
import { currentDateKey } from '../lib/portfolio'
import type {
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  WatchStock
} from '../shared/types'

interface PositionEditorProps {
  stock: WatchStock
  quote: StockQuote | undefined
  onSave: (
    position: StockPosition | undefined,
    showRadarSignals: boolean,
    positionSnapshots: StockPositionSnapshot[]
  ) => void
  onClose: () => void
}

interface PositionVersionMetrics {
  marketValue: number | null
  totalProfit: number | null
  profitPercent: number | null
}

function calculateVersionMetrics(
  quantity: number,
  cost: number,
  latest: number | null | undefined
): PositionVersionMetrics {
  if (latest === null || latest === undefined) {
    return { marketValue: null, totalProfit: null, profitPercent: null }
  }
  if (quantity <= 0 || cost <= 0) {
    return { marketValue: 0, totalProfit: 0, profitPercent: null }
  }
  return {
    marketValue: latest * quantity,
    totalProfit: (latest - cost) * quantity,
    profitPercent: (latest / cost - 1) * 100
  }
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value)).replaceAll('/', '-')
}

function defaultSnapshotName(createdAt: string): string {
  const date = new Date(createdAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `操作前 ${month}-${day} ${hour}:${minute}`
}

export function PositionEditor({ stock, quote, onSave, onClose }: PositionEditorProps) {
  const [quantity, setQuantity] = useState(stock.position?.quantity.toString() ?? '')
  const [cost, setCost] = useState(stock.position?.cost.toString() ?? '')
  const [openedOn, setOpenedOn] = useState(
    stock.position ? stock.position.openedOn ?? '' : currentDateKey()
  )
  const [showRadarSignals, setShowRadarSignals] = useState(stock.showRadarSignals)
  const [positionSnapshots, setPositionSnapshots] = useState<StockPositionSnapshot[]>(
    () => stock.positionSnapshots ?? []
  )
  const hasPositionInput = quantity.trim() !== '' || cost.trim() !== ''
  const currentQuantity = Number(quantity) || 0
  const currentCost = Number(cost) || 0
  const currentMetrics = calculateVersionMetrics(currentQuantity, currentCost, quote?.latest)

  const addSnapshot = () => {
    if (!stock.position) return
    const createdAt = new Date().toISOString()
    setPositionSnapshots((current) => [{
      id: crypto.randomUUID(),
      name: defaultSnapshotName(createdAt),
      createdAt,
      quantity: stock.position!.quantity,
      cost: stock.position!.cost
    }, ...current])
  }

  const updateSnapshot = (
    snapshotId: string,
    changes: Partial<Pick<StockPositionSnapshot, 'name' | 'quantity' | 'cost'>>
  ) => {
    setPositionSnapshots((current) => current.map((snapshot) => (
      snapshot.id === snapshotId ? { ...snapshot, ...changes } : snapshot
    )))
  }

  return createPortal(
    <div className="position-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="position-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <header className="position-dialog-header">
          <div>
            <span className="position-dialog-icon"><BriefcaseBusiness size={18} /></span>
            <span>
              <strong id="position-dialog-title">编辑持仓</strong>
              <small>{stock.name} · {stock.code}</small>
            </span>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <form
          className="position-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(hasPositionInput ? {
              quantity: Number(quantity),
              cost: Number(cost),
              openedToday: openedOn === currentDateKey(),
              openedOn
            } : undefined, showRadarSignals, positionSnapshots)
          }}
        >
          <div className="position-fields">
            <label>
              <span>持仓数量</span>
              <span className="position-input-wrap">
                <input
                  type="number"
                  min="1"
                  step="1"
                  required={hasPositionInput}
                  autoFocus
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="例如 1000"
                />
                <span>股</span>
              </span>
            </label>
            <label>
              <span>成本价</span>
              <span className="position-input-wrap">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  required={hasPositionInput}
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="例如 12.580"
                />
                <span>元</span>
              </span>
            </label>
            <label>
              <span>建仓日期</span>
              <span className="position-input-wrap">
                <input
                  type="date"
                  max={currentDateKey()}
                  required={hasPositionInput}
                  value={openedOn}
                  onChange={(event) => setOpenedOn(event.target.value)}
                />
              </span>
            </label>
          </div>
          <label className="position-switch-row">
            <span>
              <strong>显示异动数据</strong>
              <small>关闭后，该股票不显示异动提示标签</small>
            </span>
            <input
              className="switch-input"
              type="checkbox"
              checked={showRadarSignals}
              onChange={(event) => setShowRadarSignals(event.target.checked)}
            />
          </label>

          <section className="position-snapshot-panel">
            <header>
              <span>
                <strong>持仓快照</strong>
                <small>
                  当前价 {formatPrice(quote?.latest)}，快照修改随“保存设置”一并保存
                </small>
              </span>
              <button
                className="secondary-button position-snapshot-add"
                type="button"
                disabled={!stock.position}
                onClick={addSnapshot}
              >
                <Camera size={14} />
                保存修改前持仓
              </button>
            </header>

            <div className="position-snapshot-scroll">
              <div className="position-snapshot-table">
                <div className="position-snapshot-row position-snapshot-table-header">
                  <span>持仓版本</span>
                  <span>数量</span>
                  <span>成本</span>
                  <span>持仓市值</span>
                  <span>持仓收益</span>
                  <span>收益率</span>
                  <span>较当前收益差</span>
                  <span />
                </div>
                <div className="position-snapshot-row is-current">
                  <span className="position-snapshot-name">
                    <strong>当前持仓</strong>
                    <small>按上方输入实时预览</small>
                  </span>
                  <strong>{formatShares(currentQuantity)}</strong>
                  <strong>{currentCost > 0 ? formatPrice(currentCost) : '--'}</strong>
                  <span>{formatCurrency(currentMetrics.marketValue)}</span>
                  <span className={valueClass(currentMetrics.totalProfit)}>
                    {formatProfit(currentMetrics.totalProfit)}
                  </span>
                  <span className={valueClass(currentMetrics.profitPercent)}>
                    {formatPercent(currentMetrics.profitPercent)}
                  </span>
                  <span>--</span>
                  <span />
                </div>
                {positionSnapshots.map((snapshot) => {
                  const metrics = calculateVersionMetrics(
                    snapshot.quantity,
                    snapshot.cost,
                    quote?.latest
                  )
                  const profitDifference = metrics.totalProfit === null
                    || currentMetrics.totalProfit === null
                    ? null
                    : metrics.totalProfit - currentMetrics.totalProfit
                  return (
                    <div className="position-snapshot-row" key={snapshot.id}>
                      <span className="position-snapshot-name">
                        <input
                          type="text"
                          required
                          value={snapshot.name}
                          onChange={(event) => updateSnapshot(snapshot.id, {
                            name: event.target.value
                          })}
                          aria-label="快照名称"
                        />
                        <small>{formatSnapshotTime(snapshot.createdAt)}</small>
                      </span>
                      <input
                        className="position-snapshot-number"
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={snapshot.quantity}
                        onChange={(event) => updateSnapshot(snapshot.id, {
                          quantity: Number(event.target.value)
                        })}
                        aria-label={`${snapshot.name}持仓数量`}
                      />
                      <input
                        className="position-snapshot-number"
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        value={snapshot.cost}
                        onChange={(event) => updateSnapshot(snapshot.id, {
                          cost: Number(event.target.value)
                        })}
                        aria-label={`${snapshot.name}成本价`}
                      />
                      <span>{formatCurrency(metrics.marketValue)}</span>
                      <span className={valueClass(metrics.totalProfit)}>
                        {formatProfit(metrics.totalProfit)}
                      </span>
                      <span className={valueClass(metrics.profitPercent)}>
                        {formatPercent(metrics.profitPercent)}
                      </span>
                      <span className={valueClass(profitDifference)}>
                        {formatProfit(profitDifference)}
                      </span>
                      <button
                        className="icon-button position-snapshot-delete"
                        type="button"
                        onClick={() => setPositionSnapshots((current) => (
                          current.filter((item) => item.id !== snapshot.id)
                        ))}
                        title={`删除${snapshot.name}`}
                        aria-label={`删除${snapshot.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
                {positionSnapshots.length === 0 ? (
                  <div className="position-snapshot-empty">
                    操作前保存一次当前持仓，之后即可和新持仓实时比较。
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <footer className="position-dialog-actions">
            {stock.position ? (
              <button
                className="clear-position-button"
                type="button"
                onClick={() => onSave(undefined, showRadarSignals, positionSnapshots)}
              >
                清空持仓
              </button>
            ) : <span />}
            <span>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button>
              <button className="primary-button compact-button" type="submit">保存设置</button>
            </span>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
