import {
  AlertCircle,
  Ban,
  CirclePause,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { emitCompletionNotification } from '../../../lib/completion-notifications'
import { formatPrice } from '../../../lib/format'
import type { StockQuote, WatchStock } from '../../../shared/types'
import type {
  AiTAdvice,
  AiTAdviceAction,
  AiTAdviceApplyPreview,
  AiTAdviceProgressEvent,
  AiTAdviceSettings
} from '../shared/types'
import { ApplyToTPlanDialog } from './ApplyToTPlanDialog'

interface TAdvicePanelProps {
  stock: WatchStock
  quote?: StockQuote
}

const ACTION_LABELS: Record<AiTAdviceAction, string> = {
  hold: '暂不操作',
  'forward-t': '正 T 参考',
  'reverse-t': '反 T 参考'
}

const CONFIDENCE_LABELS = {
  low: '低置信度',
  medium: '中等置信度',
  high: '高置信度'
} as const

const SNAPSHOT_STATE_LABELS = {
  live: '实时',
  cached: '有效缓存',
  stale: '陈旧'
} as const

const GENERATION_STEPS = ['准备数据', '刷新盘口', 'AI 分析', '校验建议'] as const

function generationStep(phase: AiTAdviceProgressEvent['phase']): number {
  if (phase === 'preparing') return 0
  if (phase === 'refreshing-snapshot' || phase === 'waiting-order-book') return 1
  if (phase === 'analyzing') return 2
  return 3
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function AdviceSummary({ advice }: { advice: AiTAdvice }) {
  return (
    <div className="ai-t-advice-content">
      <div className="ai-result-time-banner is-t-advice">
        <span>最近生成时间</span>
        <strong><time dateTime={advice.generatedAt}>{formatTime(advice.generatedAt)}</time></strong>
        <small>快照时间 <time dateTime={advice.snapshotGeneratedAt}>{formatTime(advice.snapshotGeneratedAt)}</time></small>
      </div>
      <div className="ai-t-advice-overview">
        <span className={`ai-t-action is-${advice.action}`}>{ACTION_LABELS[advice.action]}</span>
        <span className={`ai-t-confidence is-${advice.confidence}`}>{CONFIDENCE_LABELS[advice.confidence]}</span>
        <small>{advice.providerId} · {advice.model}</small>
      </div>
      {advice.action !== 'hold' && advice.priceZone ? (
        <div className="ai-t-metrics">
          <div><span>参考区间</span><strong>{formatPrice(advice.priceZone.lower)} – {formatPrice(advice.priceZone.upper)}</strong></div>
          <div><span>参考数量</span><strong>{advice.quantity} 股</strong></div>
          <div><span>失效价格</span><strong>{formatPrice(advice.invalidationPrice)}</strong></div>
        </div>
      ) : null}
      <div className="ai-t-reason-grid">
        <section><h4>判断依据</h4><ul>{advice.rationale.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section className="is-risk"><h4>风险与限制</h4><ul>{advice.risks.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </div>
      {advice.snapshotDataState ? (
        <div className={`ai-t-snapshot-state is-${advice.snapshotDataState}`}>
          <strong>快照状态：{SNAPSHOT_STATE_LABELS[advice.snapshotDataState]}</strong>
          {advice.snapshotDataState === 'stale' ? (
            <span>陈旧来源：{advice.snapshotStaleSources?.join('、') || '整体快照'}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function TAdvicePanel({ stock, quote }: TAdvicePanelProps) {
  const api = window.aiTAdviceApi
  const [settings, setSettings] = useState<AiTAdviceSettings | null>(null)
  const [history, setHistory] = useState<AiTAdvice[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<AiTAdviceProgressEvent | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<AiTAdviceApplyPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    if (!api) return
    const [nextSettings, nextHistory] = await Promise.all([
      api.getSettings(),
      api.listHistory(stock.quoteId)
    ])
    setSettings(nextSettings)
    setHistory(nextHistory)
  }, [api, stock.quoteId])

  useEffect(() => {
    setError('')
    setNotice('')
    setPreview(null)
    setProgress(null)
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : '做 T 参考加载失败'))
  }, [load])

  useEffect(() => {
    if (!api) return
    return api.onProgress((event) => {
      if (event.quoteId === stock.quoteId) setProgress(event)
    })
  }, [api, stock.quoteId])

  const latest = history[0] ?? null
  const olderHistory = useMemo(() => history.slice(1, 6), [history])

  if (!api || !settings) return null

  const toggleEnabled = async () => {
    setSaving(true)
    setError('')
    try {
      setSettings(await api.saveSettings({ enabled: !settings.enabled }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  const generate = async () => {
    setLoading(true)
    setProgress({
      quoteId: stock.quoteId,
      phase: 'preparing',
      message: '正在准备做 T 分析',
      detail: '检查当前股票、持仓与活动 T 计划。',
      updatedAt: new Date().toISOString()
    })
    setError('')
    setNotice('')
    try {
      const result = await api.generate(stock.quoteId)
      setHistory((current) => [result.advice, ...current.filter((item) => item.id !== result.advice.id)])
      emitCompletionNotification({
        quoteId: stock.quoteId,
        target: 't-advice',
        message: `${stock.name} 做 T 参考已生成`
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '做 T 参考生成失败')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const cancel = async () => {
    await api.cancel(stock.quoteId)
  }

  const dismiss = async (adviceId: string) => {
    setError('')
    try {
      const dismissed = await api.dismiss(adviceId)
      setHistory((current) => current.map((item) => item.id === dismissed.id ? dismissed : item))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '忽略参考失败')
    }
  }

  const openPreview = async (adviceId: string) => {
    setError('')
    try {
      setPreview(await api.previewApply(adviceId))
      setPreviewError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成应用预览')
    }
  }

  const confirmApply = async () => {
    if (!preview) return
    setApplying(true)
    setPreviewError('')
    try {
      const result = await api.confirmApply(preview.previewId)
      setHistory((current) => current.map((item) => item.id === result.advice.id ? result.advice : item))
      setPreview(null)
      setNotice(`已应用到${preview.change.label}，请在做 T 管理中复核。`)
    } catch (reason) {
      setPreviewError(reason instanceof Error ? reason.message : '应用 T 计划失败')
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className="ai-t-panel" aria-label={`${stock.name} 做 T 参考`}>
      <header>
        <div className="ai-t-heading">
          <ShieldAlert size={18} />
          <span><h3>做 T 参考</h3><small>独立私用模块 · 默认不进入分享构建</small></span>
          <span className="ai-t-private-badge">私用功能</span>
        </div>
        <div className="ai-t-header-actions">
          <label className="ai-t-switch"><input type="checkbox" checked={settings.enabled} disabled={saving} onChange={() => void toggleEnabled()} /><span>启用</span></label>
          {settings.enabled ? (
            loading
              ? <button type="button" className="secondary-button" onClick={() => void cancel()}><CirclePause size={15} />停止</button>
              : <button type="button" className="primary-button" onClick={() => void generate()}>{latest ? <RefreshCw size={15} /> : <Sparkles size={15} />}{latest ? '重新生成' : '生成参考'}</button>
          ) : null}
        </div>
      </header>

      {!settings.enabled ? (
        <div className="ai-t-disabled"><Ban size={24} /><strong>做 T 参考当前已关闭</strong><span>开启后也只会在你主动点击“生成参考”时调用模型。</span></div>
      ) : null}
      {settings.enabled && loading ? (
        <div className={`ai-t-loading${latest ? ' has-previous' : ''}`}>
          <LoaderCircle size={22} className="is-spinning" />
          <strong>{progress?.message ?? '正在准备做 T 分析'}</strong>
          <span>{latest ? '上一次参考保留显示；完成后将自动替换。' : progress?.detail ?? '检查当前股票、持仓与活动 T 计划。'}</span>
          <div className="ai-process-steps" aria-label="做 T 参考生成进度">
            {GENERATION_STEPS.map((step, index) => {
              const currentStep = generationStep(progress?.phase ?? 'preparing')
              return <span className={index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : ''} key={step}>{step}</span>
            })}
          </div>
        </div>
      ) : null}
      {latest ? (
        <article className={`ai-t-advice-card is-${latest.status}`}>
          <AdviceSummary advice={latest} />
          {latest.status === 'active' ? (
            <footer>
              <button type="button" className="ai-text-button" disabled={loading} onClick={() => void dismiss(latest.id)}>忽略本次</button>
              {latest.action !== 'hold' ? <button type="button" className="primary-button" disabled={loading} onClick={() => void openPreview(latest.id)}>预览应用到 T 计划</button> : null}
            </footer>
          ) : <p className="ai-t-record-status">{latest.status === 'applied' ? '已应用到 T 计划' : '本次参考已忽略'}</p>}
        </article>
      ) : settings.enabled && !loading ? (
        <div className="ai-t-empty"><Sparkles size={26} /><strong>按需生成，不自动调用模型</strong><span>当前最新价：{formatPrice(quote?.latest)}。请先确保市场观察已有最新快照。</span></div>
      ) : null}

      {error ? <div className="ai-t-error"><AlertCircle size={16} />{error}</div> : null}
      {notice ? <div className="ai-t-notice">{notice}</div> : null}
      {olderHistory.length > 0 ? (
        <details className="ai-t-history">
          <summary><History size={15} />最近记录（{olderHistory.length}）</summary>
          <div>{olderHistory.map((item) => <article key={item.id}><span>{ACTION_LABELS[item.action]}</span><small>{formatTime(item.generatedAt)} · {item.status === 'active' ? '未处理' : item.status === 'applied' ? '已应用' : '已忽略'}</small></article>)}</div>
        </details>
      ) : null}
      <p className="ai-t-disclaimer">模型输出仅供个人复核，不保证收益。不会自动下单；应用计划前必须预览并二次确认。</p>

      {preview ? (
        <ApplyToTPlanDialog
          preview={preview}
          applying={applying}
          error={previewError}
          onCancel={() => setPreview(null)}
          onConfirm={() => void confirmApply()}
        />
      ) : null}
    </section>
  )
}
