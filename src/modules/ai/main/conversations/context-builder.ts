import type { MarketInsightSnapshot } from '../../../market-insight/shared/types'
import type { ChipDistributionCacheEntry } from '../../../../shared/types'
import type { AiMessage, AiProviderRequestMessage } from '../../shared/types'
import { GENERAL_CHAT_POLICY } from '../policy'

export interface CompactMarketSnapshot {
  snapshotId: string
  quoteId: string
  generatedAt: string
  dataCutoffAt: string
  dataState: MarketInsightSnapshot['dataState']
  chipDistribution: ChipDistributionCacheEntry | null
  indicators: Array<{ group: string; name: string; value: number | null; unit: string; state: string; sourcePeriod: string }>
  news: Array<{ id: string; title: string; source: string; publishedAt: string; url: string; category: string }>
  events: Array<{ title: string; facts: string[]; occurredAt: string; severity: string }>
}

export interface AiChatStockContext {
  source: 'conversation' | 'mention'
  quoteName?: string
  code?: string
  marketLabel?: string
  snapshot: CompactMarketSnapshot
}

function snapshotId(
  snapshot: MarketInsightSnapshot,
  chipDistribution: ChipDistributionCacheEntry | null
): string {
  return `${snapshot.quoteId}:${snapshot.generatedAt}:${chipDistribution?.calculatedAt ?? 'no-chip'}`
}

export function compactMarketSnapshot(
  snapshot: MarketInsightSnapshot,
  chipDistribution: ChipDistributionCacheEntry | null
): CompactMarketSnapshot {
  const groups = [
    ['intraday', snapshot.indicators.intraday],
    ['trend', snapshot.indicators.trend],
    ['momentum', snapshot.indicators.momentum],
    ['volatility', snapshot.indicators.volatility],
    ['orderBook', snapshot.indicators.orderBook],
    ['relativeStrength', snapshot.indicators.relativeStrength]
  ] as const
  return {
    snapshotId: snapshotId(snapshot, chipDistribution),
    quoteId: snapshot.quoteId,
    generatedAt: snapshot.generatedAt,
    dataCutoffAt: snapshot.dataCutoffAt,
    dataState: snapshot.dataState,
    chipDistribution,
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
  contexts: AiChatStockContext[]
): AiProviderRequestMessage[] {
  const policy = contexts.length > 0
    ? `${GENERAL_CHAT_POLICY}\n\n本条消息附带以下只读股票上下文。source=mention 表示用户通过 @ 明确引用的股票，source=conversation 表示当前股票会话的默认上下文。每只股票的快照时间可能不同；回答时必须分别注明数据时间，且只能引用对应快照中的事实：\n${JSON.stringify(contexts)}`
    : GENERAL_CHAT_POLICY
  return [
    { role: 'system', content: policy },
    ...messages
      .filter((message) => message.role !== 'system' && message.status === 'completed')
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
  ]
}
