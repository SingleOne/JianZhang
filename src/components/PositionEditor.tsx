import { BriefcaseBusiness, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { currentDateKey, isPositionOpenedToday } from '../lib/portfolio'
import type { StockPosition, WatchStock } from '../shared/types'

interface PositionEditorProps {
  stock: WatchStock
  onSave: (position: StockPosition | undefined, showRadarSignals: boolean) => void
  onClose: () => void
}

export function PositionEditor({ stock, onSave, onClose }: PositionEditorProps) {
  const [quantity, setQuantity] = useState(stock.position?.quantity.toString() ?? '')
  const [cost, setCost] = useState(stock.position?.cost.toString() ?? '')
  const [openedToday, setOpenedToday] = useState(isPositionOpenedToday(stock.position))
  const [showRadarSignals, setShowRadarSignals] = useState(stock.showRadarSignals)
  const hasPositionInput = quantity.trim() !== '' || cost.trim() !== ''

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
              openedToday,
              openedOn: openedToday ? currentDateKey() : undefined
            } : undefined, showRadarSignals)
          }}
        >
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
          <label className="position-switch-row">
            <span>
              <strong>本日建仓</strong>
              <small>勾选后，今日收益按成本价计算</small>
            </span>
            <input
              className="switch-input"
              type="checkbox"
              checked={openedToday}
              onChange={(event) => setOpenedToday(event.target.checked)}
            />
          </label>
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

          <footer className="position-dialog-actions">
            {stock.position ? (
              <button className="clear-position-button" type="button" onClick={() => onSave(undefined, showRadarSignals)}>
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
