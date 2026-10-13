import {
  AlertCircle,
  Bot,
  ChartNoAxesCombined,
  Landmark,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppButton } from '../../../components/AppButton'
import { emitCompletionNotification } from '../../../lib/completion-notifications'
import type { StockQuote, WatchStock } from '../../../shared/types'
import type {
  AiAnalysisProgressEvent,
  AiAnalysisType,
  AiInterpretationResult,
  AiLongTermInterpretationResult,
  AiLongTermSectionId
} from '../shared/types'

interface AiAnalysisPanelProps {
  stock: WatchStock
  quote?: StockQuote
  analysisType: AiAnalysisType
  onAnalysisTypeChange: (analysisType: AiAnalysisType) => void
}

const ANALYSIS_STEPS = ['检查配置', '读取快照', '检查缓存', 'AI 提炼', '校验结果'] as const

const LONG_TERM_SECTION_LABELS: Record<AiLongTermSectionId, string> = {
  operatingMetrics: '历史财务表现摘要',
  financialStructure: '财务结构与负债提示',
  valuationMetrics: '数理模型计算参考'
}

function analysisStep(phase: AiAnalysisProgressEvent['phase']): number {
  return ANALYSIS_STEPS.findIndex((_, index) =>
    index === 0
      ? phase === 'preparing'
      : index === 1
        ? phase === 'loading-snapshot'
        : index === 2
          ? phase === 'checking-cache'
          : index === 3
            ? phase === 'analyzing'
            : phase === 'validating'
  )
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
  return (
    <div className="ai-analysis-result">
      <div className="ai-result-time-banner">
        <span>最近生成时间</span>
        <strong>
          <time dateTime={result.interpretation.generatedAt}>
            {formatSnapshotTime(result.interpretation.generatedAt)}
          </time>
        </strong>
        <small>
          市场快照{' '}
          <time dateTime={result.snapshotGeneratedAt}>
            {formatSnapshotTime(result.snapshotGeneratedAt)}
          </time>
        </small>
      </div>
      <section className="ai-analysis-summary">
        <div>
          <strong>近期量价客观现状</strong>
          <small>{result.cached ? '相同快照缓存结果' : '最近一次生成结果'}</small>
        </div>
        <p>{result.interpretation.summary}</p>
      </section>
      {result.interpretation.indicatorFacts.length > 0 ? (
        <section>
          <h4>技术指标状态呈现</h4>
          <div className="ai-analysis-facts">
            {result.interpretation.indicatorFacts.map((fact) => (
              <article key={`${fact.name}-${fact.observation}`}>
                <strong>{fact.name}</strong>
                <p>{fact.observation}</p>
                {fact.evidence.length > 0 ? <small>{fact.evidence.join(' · ')}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {result.interpretation.uncertainties.length > 0 ? (
        <section>
          <h4>数据边界</h4>
          <ul className="ai-analysis-uncertainties">
            {result.interpretation.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h4>风险提示</h4>
        <p className="ai-analysis-risk-notice">{result.interpretation.riskNotice}</p>
      </section>
    </div>
  )
}

function LongTermResult({ result }: { result: AiLongTermInterpretationResult }) {
  const interpretation = result.interpretation

  return (
    <div className="ai-analysis-result is-long-term">
      <div className="ai-result-time-banner is-long-term">
        <span>最近生成时间</span>
        <strong>
          <time dateTime={result.interpretation.generatedAt}>
            {formatSnapshotTime(result.interpretation.generatedAt)}
          </time>
        </strong>
        <small>
          财报截止 {result.fundamentalReportDate ?? '--'} · 基本面快照生成{' '}
          {result.fundamentalGeneratedAt ? formatSnapshotTime(result.fundamentalGeneratedAt) : '--'}
          {' · '}五年财务{' '}
          {result.fundamentalFiscalYears?.length
            ? `${result.fundamentalFiscalYears[0]}—${result.fundamentalFiscalYears.at(-1)}`
            : '--'}
          {' · '}分红融资 {result.dividendSnapshotDate ?? '--'}
          {' · '}历史估值{' '}
          {result.valuationHistoryPeriodStart && result.valuationHistoryPeriodEnd
            ? `${result.valuationHistoryPeriodStart}—${result.valuationHistoryPeriodEnd}`
            : '--'}
          {' · '}行业估值 {result.valuationIndustryDataAt ?? '--'}
        </small>
      </div>
      <section className="ai-analysis-summary">
        <div>
          <strong>基本面数据摘要</strong>
          <small>
            {result.cached ? '相同数据缓存结果' : '最近一次生成结果'} · 价格数据{' '}
            {result.priceDataAt ? formatSnapshotTime(result.priceDataAt) : '--'}
          </small>
        </div>
        <p>{result.interpretation.summary}</p>
      </section>
      <section>
        <h4>财报与模型数据</h4>
        <div className="ai-long-term-dimensions">
          {interpretation.sections.map((section) => (
            <article className={`is-${section.id}`} key={section.id}>
              <strong>{LONG_TERM_SECTION_LABELS[section.id]}</strong>
              <p>{section.observation}</p>
              {section.id === 'valuationMetrics' && interpretation.modelCalculationReference ? (
                <p className="ai-model-calculation-reference">
                  {interpretation.modelCalculationReference}
                </p>
              ) : null}
              {section.evidence.length > 0 ? <small>{section.evidence.join(' · ')}</small> : null}
            </article>
          ))}
        </div>
      </section>
      {result.interpretation.riskFacts.length > 0 ? (
        <section>
          <h4>已披露或规则命中的风险事实</h4>
          <ul className="ai-analysis-risks">
            {result.interpretation.riskFacts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.interpretation.uncertainties.length > 0 ? (
        <section>
          <h4>数据边界与不确定性</h4>
          <ul className="ai-analysis-uncertainties">
            {result.interpretation.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function AiAnalysisPanel({
  stock,
  quote,
  analysisType,
  onAnalysisTypeChange
}: AiAnalysisPanelProps) {
  const api = window.aiApi
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
    return () => {
      active = false
    }
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
    const requestedAnalysisType = analysisType
    setLoadingType(requestedAnalysisType)
    setProgress({
      quoteId: stock.quoteId,
      analysisType: requestedAnalysisType,
      phase: 'preparing',
      message: '正在检查 AI 配置',
      detail: '确认功能开关、模型与账号凭据。',
      updatedAt: new Date().toISOString()
    })
    setErrors((current) => ({ ...current, [requestedAnalysisType]: '' }))
    try {
      if (requestedAnalysisType === 'short-term') {
        const result = await api.interpret(stock.quoteId)
        setShortTermResult(result)
      } else {
        const result = await api.interpretLongTerm(stock.quoteId)
        setLongTermResult(result)
      }
      emitCompletionNotification({
        quoteId: stock.quoteId,
        target: requestedAnalysisType === 'short-term' ? 'ai-short-term' : 'ai-long-term',
        message: `${stock.name} ${requestedAnalysisType === 'short-term' ? '近期动能分析' : '基本面透视'}已生成`
      })
    } catch (reason) {
      setErrors((current) => ({
        ...current,
        [requestedAnalysisType]: reason instanceof Error ? reason.message : 'AI 分析失败'
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
          <span>
            <h3>AI 分析</h3>
          </span>
          <span className="ai-analysis-description">
            {analysisType === 'short-term'
              ? '近期动能分析仅提炼历史日 K 量价与技术指标。'
              : '基本面透视仅提炼历史财务指标、估值模型与价格统计。'}
            {quote?.updatedAt
              ? ` 当前行情更新时间：${new Date(quote.updatedAt).toLocaleString('zh-CN')}`
              : ''}
          </span>
        </div>
        <div>
          <AppButton
            variant="primary"
            disabled={Boolean(loadingType)}
            onClick={() => void interpret()}
          >
            {loading ? (
              <LoaderCircle size={15} className="is-spinning" />
            ) : currentResult ? (
              <RefreshCw size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {currentResult ? '重新生成' : '开始分析'}
          </AppButton>
        </div>
      </header>

      <div className="ai-analysis-mode-tabs" role="tablist" aria-label="AI 分析类型">
        <AppButton
          variant="plain"
          className={analysisType === 'short-term' ? 'is-active' : ''}
          role="tab"
          aria-selected={analysisType === 'short-term'}
          onClick={() => onAnalysisTypeChange('short-term')}
        >
          <ChartNoAxesCombined size={16} />
          <span>
            <strong>近期动能分析</strong>
            <small>历史日 K 量价与技术指标</small>
          </span>
        </AppButton>
        <AppButton
          variant="plain"
          className={analysisType === 'long-term' ? 'is-active' : ''}
          role="tab"
          aria-selected={analysisType === 'long-term'}
          onClick={() => onAnalysisTypeChange('long-term')}
        >
          <Landmark size={16} />
          <span>
            <strong>基本面透视</strong>
            <small>历史财务、估值模型与价格统计</small>
          </span>
        </AppButton>
      </div>

      <div className="ai-analysis-legal-notice" role="note">
        <ShieldAlert size={18} aria-hidden="true" />
        <p>
          <strong>重要声明：</strong>
          本板块所有内容均由 AI
          技术基于历史公开市场量价数据及上市企业官方财务报告自动提炼、计算所得。AI
          并非持牌证券投资顾问，不具备证券投资咨询资质。所有分析结果不包含任何主观投资倾向，亦不构成任何买卖建议或对未来行情的预测。数理模型计算结果受预设参数影响较大，请投资者务必保持独立思考，审慎决策，据此操作风险自担。
        </p>
      </div>

      {errors[analysisType] ? (
        <div className="ai-analysis-error">
          <AlertCircle size={16} />
          {errors[analysisType]}
        </div>
      ) : null}
      {loading ? (
        <div className={`ai-analysis-loading${currentResult ? ' has-previous' : ''}`}>
          <LoaderCircle size={22} className="is-spinning" />
          <strong>{currentProgress?.message ?? '正在检查 AI 配置'}</strong>
          <span>
            {currentResult
              ? '上一次结果保留显示；完成后将自动替换。'
              : (currentProgress?.detail ?? '确认功能开关、模型与账号凭据。')}
          </span>
          <div className="ai-process-steps is-five" aria-label="AI 分析进度">
            {ANALYSIS_STEPS.map((step, index) => {
              const currentStep = analysisStep(currentProgress?.phase ?? 'preparing')
              return (
                <span
                  className={
                    index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : ''
                  }
                  key={step}
                >
                  {step}
                </span>
              )
            })}
          </div>
        </div>
      ) : restoring && !currentResult ? (
        <div className="ai-analysis-loading is-restoring">
          <LoaderCircle size={20} className="is-spinning" />
          <strong>正在读取上次 AI 分析</strong>
        </div>
      ) : null}

      {currentResult ? (
        analysisType === 'short-term' ? (
          <ShortTermResult result={currentResult as AiInterpretationResult} />
        ) : (
          <LongTermResult result={currentResult as AiLongTermInterpretationResult} />
        )
      ) : !loading && !restoring ? (
        <div className="ai-analysis-empty">
          <Sparkles size={26} />
          <strong>按需分析，不自动调用模型</strong>
          <span>
            {analysisType === 'short-term'
              ? '近期动能分析按日 K 尺度提炼历史量价与技术指标，不预测后续行情。'
              : '基本面透视提炼历史财务指标、估值模型和价格统计，不进行价值评级或择时判断。'}
          </span>
        </div>
      ) : null}
    </section>
  )
}
