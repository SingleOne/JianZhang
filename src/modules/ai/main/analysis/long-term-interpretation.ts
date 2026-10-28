import { AI_ANALYSIS_SCHEMA_VERSION } from '../../shared/constants'
import { normalizeLongTermInterpretation } from '../../shared/long-term-language'
import type { AiLongTermInterpretation, AiLongTermSectionId } from '../../shared/types'
import type { CompactLongTermContext } from './long-term-context'
import { assertObjectiveAnalysisOutput } from './objective-output'

const LONG_TERM_SECTIONS = new Set<AiLongTermSectionId>([
  'operatingMetrics',
  'financialStructure',
  'valuationMetrics'
])

const DCF_MODEL_CONTENT_PATTERN =
  /(?:DCF|strictDcf|折现(?:现金流|模型|估值)|现金流折现|贴现现金流|WACC|加权平均资本成本|终值增长率|折现率|预测增长率|永续增长率|forecastGrowthRate|discountRate|terminalGrowthRate|rangeLow|rangeHigh|模型(?:计算|估值)(?:值|区间)|估值区间)/iu
const SINGLE_MODEL_VALUE_PATTERN =
  /(?:模型估值|模型计算值|每股模型(?:估值|计算值)|DCF(?:模型)?(?:估值|计算结果|每股值)|合理(?:股价|价格|估值)|内在价值|公允价值)\s*(?:为|约为|是|：|:)?\s*-?\d[\d,]*(?:\.\d+)?\s*元(?!\s*(?:至|到|—|-|~|～))/iu

function formatModelNumber(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function formatRateRange(values: number[]): string {
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return minimum === maximum
    ? `${formatModelNumber(minimum)}%`
    : `${formatModelNumber(minimum)}%至${formatModelNumber(maximum)}%`
}

export function createModelCalculationReference(context: CompactLongTermContext): string | null {
  const analysis = context.valuation.strictDcf?.analysis
  if (!analysis) return null
  const discountRate = formatRateRange(analysis.scenarios.map((item) => item.discountRate))
  const growthRate = formatRateRange(analysis.scenarios.map((item) => item.forecastGrowthRate))
  return `在假设折现率${discountRate}、未来增长率${growthRate}的特定数理模型（如DCF）设定下，根据历史财务数据自动化计算所得的数学区间约为${formatModelNumber(analysis.rangeLow)}元至${formatModelNumber(analysis.rangeHigh)}元。该结果仅为公式计算参考，当前市场价格受多重复杂因素影响，模型计算值不代表对该股票的未来实际定价或投资建议，请投资者注意价格波动与溢价风险。`
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (asText(item) ? [asText(item) as string] : []))
    : []
}

function parseSection(
  value: unknown,
  fallbackId?: string
): AiLongTermInterpretation['sections'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const section = value as Record<string, unknown>
  const id = asText(section.id) ?? fallbackId ?? null
  const observation = asText(section.observation)
  return id && LONG_TERM_SECTIONS.has(id as AiLongTermSectionId) && observation
    ? { id: id as AiLongTermSectionId, observation, evidence: textList(section.evidence) }
    : null
}

export function parseLongTermInterpretation(
  content: string,
  generatedAt: string,
  modelCalculationReference: string | null = null
): AiLongTermInterpretation {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('模型没有返回符合要求的基本面透视格式，请重试')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('模型基本面透视格式无效，请重试')
  }
  const record = raw as Record<string, unknown>
  const summary = asText(record.summary)
  if (!summary) throw new Error('模型基本面透视缺少摘要，请重试')

  const sections = Array.isArray(record.sections)
    ? record.sections.flatMap((item) => {
        const section = parseSection(item)
        return section ? [section] : []
      })
    : record.sections && typeof record.sections === 'object'
      ? Object.entries(record.sections).flatMap(([id, item]) => {
          const section = parseSection(item, id)
          return section ? [section] : []
        })
      : []
  const sectionIds = new Set(sections.map((section) => section.id))
  if (sectionIds.size !== LONG_TERM_SECTIONS.size || sections.length !== LONG_TERM_SECTIONS.size) {
    throw new Error('模型基本面透视缺少经营、财务结构或估值指标，请重试')
  }
  const riskFacts = textList(record.riskFacts)
  const uncertainties = textList(record.uncertainties)
  const modelOutputText = [
    summary,
    ...sections.flatMap((section) => [section.observation, ...section.evidence]),
    ...riskFacts,
    ...uncertainties
  ]
    .join(' ')
    .replace(/\s+/gu, ' ')
  if (SINGLE_MODEL_VALUE_PATTERN.test(modelOutputText)) {
    throw new Error('模型基本面透视包含单一模型估值，请重新生成')
  }
  if (DCF_MODEL_CONTENT_PATTERN.test(modelOutputText)) {
    throw new Error('模型基本面透视不得自行输出 DCF 内容，请重新生成')
  }

  const interpretation: AiLongTermInterpretation = {
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    summary,
    sections,
    modelCalculationReference: null,
    riskFacts,
    uncertainties,
    generatedAt
  }
  assertObjectiveAnalysisOutput(interpretation)
  return normalizeLongTermInterpretation({ ...interpretation, modelCalculationReference })
}
