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

const DAILY_SCAN_SIGNAL_LABELS = {
  volumeSurge: '放量异动',
  strongGain: '大涨放量',
  strongLoss: '大跌放量',
  breakout20d: '20 日新高',
  breakdown20d: '20 日新低',
  reversal: '连跌后翻红'
} as const

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
  if (!current) {
    const profile: StockTrackingProfile = {
      quoteId: stock.quoteId,
      code: stock.code,
      name: stock.name,
      marketLabel: stock.marketLabel,
      status: 'tracking',
      tags: [],
      thesis: '',
      startedAt: now,
      updatedAt: now,
      sources: [source],
      entries: []
    }
    return appendEntry(
      profile,
      'system',
      `开始追踪，来源：${STOCK_TRACKING_SOURCE_LABELS[source.type]}`,
      quote,
      now
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

export function trackingSourceDescription(source: StockTrackingSource): string {
  const detail = source.detail
  if (source.type === 'dailyScan') {
    const signals = detail?.signals?.map((signal) => DAILY_SCAN_SIGNAL_LABELS[signal]).join('、')
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
