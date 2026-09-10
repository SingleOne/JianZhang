import type {
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingEntry,
  StockTrackingEntryType,
  StockTrackingProfile,
  StockTrackingQuoteSnapshot,
  StockTrackingSource,
  StockTrackingSourceDetail,
  StockTrackingSourceType,
  WatchStock
} from '../shared/types'
import { marketDateKey } from '../shared/market-hours'
import { marketFromQuoteId } from '../shared/stock-market'
import { DAILY_MARKET_SCAN_SIGNAL_LABELS } from './daily-market-scan'
import {
  STOCK_TRACKING_BASE_METRICS,
  STOCK_TRACKING_VOLUME_RATIO_METRICS,
  mergeStockTrackingMetricSnapshots
} from './stock-tracking-metrics'

export const STOCK_TRACKING_SOURCE_LABELS: Record<StockTrackingSourceType, string> = {
  manual: '手动添加',
  dailyScan: '收盘扫描',
  dividendFinancing: '分红融资榜',
  fundamentalScreening: '基本面筛选',
  legacy: '历史自选'
}

export const STOCK_TRACKING_ENTRY_LABELS: Record<StockTrackingEntryType, string> = {
  note: '观察记录',
  thesis: '逻辑更新',
  review: '复盘记录',
  system: '系统记录'
}

export const STOCK_TRACKING_CONCLUSION_LABELS: Record<StockTrackingConclusionResult, string> = {
  expected: '符合预期',
  unexpected: '不符合预期',
  unverified: '尚未验证'
}

type StockTrackingSourceTagExtractor = (source: StockTrackingSource) => string[]

const STOCK_TRACKING_SOURCE_TAG_EXTRACTORS: Partial<
  Record<StockTrackingSourceType, StockTrackingSourceTagExtractor>
> = {
  dailyScan: (source) =>
    source.detail?.signals?.map((signal) => DAILY_MARKET_SCAN_SIGNAL_LABELS[signal]) ?? [],
  dividendFinancing: () => ['分红']
}

function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

export function trackingSourceTags(source: StockTrackingSource): string[] {
  return uniqueTags([
    ...(source.detail?.tags ?? []),
    ...(STOCK_TRACKING_SOURCE_TAG_EXTRACTORS[source.type]?.(source) ?? [])
  ])
}

export function trackingProfileSourceTags(profile: StockTrackingProfile): string[] {
  return uniqueTags(profile.sources.flatMap(trackingSourceTags))
}

export function addTrackingSourceTags(
  profile: StockTrackingProfile,
  now = new Date().toISOString()
): StockTrackingProfile {
  const tags = uniqueTags([...profile.tags, ...trackingProfileSourceTags(profile)])
  return tags.length === profile.tags.length ? profile : { ...profile, tags, updatedAt: now }
}

function uniqueId(): string {
  return globalThis.crypto.randomUUID()
}

function quoteSnapshot(
  quote: StockQuote | undefined,
  capturedAt: string
): StockTrackingQuoteSnapshot | undefined {
  if (quote?.latest === null || quote?.latest === undefined) return undefined
  return {
    latest: quote.latest,
    changePercent: quote.changePercent ?? null,
    capturedAt
  }
}

function appendEntry(
  profile: StockTrackingProfile,
  type: StockTrackingEntryType,
  content: string,
  quote: StockQuote | undefined,
  createdAt: string
): StockTrackingProfile {
  const entry: StockTrackingEntry = {
    id: uniqueId(),
    type,
    content: content.trim(),
    createdAt,
    quoteSnapshot: quoteSnapshot(quote, createdAt)
  }
  return {
    ...profile,
    updatedAt: createdAt,
    entries: [entry, ...profile.entries]
  }
}

export function addStockTrackingSystemEntry(
  profile: StockTrackingProfile,
  id: string,
  content: string,
  quoteSnapshot: StockTrackingQuoteSnapshot | undefined,
  createdAt: string
): StockTrackingProfile {
  if (profile.entries.some((entry) => entry.id === id)) return profile
  const entry: StockTrackingEntry = {
    id,
    type: 'system',
    content,
    createdAt,
    quoteSnapshot
  }
  return {
    ...profile,
    updatedAt: createdAt,
    entries: [entry, ...profile.entries]
  }
}

function sameSource(left: StockTrackingSource, right: StockTrackingSource): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'dailyScan') return left.detail?.tradingDate === right.detail?.tradingDate
  if (left.type === 'dividendFinancing' || left.type === 'fundamentalScreening') {
    return left.detail?.snapshotDate === right.detail?.snapshotDate
  }
  return left.recordedAt.slice(0, 10) === right.recordedAt.slice(0, 10)
}

export function createStockTrackingSource(
  type: StockTrackingSourceType,
  detail: StockTrackingSourceDetail | undefined,
  recordedAt = new Date().toISOString()
): StockTrackingSource {
  return { id: uniqueId(), type, recordedAt, detail }
}

