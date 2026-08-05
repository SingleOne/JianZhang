import { AlertCircle, Bot, ChartNoAxesCombined, Landmark, LoaderCircle, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { StockQuote, WatchStock } from '../../../shared/types'
import type {
  AiAnalysisProgressEvent,
  AiAnalysisType,
  AiInterpretationResult,
  AiLongTermDimensionId,
  AiLongTermInterpretationResult
} from '../shared/types'

interface AiAnalysisPanelProps {
  stock: WatchStock
  quote?: StockQuote
}

const ANALYSIS_STEPS = ['检查配置', '读取快照', '检查缓存', 'AI 解读', '校验结果'] as const

const LONG_TERM_DIMENSION_LABELS: Record<AiLongTermDimensionId, string> = {
  businessQuality: '经营质量',
  cashFlow: '现金质量',
  capitalEfficiency: '资本效率',
  balanceSheet: '财务结构',
  valuation: '当前估值',
  shareholderReturn: '股东回报',
  priceTiming: '价格时机'
}

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

function ShortTermResult({ result }: { result: AiInterpretationResult }) {
  const references = useMemo(() => {
    const sourceMap = new Map(result.sources.map((source) => [source.id, source]))
    return result.interpretation.newsReferences.flatMap((reference) => {
      const source = sourceMap.get(reference.sourceId)
      return source ? [{ ...reference, source }] : []
    })
  }, [result])

  return (
    <div className="ai-analysis-result">
      <div className="ai-result-time-banner">
        <span>最近生成时间</span>
        <strong><time dateTime={result.interpretation.generatedAt}>{formatSnapshotTime(result.interpretation.generatedAt)}</time></strong>
        <small>市场快照 <time dateTime={result.snapshotGeneratedAt}>{formatSnapshotTime(result.snapshotGeneratedAt)}</time></small>
      </div>
      <section className="ai-analysis-summary"><div><strong>短期行情解读</strong><small>{result.cached ? '相同快照缓存结果' : '最近一次生成结果'}</small></div><p>{result.interpretation.summary}</p></section>
      {result.interpretation.indicatorFacts.length > 0 ? <section><h4>指标事实与解读</h4><div className="ai-analysis-facts">{result.interpretation.indicatorFacts.map((fact) => <article key={`${fact.name}-${fact.interpretation}`}><strong>{fact.name}</strong><p>{fact.interpretation}</p>{fact.evidence.length > 0 ? <small>{fact.evidence.join(' · ')}</small> : null}</article>)}</div></section> : null}
      {references.length > 0 ? <section><h4>要闻参考</h4><div className="ai-analysis-news">{references.map((reference) => <article key={reference.sourceId}><div><strong>{reference.source.title}</strong><small>{reference.source.source} · {new Date(reference.source.publishedAt).toLocaleString('zh-CN')}</small></div><p>{reference.summary}</p><span>{reference.relevance}</span><a href={reference.source.url} target="_blank" rel="noreferrer" onClick={(event) => { if (!window.marketInsightApi) return; event.preventDefault(); void window.marketInsightApi.openSource(reference.source.url) }}>查看原始来源</a></article>)}</div></section> : null}
      {result.interpretation.uncertainties.length > 0 ? <section><h4>不确定性</h4><ul className="ai-analysis-uncertainties">{result.interpretation.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    </div>
  )
}

function LongTermResult({ result }: { result: AiLongTermInterpretationResult }) {
  return (
    <div className="ai-analysis-result is-long-term">
      <div className="ai-result-time-banner is-long-term">
        <span>最近生成时间</span>
        <strong><time dateTime={result.interpretation.generatedAt}>{formatSnapshotTime(result.interpretation.generatedAt)}</time></strong>
        <small>
          基本面 {result.fundamentalSnapshotDate ?? '--'} · 分红融资 {result.dividendSnapshotDate ?? '--'}
        </small>
      </div>
      <section className="ai-analysis-summary"><div><strong>长期价值结论</strong><small>{result.cached ? '相同数据缓存结果' : '最近一次生成结果'} · 价格数据 {result.priceDataAt ? formatSnapshotTime(result.priceDataAt) : '--'}</small></div><p>{result.interpretation.summary}</p></section>
      <section>
        <h4>长期价值维度</h4>
        <div className="ai-long-term-dimensions">
          {result.interpretation.dimensions.map((dimension) => (
            <article className={`is-${dimension.id}`} key={dimension.id}>
              <strong>{LONG_TERM_DIMENSION_LABELS[dimension.id]}</strong>
              <p>{dimension.conclusion}</p>
              {dimension.evidence.length > 0 ? <small>{dimension.evidence.join(' · ')}</small> : null}
            </article>
          ))}
        </div>
      </section>
      {result.interpretation.risks.length > 0 ? <section><h4>长期风险</h4><ul className="ai-analysis-risks">{result.interpretation.risks.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      {result.interpretation.uncertainties.length > 0 ? <section><h4>数据边界与不确定性</h4><ul className="ai-analysis-uncertainties">{result.interpretation.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    </div>
  )
}

export function AiAnalysisPanel({ stock, quote }: AiAnalysisPanelProps) {
  const api = window.aiApi
  const [analysisType, setAnalysisType] = useState<AiAnalysisType>('short-term')
  const [shortTermResult, setShortTermResult] = useState<AiInterpretationResult | null>(null)
  const [longTermResult, setLongTermResult] = useState<AiLongTermInterpretationResult | null>(null)
  const [loadingType, setLoadingType] = useState<AiAnalysisType | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [progress, setProgress] = useState<AiAnalysisProgressEvent | null>(null)
  const [errors, setErrors] = useState<Record<AiAnalysisType, string>>({
    'short-term': '',
    'long-term': ''
  })

  useEffect(() => {
    setShortTermResult(null)
    setLongTermResult(null)
    setProgress(null)
    setErrors({ 'short-term': '', 'long-term': '' })
    if (!api) return
    let active = true
    setRestoring(true)
    void Promise.all([
      api.getLatestInterpretation(stock.quoteId),
      api.getLatestLongTermInterpretation(stock.quoteId)
    ])
      .then(([shortTerm, longTerm]) => {
        if (!active) return
        setShortTermResult(shortTerm)
        setLongTermResult(longTerm)
      })
      .catch((reason: unknown) => {
        if (!active) return
        const message = reason instanceof Error ? reason.message : '无法读取上次 AI 分析'
        setErrors({ 'short-term': message, 'long-term': message })
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => { active = false }
  }, [api, stock.quoteId])

  useEffect(() => {
    if (!api) return
    return api.onAnalysisProgress((event) => {
      if (event.quoteId === stock.quoteId) setProgress(event)
    })
  }, [api, stock.quoteId])

  const currentResult = analysisType === 'short-term' ? shortTermResult : longTermResult
  const loading = loadingType === analysisType
  const currentProgress = progress?.analysisType === analysisType ? progress : null

  const interpret = async () => {
    if (!api || loadingType) return
    setLoadingType(analysisType)
    setProgress({
      quoteId: stock.quoteId,
      analysisType,
      phase: 'preparing',
      message: '正在检查 AI 配置',
      detail: '确认功能开关、模型与账号凭据。',
      updatedAt: new Date().toISOString()
    })
    setErrors((current) => ({ ...current, [analysisType]: '' }))
    try {
      if (analysisType === 'short-term') {
        setShortTermResult(await api.interpret(stock.quoteId))
      } else {
        setLongTermResult(await api.interpretLongTerm(stock.quoteId))
      }
    } catch (reason) {
      setErrors((current) => ({
        ...current,
        [analysisType]: reason instanceof Error ? reason.message : 'AI 分析失败'
      }))
    } finally {
      setLoadingType(null)
      setProgress(null)
    }
  }

  return (
    <section className="ai-analysis-panel" aria-label={`${stock.name} AI 分析`}>
      <header>
        <div>
          <Bot size={18} />
          <span><h3>AI 分析</h3></span>
          <span className="ai-analysis-disclaimer">
            {analysisType === 'short-term'
              ? '短期行情只读取市场指标、新闻、事件和筹码，不使用基本面结论。'
              : '长期价值分别判断经营质量、估值和价格时机；股价强弱不会改变企业质量结论。'}
            {quote?.updatedAt ? ` 当前行情更新时间：${new Date(quote.updatedAt).toLocaleString('zh-CN')}` : ''}
          </span>
        </div>
        <div>
          <button className="secondary-button" type="button" onClick={() => openAssistant(stock)}><MessageSquare size={15} />问 AI</button>
          <button className="primary-button" type="button" disabled={Boolean(loadingType)} onClick={() => void interpret()}>{loading ? <LoaderCircle size={15} className="is-spinning" /> : currentResult ? <RefreshCw size={15} /> : <Sparkles size={15} />}{currentResult ? '重新生成' : '开始分析'}</button>
        </div>
      </header>

      <div className="ai-analysis-mode-tabs" role="tablist" aria-label="AI 分析周期">
        <button className={analysisType === 'short-term' ? 'is-active' : ''} type="button" role="tab" aria-selected={analysisType === 'short-term'} onClick={() => setAnalysisType('short-term')}><ChartNoAxesCombined size={16} /><span><strong>短期行情</strong><small>行情、技术、新闻与筹码</small></span></button>
        <button className={analysisType === 'long-term' ? 'is-active' : ''} type="button" role="tab" aria-selected={analysisType === 'long-term'} onClick={() => setAnalysisType('long-term')}><Landmark size={16} /><span><strong>长期价值</strong><small>财务、估值、股东回报与价格时机</small></span></button>
      </div>

      {errors[analysisType] ? <div className="ai-analysis-error"><AlertCircle size={16} />{errors[analysisType]}</div> : null}
      {loading ? (
        <div className={`ai-analysis-loading${currentResult ? ' has-previous' : ''}`}>
          <LoaderCircle size={22} className="is-spinning" />
          <strong>{currentProgress?.message ?? '正在检查 AI 配置'}</strong>
          <span>{currentResult ? '上一次结果保留显示；完成后将自动替换。' : currentProgress?.detail ?? '确认功能开关、模型与账号凭据。'}</span>
          <div className="ai-process-steps is-five" aria-label="AI 分析进度">
            {ANALYSIS_STEPS.map((step, index) => {
              const currentStep = analysisStep(currentProgress?.phase ?? 'preparing')
              return <span className={index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : ''} key={step}>{step}</span>
            })}
          </div>
        </div>
      ) : restoring && !currentResult ? (
        <div className="ai-analysis-loading is-restoring">
          <LoaderCircle size={20} className="is-spinning" />
          <strong>正在读取上次 AI 分析</strong>
        </div>
      ) : null}

      {currentResult
        ? analysisType === 'short-term'
          ? <ShortTermResult result={currentResult as AiInterpretationResult} />
          : <LongTermResult result={currentResult as AiLongTermInterpretationResult} />
        : !loading && !restoring
          ? <div className="ai-analysis-empty"><Sparkles size={26} /><strong>按需分析，不自动调用模型</strong><span>{analysisType === 'short-term' ? '短期行情读取市场观察快照，不混入长期基本面判断。' : '长期价值读取财务、估值和长期价格位置，不使用分时、盘口或筹码。'}</span></div>
          : null}
    </section>
  )
}
