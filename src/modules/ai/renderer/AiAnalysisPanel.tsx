import { AlertCircle, Bot, LoaderCircle, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { StockQuote, WatchStock } from '../../../shared/types'
import type { AiAnalysisProgressEvent, AiInterpretationResult } from '../shared/types'

interface AiAnalysisPanelProps {
  stock: WatchStock
  quote?: StockQuote
}

const ANALYSIS_STEPS = ['检查配置', '读取快照', '检查缓存', 'AI 解读', '校验结果'] as const

function analysisStep(phase: AiAnalysisProgressEvent['phase']): number {
  return ANALYSIS_STEPS.findIndex((_, index) => (
    index === 0 ? phase === 'preparing'
      : index === 1 ? phase === 'loading-snapshot'
      : index === 2 ? phase === 'checking-cache'
      : index === 3 ? phase === 'analyzing'
      : phase === 'validating'
  ))
}

function openAssistant(stock: WatchStock): void {
  window.dispatchEvent(new CustomEvent('ai:open-assistant', { detail: { quoteId: stock.quoteId, quoteName: stock.name } }))
}

function formatSnapshotTime(value: string): string {
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

export function AiAnalysisPanel({ stock, quote }: AiAnalysisPanelProps) {
  const api = window.aiApi
  const [result, setResult] = useState<AiInterpretationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<AiAnalysisProgressEvent | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setResult(null)
    setProgress(null)
    setError('')
  }, [stock.quoteId])

  useEffect(() => {
    if (!api) return
    return api.onAnalysisProgress((event) => {
      if (event.quoteId === stock.quoteId) setProgress(event)
    })
  }, [api, stock.quoteId])

  const references = useMemo(() => {
    if (!result) return []
    const sourceMap = new Map(result.sources.map((source) => [source.id, source]))
    return result.interpretation.newsReferences.flatMap((reference) => {
      const source = sourceMap.get(reference.sourceId)
      return source ? [{ ...reference, source }] : []
    })
  }, [result])

  const interpret = async () => {
    if (!api) return
    setLoading(true)
    setProgress({
      quoteId: stock.quoteId,
      phase: 'preparing',
      message: '正在检查 AI 配置',
      detail: '确认功能开关、模型与账号凭据。',
      updatedAt: new Date().toISOString()
    })
    setError('')
    try {
      setResult(await api.interpret(stock.quoteId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 解读失败')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <section className="ai-analysis-panel" aria-label={`${stock.name} AI 分析`}>
      <header>
        <div><Bot size={18} /><span><h3>AI 分析</h3></span><span className="ai-analysis-disclaimer">只读市场快照，仅解释市场观察已计算的指标、新闻和客观事件；不提供交易方向、价格、数量或仓位建议。{quote?.updatedAt ? ` 当前行情更新时间：${new Date(quote.updatedAt).toLocaleString('zh-CN')}` : ''}</span></div>
        <div><button className="secondary-button" type="button" onClick={() => openAssistant(stock)}><MessageSquare size={15} />问 AI</button><button className="primary-button" type="button" disabled={loading} onClick={() => void interpret()}>{loading ? <LoaderCircle size={15} className="is-spinning" /> : result ? <RefreshCw size={15} /> : <Sparkles size={15} />}{result ? '重新生成' : '解读当前快照'}</button></div>
      </header>
      {error ? <div className="ai-analysis-error"><AlertCircle size={16} />{error}</div> : null}
      {loading ? (
        <div className="ai-analysis-loading">
          <LoaderCircle size={22} className="is-spinning" />
          <strong>{progress?.message ?? '正在检查 AI 配置'}</strong>
          <span>{progress?.detail ?? '确认功能开关、模型与账号凭据。'}</span>
          <div className="ai-process-steps is-five" aria-label="AI 分析进度">
            {ANALYSIS_STEPS.map((step, index) => {
              const currentStep = analysisStep(progress?.phase ?? 'preparing')
              return <span className={index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : ''} key={step}>{step}</span>
            })}
          </div>
        </div>
      ) : result ? (
        <div className="ai-analysis-result">
          <section className="ai-analysis-summary"><div><strong>快照解读</strong><small>{result.cached ? '已使用相同快照的本地缓存' : '刚刚生成'} · 快照时间 <time dateTime={result.snapshotGeneratedAt}>{formatSnapshotTime(result.snapshotGeneratedAt)}</time></small></div><p>{result.interpretation.summary}</p></section>
          {result.interpretation.indicatorFacts.length > 0 ? <section><h4>指标事实与解读</h4><div className="ai-analysis-facts">{result.interpretation.indicatorFacts.map((fact) => <article key={`${fact.name}-${fact.interpretation}`}><strong>{fact.name}</strong><p>{fact.interpretation}</p>{fact.evidence.length > 0 ? <small>{fact.evidence.join(' · ')}</small> : null}</article>)}</div></section> : null}
          {references.length > 0 ? <section><h4>要闻参考</h4><div className="ai-analysis-news">{references.map((reference) => <article key={reference.sourceId}><div><strong>{reference.source.title}</strong><small>{reference.source.source} · {new Date(reference.source.publishedAt).toLocaleString('zh-CN')}</small></div><p>{reference.summary}</p><span>{reference.relevance}</span><a href={reference.source.url} target="_blank" rel="noreferrer" onClick={(event) => { if (!window.marketInsightApi) return; event.preventDefault(); void window.marketInsightApi.openSource(reference.source.url) }}>查看原始来源</a></article>)}</div></section> : null}
          {result.interpretation.uncertainties.length > 0 ? <section><h4>不确定性</h4><ul className="ai-analysis-uncertainties">{result.interpretation.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        </div>
      ) : <div className="ai-analysis-empty"><Sparkles size={26} /><strong>按需解读，不自动调用模型</strong><span>点击“解读当前快照”后，AI 才会读取市场观察的最新快照。</span></div>}
    </section>
  )
}
