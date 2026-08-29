import { randomUUID } from 'node:crypto'
import type { AiTAdvice, AiTAdviceAction, AiTAdviceConfidence } from '../shared/types'

export interface AiTAdviceValidationContext {
  quoteId: string
  quoteName: string
  snapshotId: string
  snapshotGeneratedAt: string
  snapshotDataState: 'live' | 'cached' | 'stale'
  snapshotStaleSources: string[]
  maxTradableQuantity: number
  providerId: string
  model: string
  generatedAt: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const normalized = text(item)
        return normalized ? [normalized] : []
      })
    : []
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function parseAiTAdvice(content: string, context: AiTAdviceValidationContext): AiTAdvice {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('模型没有返回符合要求的做 T 参考格式，请重试')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('模型返回的做 T 参考格式无效')

  const record = raw as Record<string, unknown>
  const action = record.action as AiTAdviceAction
  if (!['hold', 'forward-t', 'reverse-t'].includes(action))
    throw new Error('模型返回了不支持的做 T 动作')
  const confidence = record.confidence as AiTAdviceConfidence
  if (!['low', 'medium', 'high'].includes(confidence)) throw new Error('模型返回的置信度无效')
  const rationale = textList(record.rationale)
  const risks = textList(record.risks)
  if (rationale.length === 0 || risks.length === 0)
    throw new Error('模型返回的理由或风险提示不完整')

  const base: AiTAdvice = {
    id: randomUUID(),
    quoteId: context.quoteId,
    quoteName: context.quoteName,
    action,
    rationale,
    risks,
    confidence,
    sourceSnapshotId: context.snapshotId,
    snapshotGeneratedAt: context.snapshotGeneratedAt,
    snapshotDataState: context.snapshotDataState,
    snapshotStaleSources: context.snapshotStaleSources,
    generatedAt: context.generatedAt,
    providerId: context.providerId,
    model: context.model,
    status: 'active'
  }
  if (action === 'hold') return base

  const zone = record.priceZone
  if (!zone || typeof zone !== 'object' || Array.isArray(zone))
    throw new Error('模型没有给出有效的参考价格区间')
  const lower = positiveNumber((zone as Record<string, unknown>).lower)
  const upper = positiveNumber((zone as Record<string, unknown>).upper)
  if (lower === null || upper === null || lower > upper)
    throw new Error('模型给出的参考价格区间无效')
  const quantity = positiveNumber(record.quantity)
  if (quantity === null || !Number.isInteger(quantity) || quantity % 100 !== 0) {
    throw new Error('模型给出的参考数量不是 100 股的整数倍')
  }
  if (quantity > context.maxTradableQuantity)
    throw new Error('模型给出的参考数量超过当前可用持仓约束')
  const invalidationPrice = positiveNumber(record.invalidationPrice)
  if (invalidationPrice === null) throw new Error('模型没有给出有效的失效价格')

  return {
    ...base,
    priceZone: { lower, upper },
    quantity,
    invalidationPrice
  }
}
