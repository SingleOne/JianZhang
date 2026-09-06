import { createHash } from 'node:crypto'
import type { MarketInsightSnapshot } from '../../../market-insight/shared/types'
import type { ChipDistributionCacheEntry } from '../../../../shared/types'
import type { AiMessage, AiProviderRequestMessage } from '../../shared/types'
import type { StockDataManifest } from '../stock-data/tool'
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
  contexts: AiChatStockContext[],
  stockDataManifest?: StockDataManifest
): AiProviderRequestMessage[] {
  const stockDataPolicy = stockDataManifest
    ? `\n\n当前消息关联了股票，但这里只提供数据目录，不包含目录所描述的详细数据。你必须先判断回答真正需要哪些数据，再调用 read_stock_data；使用清单中的 stockRef 和 datasetId，一次调用批量请求所需数据。不得把 availability、description 或数据集名称当成股票事实，也不得猜测未读取的数据。工具返回后应注明关键数据的时间、来源或缺失状态。若问题不需要股票明细，可以不调用工具。\n股票数据目录：\n${JSON.stringify(stockDataManifest)}`
    : ''
  const legacyContextPolicy =
    contexts.length > 0
      ? `${GENERAL_CHAT_POLICY}\n\n本条消息附带以下只读股票上下文。source=mention 表示用户通过 @ 明确引用的股票，source=conversation 表示当前股票会话的默认上下文。每只股票的快照时间可能不同；回答时必须分别注明数据时间，且只能引用对应快照中的事实：\n${JSON.stringify(contexts)}`
      : GENERAL_CHAT_POLICY
  const policy = stockDataManifest
    ? `${GENERAL_CHAT_POLICY}${stockDataPolicy}`
    : legacyContextPolicy
  return [
    { role: 'system', content: policy },
    ...messages
      .filter((message) => message.role !== 'system' && message.status === 'completed')
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
  ]
}
