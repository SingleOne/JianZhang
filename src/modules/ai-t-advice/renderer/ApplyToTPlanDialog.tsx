import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import { useState } from 'react'
import { formatPrice } from '../../../lib/format'
import type { AiTAdviceApplyPreview } from '../shared/types'

interface ApplyToTPlanDialogProps {
  preview: AiTAdviceApplyPreview
  applying: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}

export function ApplyToTPlanDialog({
  preview,
  applying,
  error,
  onCancel,
  onConfirm
}: ApplyToTPlanDialogProps) {
  const [confirmed, setConfirmed] = useState(false)
  const change = preview.change

  return (
    <div className="ai-t-dialog-backdrop" role="presentation">
      <section className="ai-t-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ai-t-dialog-title">
        <header>
          <div>
            <span className="ai-t-private-badge">私用功能</span>
            <h3 id="ai-t-dialog-title">预览应用到现有 T 计划</h3>
            <p>{preview.quoteName} · {change.label} · 预览 10 分钟内有效</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭预览" onClick={onCancel}><X size={18} /></button>
        </header>

        <div className="ai-t-plan-diff">
          <article>
            <span>当前计划</span>
            <strong>{formatPrice(change.current.targetPrice)}</strong>
            <small>{change.current.targetPercent.toFixed(2)}% · {change.current.quantity} 股</small>
          </article>
          <ArrowRight size={20} />
          <article className="is-proposed">
            <span>建议计划</span>
            <strong>{formatPrice(change.proposed.targetPrice)}</strong>
            <small>{change.proposed.targetPercent.toFixed(2)}% · {change.proposed.quantity} 股</small>
          </article>
        </div>

        <div className="ai-t-apply-warning">
          <AlertTriangle size={17} />
          <span>确认后只修改当前活动批次的 {change.label} 价格百分比和数量，不会创建交易或自动下单。</span>
        </div>
        {error ? <p className="ai-t-error">{error}</p> : null}
        <label className="ai-t-confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我已核对价格和数量，并确认覆盖该档位</span>
        </label>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" disabled={!confirmed || applying} onClick={onConfirm}>
            {applying ? '正在应用…' : '确认应用'}
          </button>
        </footer>
      </section>
    </div>
  )
}
