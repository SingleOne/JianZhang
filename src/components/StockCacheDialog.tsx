import { Database, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import {
  stockCacheCategories,
  type StockCacheCategoryId,
  type StockCacheClearResult
} from '../shared/stock-cache'
import type { WatchStock } from '../shared/types'
import './StockCacheDialog.css'

interface StockCacheDialogProps {
  stock: WatchStock
  onClose: () => void
  onCleared: (ids: StockCacheCategoryId[]) => Promise<string | null>
}

export function StockCacheDialog({ stock, onClose, onCleared }: StockCacheDialogProps) {
  const categories = useMemo(() => stockCacheCategories(stock.quoteId), [stock.quoteId])
  const [selected, setSelected] = useState<StockCacheCategoryId[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StockCacheClearResult | null>(null)
  const [error, setError] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  const toggle = (id: StockCacheCategoryId, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((selectedId) => selectedId !== id)
    )
  }

  const confirm = async () => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      const cleared = await stockApi.clearStockCaches(stock.quoteId, selected)
      setResult(cleared)
      if (cleared.cleared.length > 0) {
        try {
          setRefreshWarning((await onCleared(cleared.cleared)) ?? '')
        } catch (reason) {
          setRefreshWarning(
            `缓存已清理，但页面刷新失败：${reason instanceof Error ? reason.message : '请重新打开股票详情'}`
          )
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清理缓存失败')
    } finally {
      setBusy(false)
    }
  }

  const names = new Map(categories.map((category) => [category.id, category.label]))
  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose()
      }}
    >
      <section
        className="confirm-dialog stock-cache-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-cache-dialog-title"
        aria-describedby="stock-cache-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Database size={19} />
          </span>
          <div>
            <h2 id="stock-cache-dialog-title">清理缓存</h2>
            <p id="stock-cache-dialog-description">
              {stock.name}（{stock.code}）：只清理本股勾选的缓存，默认不选择。
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button confirm-dialog-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭缓存清理弹窗"
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>

        {!result ? (
          <div className="stock-cache-dialog-body">
            <div className="stock-cache-selection-actions">
              <span>可清理的缓存</span>
              <button type="button" onClick={() => setSelected(categories.map(({ id }) => id))} disabled={busy}>
                全选
              </button>
              <button type="button" onClick={() => setSelected([])} disabled={busy || selected.length === 0}>
                清空
              </button>
            </div>
            <div className="stock-cache-options">
              {categories.map((category) => (
                <label key={category.id} className="stock-cache-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(category.id)}
                    onChange={(event) => toggle(category.id, event.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{category.label}</strong>
                    <small>{category.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="stock-cache-scope-note">
              未勾选项、其他股票缓存及自选股、持仓、交易、设置等数据不会清理。
            </p>
            {error ? <p className="stock-cache-error">{error}</p> : null}
          </div>
        ) : (
          <div className="stock-cache-dialog-body stock-cache-result">
            <strong>已清理 {result.cleared.length} 项缓存</strong>
            {result.cleared.length > 0 ? (
              <p>{result.cleared.map((id) => names.get(id) ?? id).join('、')}</p>
            ) : null}
            {result.failed.map(({ id, message }) => (
              <p className="stock-cache-error" key={id}>
                {names.get(id) ?? id}：{message}
              </p>
            ))}
            {refreshWarning ? <p className="stock-cache-error">{refreshWarning}</p> : null}
          </div>
        )}

        <footer>
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            {result ? '关闭' : '取消'}
          </button>
          {!result ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => void confirm()}
              disabled={busy || selected.length === 0}
            >
              {busy ? '清理中…' : `确认清理${selected.length > 0 ? `（${selected.length}）` : ''}`}
            </button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body
  )
}
