import type { MarketInsightSnapshot } from '../../../market-insight/shared/types'
import type { AiMessage, AiProviderRequestMessage } from '../../shared/types'
import { GENERAL_CHAT_POLICY } from '../policy'

export interface CompactMarketSnapshot {
  snapshotId: string
  quoteId: string
  generatedAt: string
  dataCutoffAt: string
  dataState: MarketInsightSnapshot['dataState']
  indicators: Array<{ group: string; name: string; value: number | null; unit: string; state: string; sourcePeriod: string }>
  news: Array<{ id: string; title: string; source: string; publishedAt: string; url: string; category: string }>
  events: Array<{ title: string; facts: string[]; occurredAt: string; severity: string }>
}

function snapshotId(snapshot: MarketInsightSnapshot): string {
  return `${snapshot.quoteId}:${snapshot.generatedAt}`
}

export function compactMarketSnapshot(snapshot: MarketInsightSnapshot): CompactMarketSnapshot {
  const groups = [
    ['intraday', snapshot.indicators.intraday],
    ['trend', snapshot.indicators.trend],
    ['momentum', snapshot.indicators.momentum],
    ['volatility', snapshot.indicators.volatility],
    ['orderBook', snapshot.indicators.orderBook],
    ['relativeStrength', snapshot.indicators.relativeStrength]
  ] as const
  return {
    snapshotId: snapshotId(snapshot),
    quoteId: snapshot.quoteId,
    generatedAt: snapshot.generatedAt,
    dataCutoffAt: snapshot.dataCutoffAt,
    dataState: snapshot.dataState,
    indicators: groups.flatMap(([group, values]) => values.map((value) => ({
      group,
      name: value.label,
      value: value.value,
      unit: value.unit,
      state: value.state,
      sourcePeriod: value.sourcePeriod
    }))),
    news: snapshot.news.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
      category: item.category
    })),
    events: snapshot.events.map((item) => ({
      title: item.title,
      facts: item.facts,
      occurredAt: item.occurredAt,
      severity: item.severity
    }))
  }
}

export function toProviderMessages(
  messages: AiMessage[],
  context: CompactMarketSnapshot | null
): AiProviderRequestMessage[] {
  const policy = context
    ? `${GENERAL_CHAT_POLICY}\n\n本次对话附带以下只读市场快照。它可能不是当前行情；回答时必须注明数据时间，且只能引用其中的事实：\n${JSON.stringify(context)}`
    : GENERAL_CHAT_POLICY
  return [
    { role: 'system', content: policy },
    ...messages
      .filter((message) => message.role !== 'system' && message.status === 'completed')
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
  ]
}
