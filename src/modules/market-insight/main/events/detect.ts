import type {
  MarketInsightSettings,
  MarketInsightSnapshot,
  MarketNewsItem,
  WatchEvent,
  WatchEventType
} from '../../shared/types'

export interface WatchEventDraft {
  quoteId: string
  type: WatchEventType
  severity: WatchEvent['severity']
  title: string
  facts: string[]
  occurredAt: string
  expiresAt: string
  fingerprint: string
  sourceIds: string[]
}

export interface WatchEventDetection {
  drafts: WatchEventDraft[]
  activeContinuousFingerprints: string[]
}

function findValue(snapshot: MarketInsightSnapshot, id: string): number | null {
  const groups = [
    snapshot.indicators.intraday,
    snapshot.indicators.trend,
    snapshot.indicators.momentum,
    snapshot.indicators.volatility,
    snapshot.indicators.orderBook,
    snapshot.indicators.relativeStrength
  ]
  for (const group of groups) {
    const item = group.find((value) => value.id === id)
    if (item) return item.value
  }
  return null
}

function draft(
  quoteId: string,
  type: WatchEventType,
  severity: WatchEvent['severity'],
  title: string,
  facts: string[],
  occurredAt: string,
  expiresInMinutes: number,
  sourceIds: string[] = [],
  fingerprintKey = title
): WatchEventDraft {
  return {
    quoteId,
    type,
    severity,
    title,
    facts,
    occurredAt,
    expiresAt: new Date(new Date(occurredAt).getTime() + expiresInMinutes * 60_000).toISOString(),
    fingerprint: eventFingerprint(quoteId, type, fingerprintKey),
    sourceIds
  }
}

function eventFingerprint(quoteId: string, type: WatchEventType, key: string): string {
  return `${quoteId}:${type}:${key}`
}

export function detectNewAnnouncementEvents(
  previous: readonly MarketNewsItem[] | null,
  current: readonly MarketNewsItem[],
  quoteId: string,
  occurredAt: string
): WatchEventDraft[] {
  if (!previous) return []
  const previousNews = new Set(previous.map((item) => item.id))
  return current.flatMap((item): WatchEventDraft[] => (
    !previousNews.has(item.id) && item.scope === 'stock' && item.category === 'announcement'
      ? [draft(
          quoteId,
          'new_announcement',
          'info',
          '出现新的公司公告',
          [item.title, `${item.source} · ${item.publishedAt}`],
          occurredAt,
          24 * 60,
          [item.id],
          item.id
        )]
      : []
  ))
}

