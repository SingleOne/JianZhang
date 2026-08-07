import type {
  AiLongTermInterpretation,
  AiLongTermPriceTimingLevel,
  AiLongTermSectionId,
  AiLongTermValueLevel
} from '../../shared/types'

const LONG_TERM_SECTIONS = new Set<AiLongTermSectionId>([
  'enterpriseQuality',
  'financialSafety',
  'currentPrice'
])
const VALUE_LEVELS = new Set<AiLongTermValueLevel>(['high', 'medium', 'low', 'insufficient'])
const PRICE_LEVELS = new Set<AiLongTermPriceTimingLevel>([
  'favorable',
  'neutral',
  'unfavorable',
  'insufficient'
])

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => asText(item) ? [asText(item) as string] : [])
    : []
}

function parseSection(
  value: unknown,
  fallbackId?: string
): AiLongTermInterpretation['sections'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const section = value as Record<string, unknown>
  const id = asText(section.id) ?? fallbackId ?? null
  const conclusion = asText(section.conclusion)
  return id && LONG_TERM_SECTIONS.has(id as AiLongTermSectionId) && conclusion
    ? { id: id as AiLongTermSectionId, conclusion, evidence: textList(section.evidence) }
    : null
}

export function parseLongTermInterpretation(
  content: string,
  generatedAt: string
): AiLongTermInterpretation {
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('模型没有返回符合要求的长期价值分析格式，请重试')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('模型长期价值分析格式无效，请重试')
  }
  const record = raw as Record<string, unknown>
  const summary = asText(record.summary)
  if (!summary) throw new Error('模型长期价值分析缺少摘要，请重试')

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
    throw new Error('模型长期价值分析缺少企业质量、财务安全或当前价格，请重试')
  }

  const conclusion = record.conclusion && typeof record.conclusion === 'object'
    ? record.conclusion as Record<string, unknown>
    : null
  const longTermValue = conclusion?.longTermValue && typeof conclusion.longTermValue === 'object'
    ? conclusion.longTermValue as Record<string, unknown>
    : null
  const priceTiming = conclusion?.priceTiming && typeof conclusion.priceTiming === 'object'
    ? conclusion.priceTiming as Record<string, unknown>
    : null
  const longTermValueLevel = asText(longTermValue?.level) as AiLongTermValueLevel | null
  const priceTimingLevel = asText(priceTiming?.level) as AiLongTermPriceTimingLevel | null
  const longTermValueReason = asText(longTermValue?.reason)
  const priceTimingReason = asText(priceTiming?.reason)
  if (
    !longTermValueLevel || !VALUE_LEVELS.has(longTermValueLevel) || !longTermValueReason
    || !priceTimingLevel || !PRICE_LEVELS.has(priceTimingLevel) || !priceTimingReason
  ) {
    throw new Error('模型长期价值分析缺少长期价值或当前时机结论，请重试')
  }

  return {
    summary,
    sections,
    conclusion: {
      longTermValue: { level: longTermValueLevel, reason: longTermValueReason },
      priceTiming: { level: priceTimingLevel, reason: priceTimingReason }
    },
    risks: textList(record.risks),
    uncertainties: textList(record.uncertainties),
    generatedAt
  }
}