export function startStockTracking(
  current: StockTrackingProfile | undefined,
  stock: Pick<WatchStock, 'quoteId' | 'code' | 'name' | 'marketLabel'>,
  source: StockTrackingSource,
  quote?: StockQuote,
  now = new Date().toISOString()
): StockTrackingProfile {
  const sourceTags = trackingSourceTags(source)
  if (!current) {
    const profile: StockTrackingProfile = {
      quoteId: stock.quoteId,
      code: stock.code,
      name: stock.name,
      marketLabel: stock.marketLabel,
      status: 'tracking',
      tags: sourceTags,
      thesis: '',
      startedAt: now,
      updatedAt: now,
      sources: [source],
      entries: [],
      metricSnapshots: []
    }
    return ensureStockTrackingStartedDaySnapshot(
      appendEntry(
        profile,
        'system',
        `开始追踪，来源：${STOCK_TRACKING_SOURCE_LABELS[source.type]}`,
        quote,
        now
      ),
      quote
    )
  }

  const sourceExists = current.sources.some((item) => sameSource(item, source))
  const restarting = current.status === 'stopped'
  const next = {
    ...current,
    code: stock.code,
    name: stock.name,
    marketLabel: stock.marketLabel,
    status: 'tracking' as const,
    stoppedAt: undefined,
    conclusion: undefined,
    updatedAt: now,
    tags: uniqueTags([...current.tags, ...sourceTags]),
    sources: sourceExists ? current.sources : [source, ...current.sources]
  }
  if (restarting) {
    return appendEntry(
      next,
      'system',
      `重新开始追踪，来源：${STOCK_TRACKING_SOURCE_LABELS[source.type]}`,
      quote,
      now
    )
  }
  if (!sourceExists) {
    return appendEntry(
      next,
      'system',
      `新增来源：${STOCK_TRACKING_SOURCE_LABELS[source.type]}`,
      quote,
      now
    )
  }
  return next
}

export function stopStockTracking(
  profile: StockTrackingProfile,
  result: StockTrackingConclusionResult,
  summary: string,
  quote?: StockQuote,
  now = new Date().toISOString()
): StockTrackingProfile {
  const conclusion = { result, summary: summary.trim(), stoppedAt: now }
  const next = {
    ...profile,
    status: 'stopped' as const,
    stoppedAt: now,
    updatedAt: now,
    conclusion
  }
  const conclusionText = conclusion.summary ? `：${conclusion.summary}` : ''
  return appendEntry(
    next,
    'system',
    `停止追踪（${STOCK_TRACKING_CONCLUSION_LABELS[result]}）${conclusionText}`,
    quote,
    now
  )
}

export function addStockTrackingEntry(
  profile: StockTrackingProfile,
  type: Exclude<StockTrackingEntryType, 'system'>,
  content: string,
  quote?: StockQuote,
  now = new Date().toISOString()
): StockTrackingProfile {
  return appendEntry(profile, type, content, quote, now)
}

export function initialTrackingPrice(profile: StockTrackingProfile): number | null {
  for (const source of [...profile.sources].reverse()) {
    if (source.detail?.startPrice && source.detail.startPrice > 0) return source.detail.startPrice
  }
  for (const entry of [...profile.entries].reverse()) {
    if (entry.quoteSnapshot?.latest && entry.quoteSnapshot.latest > 0)
      return entry.quoteSnapshot.latest
  }
  return null
}

export function ensureStockTrackingStartedDaySnapshot(
  profile: StockTrackingProfile,
  quote?: StockQuote
): StockTrackingProfile {
  const tradingDate = marketDateKey(
    new Date(profile.startedAt),
    profile.market ?? marketFromQuoteId(profile.quoteId)
  )
  const currentSnapshot = profile.metricSnapshots.find(
    (snapshot) => snapshot.tradingDate === tradingDate
  )
  const initialSource = profile.sources.at(-1)
  const initialQuoteSnapshot = [...profile.entries]
    .reverse()
    .find((entry) => entry.quoteSnapshot)?.quoteSnapshot
  const close = quote?.latest ?? initialQuoteSnapshot?.latest ?? initialSource?.detail?.startPrice
  if (close === null || close === undefined || !Number.isFinite(close)) return profile

  const metrics: Record<string, number> = {
    [STOCK_TRACKING_BASE_METRICS.close]: close
  }
  const changePercent =
    quote?.changePercent ??
    initialQuoteSnapshot?.changePercent ??
    initialSource?.detail?.changePercent
  if (changePercent !== null && changePercent !== undefined && Number.isFinite(changePercent)) {
    metrics[STOCK_TRACKING_BASE_METRICS.changePercent] = changePercent
  }
  if (quote?.volume !== null && quote?.volume !== undefined && Number.isFinite(quote.volume)) {
    metrics[STOCK_TRACKING_BASE_METRICS.volume] = quote.volume
  }
  if (quote?.amount !== null && quote?.amount !== undefined && Number.isFinite(quote.amount)) {
    metrics[STOCK_TRACKING_BASE_METRICS.amount] = quote.amount
  }
  const volumeRatio = initialSource?.detail?.volumeRatio
  if (volumeRatio !== undefined && Number.isFinite(volumeRatio)) {
    metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[5]] = volumeRatio
  }
  Object.assign(metrics, currentSnapshot?.metrics)

  const capturedAt =
    currentSnapshot?.capturedAt ??
    initialQuoteSnapshot?.capturedAt ??
    quote?.updatedAt ??
    initialSource?.recordedAt ??
    profile.startedAt
  return mergeStockTrackingMetricSnapshots(profile, [
    {
      tradingDate,
      capturedAt,
      metrics
    }
  ])
}

export function trackingSourceDescription(source: StockTrackingSource): string {
  const detail = source.detail
  if (source.type === 'dailyScan') {
    const signals = detail?.signals
      ?.map((signal) => DAILY_MARKET_SCAN_SIGNAL_LABELS[signal])
      .join('、')
    return [detail?.tradingDate, signals].filter(Boolean).join(' · ')
  }
  if (source.type === 'dividendFinancing') {
    return [
      detail?.snapshotDate,
      detail?.dividendRank ? `第 ${detail.dividendRank} 名` : '',
      detail?.dividendRatio !== undefined ? `分红融资比 ${detail.dividendRatio.toFixed(2)}%` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (source.type === 'fundamentalScreening') {
    return [detail?.snapshotDate, detail?.industryName].filter(Boolean).join(' · ')
  }
  return new Date(source.recordedAt).toLocaleDateString('zh-CN')
}
