import { randomUUID } from 'node:crypto'
import type {
  AiStructuredTaskResult,
  AiTradeImportConfidence,
  AiTradeImportEntryKind,
  AiTradeImportItem,
  AiTradeImportSourceBinding
} from '../../shared/types'

export const TRADE_IMPORT_SYSTEM_PROMPT = `你负责从券商成交记录中提取可供用户复核的结构化流水。

只提取以下三类已经发生的流水：
1. trade：已成交的股票买入或卖出。
2. cashDividend：税前现金分红、现金股息。
3. withholdingTax：红利税、股息预扣税等与某只股票关联的税费。

不得提取委托、撤单、申报、银证转账、利息、基金、债券或无法确认已经发生的流水。不要推测缺失的股票代码、时间、价格、数量、费用、金额、汇率或成交编号；缺失时省略字段。费用使用券商记录中的实际总费用，不自行按费率计算。金额始终输出正数，由 kind 表达流入或流出。

只返回 JSON，不要使用 Markdown。格式：
{"items":[{"kind":"trade|cashDividend|withholdingTax","stockCode":"","stockName":"","side":"buy|sell","occurredAt":"YYYY-MM-DDTHH:mm 或 YYYY-MM-DD","price":0,"quantity":0,"fees":0,"amount":0,"eligibleQuantity":0,"currency":"CNY|HKD|USD","exchangeRate":0,"externalId":"券商成交编号","note":"","sourceId":"输入中标注的来源ID","sourceLocator":"工作表/行号或图片中的位置","confidence":"high|medium|low","evidence":"不超过80字的原始证据"}]}

trade 使用 side、price、quantity、fees；cashDividend 使用 amount，可选 eligibleQuantity；withholdingTax 使用 amount。每条流水都必须填写正确的 sourceId。若没有符合条件的流水，返回 {"items":[]}。`

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function kind(value: unknown): AiTradeImportEntryKind | undefined {
  return value === 'trade' || value === 'cashDividend' || value === 'withholdingTax'
    ? value
    : undefined
}

function confidence(value: unknown): AiTradeImportConfidence {
  return value === 'high' || value === 'medium' ? value : 'low'
}

function parseJson(content: string): unknown {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(normalized)
  } catch {
    throw new Error('模型没有返回有效的交易记录结构，请重试')
  }
}

export function parseTradeImportExtraction(
  result: AiStructuredTaskResult,
  sources: readonly AiTradeImportSourceBinding[]
): AiTradeImportItem[] {
  const root = record(parseJson(result.content))
  const rawItems = Array.isArray(root?.items) ? root.items : []
  const knownSources = new Set(sources.map((source) => source.id))
  const fallbackSourceId = sources[0]?.id ?? 'source-text'

  return rawItems.flatMap((value) => {
    const raw = record(value)
    const entryKind = kind(raw?.kind)
    if (!raw || !entryKind) return []
    const rawSourceId = text(raw.sourceId)
    const sourceId = rawSourceId && knownSources.has(rawSourceId) ? rawSourceId : fallbackSourceId
    const rawSide = text(raw.side)?.toLowerCase()
    const rawCurrency = text(raw.currency)?.toUpperCase()
    return [
      {
        id: randomUUID(),
        selected: true,
        kind: entryKind,
        stockCode: text(raw.stockCode),
        stockName: text(raw.stockName),
        side: rawSide === 'buy' || rawSide === 'sell' ? rawSide : undefined,
        occurredAt: text(raw.occurredAt)?.replace(' ', 'T'),
        price: number(raw.price),
        quantity: number(raw.quantity),
        fees: number(raw.fees),
        amount: number(raw.amount),
        eligibleQuantity: number(raw.eligibleQuantity),
        currency:
          rawCurrency === 'CNY' || rawCurrency === 'HKD' || rawCurrency === 'USD'
            ? rawCurrency
            : undefined,
        exchangeRate: number(raw.exchangeRate),
        externalId: text(raw.externalId),
        note: text(raw.note),
        sourceId,
        sourceLocator: text(raw.sourceLocator),
        confidence: confidence(raw.confidence),
        evidence: text(raw.evidence)?.slice(0, 80),
        issues: []
      }
    ]
  })
}
