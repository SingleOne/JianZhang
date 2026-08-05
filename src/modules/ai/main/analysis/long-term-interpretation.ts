import type {
  AiLongTermDimensionId,
  AiLongTermInterpretation
} from '../../shared/types'

const LONG_TERM_DIMENSIONS = new Set<AiLongTermDimensionId>([
  'businessQuality',
  'cashFlow',
  'capitalEfficiency',
  'balanceSheet',
  'valuation',
  'shareholderReturn',
  'priceTiming'
])

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
  const dimensions = Array.isArray(record.dimensions)
    ? record.dimensions.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const dimension = item as Record<string, unknown>
      const id = asText(dimension.id) as AiLongTermDimensionId | null
      const conclusion = asText(dimension.conclusion)
      const evidence = Array.isArray(dimension.evidence)
        ? dimension.evidence.flatMap((entry) => asText(entry) ? [asText(entry) as string] : [])
        : []
      return id && LONG_TERM_DIMENSIONS.has(id) && conclusion
        ? [{ id, conclusion, evidence }]
        : []
    })
    : []
  if (dimensions.length === 0) throw new Error('模型长期价值分析缺少有效维度，请重试')
  const textList = (value: unknown) => Array.isArray(value)
    ? value.flatMap((item) => asText(item) ? [asText(item) as string] : [])
    : []
  return {
    summary,
    dimensions,
    risks: textList(record.risks),
    uncertainties: textList(record.uncertainties),
    generatedAt
  }
}
