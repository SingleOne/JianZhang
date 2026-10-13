import { AI_ANALYSIS_SCHEMA_VERSION } from '../../shared/constants'
import type { AiLongTermInterpretation, AiLongTermSectionId } from '../../shared/types'
import { assertObjectiveAnalysisOutput } from './objective-output'

const LONG_TERM_SECTIONS = new Set<AiLongTermSectionId>([
  'operatingMetrics',
  'financialStructure',
  'valuationMetrics'
])

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
  generatedAt: string
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

  const interpretation: AiLongTermInterpretation = {
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    summary,
    sections,
    riskFacts: textList(record.riskFacts),
    uncertainties: textList(record.uncertainties),
    generatedAt
  }
  assertObjectiveAnalysisOutput(interpretation)
  return interpretation
}