export function detectWatchEvents(
  previous: MarketInsightSnapshot | null,
  current: MarketInsightSnapshot,
  settings: MarketInsightSettings
): WatchEventDetection {
  const occurredAt = current.generatedAt
  const events: WatchEventDraft[] = []
  const activeContinuousFingerprints = new Set<string>()
  const latest = findValue(current, 'vwap-deviation')
  const previousLatest = previous ? findValue(previous, 'vwap-deviation') : null
  if (latest !== null && latest > 0) {
    activeContinuousFingerprints.add(eventFingerprint(current.quoteId, 'vwap_cross', 'above-vwap'))
  }
  if (previousLatest !== null && latest !== null && previousLatest <= 0 && latest > 0) {
    events.push(draft(current.quoteId, 'vwap_cross', 'info', '价格上穿 VWAP', [`当前相对 VWAP ${latest.toFixed(2)}%`], occurredAt, 30, [], 'above-vwap'))
  }
  const volumeRatio = findValue(current, 'volume-ratio-5m')
  if (volumeRatio !== null && volumeRatio >= settings.volumeSpikeRatio) {
    activeContinuousFingerprints.add(eventFingerprint(current.quoteId, 'volume_spike', '5m-volume-ratio'))
    events.push(draft(current.quoteId, 'volume_spike', 'attention', '5 分钟成交量显著放大', [`当前为近 20 个窗口中位数的 ${volumeRatio.toFixed(2)} 倍`], occurredAt, 20, [], '5m-volume-ratio'))
  }
  const position = findValue(current, 'intraday-position')
  if (position !== null && (position >= 95 || position <= 5)) {
    const extremeKey = position >= 95 ? 'near-high' : 'near-low'
    activeContinuousFingerprints.add(eventFingerprint(current.quoteId, 'intraday_extreme', extremeKey))
    events.push(draft(current.quoteId, 'intraday_extreme', 'info', '价格接近当日区间极值', [`当前位于当日高低区间 ${position.toFixed(1)}% 位置`], occurredAt, 20, [], extremeKey))
  }
  const rangeHigh = findValue(current, 'opening-range-15-high')
  const rangeLow = findValue(current, 'opening-range-15-low')
  const vwap = current.chartOverlay.vwap
  const inferredPrice = vwap !== null && latest !== null ? vwap * (1 + latest / 100) : null
  const previousPrice = previous && previous.chartOverlay.vwap !== null
    ? previous.chartOverlay.vwap * (1 + (findValue(previous, 'vwap-deviation') ?? 0) / 100)
    : null
  if (inferredPrice !== null && previousPrice !== null && rangeHigh !== null && previousPrice <= rangeHigh && inferredPrice > rangeHigh) {
    events.push(draft(current.quoteId, 'opening_range_break', 'attention', '价格突破开盘 15 分钟高点', [`开盘区间高点 ${rangeHigh.toFixed(3)}`], occurredAt, 30, [], 'above-opening-range'))
  }
  if (inferredPrice !== null && rangeHigh !== null && inferredPrice > rangeHigh) {
    activeContinuousFingerprints.add(eventFingerprint(current.quoteId, 'opening_range_break', 'above-opening-range'))
  }
  if (inferredPrice !== null && previousPrice !== null && rangeLow !== null && previousPrice >= rangeLow && inferredPrice < rangeLow) {
    events.push(draft(current.quoteId, 'opening_range_break', 'attention', '价格跌破开盘 15 分钟低点', [`开盘区间低点 ${rangeLow.toFixed(3)}`], occurredAt, 30, [], 'below-opening-range'))
  }
  if (inferredPrice !== null && rangeLow !== null && inferredPrice < rangeLow) {
    activeContinuousFingerprints.add(eventFingerprint(current.quoteId, 'opening_range_break', 'below-opening-range'))
  }
  const imbalance = findValue(current, 'order-book-imbalance')
  const previousImbalance = previous ? findValue(previous, 'order-book-imbalance') : null
  if (imbalance !== null && previousImbalance !== null && Math.abs(imbalance - previousImbalance) >= 0.35) {
    events.push(draft(current.quoteId, 'order_book_imbalance_change', 'info', '五档委托不平衡发生变化', [`不平衡度由 ${previousImbalance.toFixed(2)} 变为 ${imbalance.toFixed(2)}`], occurredAt, 15))
  }
  const funds = findValue(current, 'funds-main-net')
  const previousFunds = previous ? findValue(previous, 'funds-main-net') : null
  if (funds !== null && previousFunds !== null && Math.sign(funds) !== Math.sign(previousFunds)) {
    events.push(draft(current.quoteId, 'funds_flow_direction_change', 'info', '主力资金净流入方向变化', [`当前主力资金净额 ${funds.toFixed(0)}`], occurredAt, 30))
  }
  const relative = findValue(current, 'relative-sector') ?? findValue(current, 'relative-index')
  const previousRelative = previous ? findValue(previous, 'relative-sector') ?? findValue(previous, 'relative-index') : null
  if (relative !== null && previousRelative !== null && Math.sign(relative) !== Math.sign(previousRelative)) {
    events.push(draft(current.quoteId, 'relative_strength_change', 'info', '相对强弱方向变化', [`当前相对强弱 ${relative.toFixed(2)}%`], occurredAt, 30))
  }
  events.push(...detectNewAnnouncementEvents(previous?.news ?? null, current.news, current.quoteId, occurredAt))
  return { drafts: events, activeContinuousFingerprints: [...activeContinuousFingerprints] }
}
