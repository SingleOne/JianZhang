import { AlertCircle, Bot, LoaderCircle, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { StockQuote, WatchStock } from '../../../shared/types'
import type { AiInterpretationResult } from '../shared/types'

interface AiAnalysisPanelProps {
  stock: WatchStock
  quote?: StockQuote
}

function openAssistant(stock: WatchStock): void {
  window.dispatchEvent(new CustomEvent('ai:open-assistant', { detail: { quoteId: stock.quoteId, quoteName: stock.name } }))
}

export function AiAnalysisPanel({ stock, quote }: AiAnalysisPanelProps) {
  const api = window.aiApi
  const [result, setResult] = useState<AiInterpretationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setResult(null)
    setError('')
  }, [stock.quoteId])

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
    setError('')
    try {
      setResult(await api.interpret(stock.quoteId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 解读失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="ai-analysis-panel" aria-label={`${stock.name} AI 分析`}>
      <header>
        <div><Bot size={18} /><span><small>只读市场快照</small><h3>AI 分析</h3></span></div>
        <div><button className="secondary-button" type="button" onClick={() => openAssistant(stock)}><MessageSquare size={15} />问 AI</button><button className="primary-button" type="button" disabled={loading} onClick={() => void interpret()}>{loading ? <LoaderCircle size={15} className="is-spinning" /> : result ? <RefreshCw size={15} /> : <Sparkles size={15} />}{result ? '重新生成' : '解读当前快照'}</button></div>
      </header>
      <p className="ai-analysis-disclaimer">仅解释市场观察已计算的指标、新闻和客观事件；不提供交易方向、价格、数量或仓位建议。{quote?.updatedAt ? ` 当前行情更新时间：${new Date(quote.updatedAt).toLocaleString('zh-CN')}` : ''}</p>
      {error ? <div className="ai-analysis-error"><AlertCircle size={16} />{error}</div> : null}
      {result ? (
        <div className="ai-analysis-result">
          <section className="ai-analysis-summary"><div><strong>快照解读</strong><small>{result.cached ? '已使用相同快照的本地缓存' : '刚刚生成'} · 快照 {result.snapshotId}</small></div><p>{result.interpretation.summary}</p></section>
          {result.interpretation.indicatorFacts.length > 0 ? <section><h4>指标事实与解读</h4><div className="ai-analysis-facts">{result.interpretation.indicatorFacts.map((fact) => <article key={`${fact.name}-${fact.interpretation}`}><strong>{fact.name}</strong><p>{fact.interpretation}</p>{fact.evidence.length > 0 ? <small>{fact.evidence.join(' · ')}</small> : null}</article>)}</div></section> : null}
          {references.length > 0 ? <section><h4>要闻参考</h4><div className="ai-analysis-news">{references.map((reference) => <article key={reference.sourceId}><div><strong>{reference.source.title}</strong><small>{reference.source.source} · {new Date(reference.source.publishedAt).toLocaleString('zh-CN')}</small></div><p>{reference.summary}</p><span>{reference.relevance}</span><a href={reference.source.url} target="_blank" rel="noreferrer" onClick={(event) => { if (!window.marketInsightApi) return; event.preventDefault(); void window.marketInsightApi.openSource(reference.source.url) }}>查看原始来源</a></article>)}</div></section> : null}
          {result.interpretation.uncertainties.length > 0 ? <section><h4>不确定性</h4><ul className="ai-analysis-uncertainties">{result.interpretation.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
        </div>
      ) : !loading ? <div className="ai-analysis-empty"><Sparkles size={26} /><strong>按需解读，不自动调用模型</strong><span>点击“解读当前快照”后，AI 才会读取市场观察的最新快照。</span></div> : <div className="ai-analysis-loading"><LoaderCircle size={22} className="is-spinning" />正在整理当前快照并生成解读…</div>}
    </section>
  )
}
