import { createHash } from 'node:crypto'
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
  indicators: Array<{
    group: string
    name: string
    value: number | null
    unit: string
    state: string
    sourcePeriod: string
  }>
  news: Array<{
    id: string
    title: string
    source: string
    publishedAt: string
    url: string
    category: string
  }>
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

function compactIndicators(
  groups: ReadonlyArray<readonly [string, MarketInsightSnapshot['indicators']['technical']]>
): CompactMarketSnapshot['indicators'] {
  return groups.flatMap(([group, values]) =>
    values.map((value) => ({
      group,
      name: value.label,
      value: value.value,
      unit: value.unit,
      state: value.state,
      sourcePeriod: value.sourcePeriod
    }))
  )
}

function compactNews(snapshot: MarketInsightSnapshot): CompactMarketSnapshot['news'] {
  return snapshot.news.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    url: item.url,
    category: item.category
  }))
}

function compactEvents(events: MarketInsightSnapshot['events']): CompactMarketSnapshot['events'] {
  return events.map((item) => ({
    title: item.title,
    facts: item.facts,
    occurredAt: item.occurredAt,
    severity: item.severity
  }))
}

export function compactMarketSnapshot(
  snapshot: MarketInsightSnapshot,
  chipDistribution: ChipDistributionCacheEntry | null
): CompactMarketSnapshot {
  const groups = [
    ['technical', snapshot.indicators.technical],
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
    indicators: compactIndicators(groups),
    news: compactNews(snapshot),
    events: compactEvents(snapshot.events)
  }
}

export function compactShortTermSnapshot(
  snapshot: MarketInsightSnapshot,
  chipDistribution: ChipDistributionCacheEntry | null
): CompactMarketSnapshot {
  const indicators = compactIndicators([
    ['technical', snapshot.indicators.technical],
    ['trend', snapshot.indicators.trend],
    ['momentum', snapshot.indicators.momentum],
    ['volatility', snapshot.indicators.volatility]
  ])
  const news = compactNews(snapshot)
  const events = compactEvents(snapshot.events.filter((event) => event.type === 'new_announcement'))
  const dailySource = snapshot.sourceStates?.find((source) => source.id === 'daily')
  const dataCutoffAt = dailySource?.dataCutoffAt ?? snapshot.dataCutoffAt
  const dataState =
    dailySource && dailySource.state !== 'unavailable' ? dailySource.state : snapshot.dataState
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        quoteId: snapshot.quoteId,
        dataCutoffAt,
        dataState,
        indicators,
        news,
        events,
        chipDistribution
      })
    )
    .digest('hex')
    .slice(0, 20)
  return {
    snapshotId: `${snapshot.quoteId}:short-term:${fingerprint}`,
    quoteId: snapshot.quoteId,
    generatedAt: snapshot.generatedAt,
    dataCutoffAt,
    dataState,
    chipDistribution,
    indicators,
    news,
    events
  }
}

export function toProviderMessages(
  messages: AiMessage[],
  contexts: AiChatStockContext[]
): AiProviderRequestMessage[] {
  const policy =
    contexts.length > 0
      ? `${GENERAL_CHAT_POLICY}\n\n本条消息附带以下只读股票上下文。source=mention 表示用户通过 @ 明确引用的股票，source=conversation 表示当前股票会话的默认上下文。每只股票的快照时间可能不同；回答时必须分别注明数据时间，且只能引用对应快照中的事实：\n${JSON.stringify(contexts)}`
      : GENERAL_CHAT_POLICY
  return [
    { role: 'system', content: policy },
    ...messages
      .filter((message) => message.role !== 'system' && message.status === 'completed')
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
  ]
}
