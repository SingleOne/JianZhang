import type {
  AppState,
  FundsFlowResult,
  KlineResult,
  StockOrderBook,
  StockQuote,
  TPlanLevel,
  WatchStock
} from '../../../shared/types'
import { tPlanTargetPrice } from '../../../lib/t-alerts'
import { calculateTBatchMetrics } from '../../../lib/t-trading'
import { getMarketIndexStocks } from '../../../shared/types'
import {
  MARKET_INSIGHT_MODULE_VERSION,
  MARKET_INSIGHT_REFRESH_INTERVALS,
  MARKET_INSIGHT_RESOURCE_LIMITS
} from '../shared/constants'
import type {
  MarketInsightSettings,
  MarketInsightSnapshot,
  MarketNewsItem,
  MarketInsightStatus,
  TPlanDistance,
  WatchEvent,
  WatchEventType
} from '../shared/types'
import { calculateIntradayIndicators } from './indicators/intraday'
import { calculateMomentumIndicators } from './indicators/momentum'
import { calculateOrderBookIndicators } from './indicators/order-book'
import { calculateRelativeStrengthIndicators } from './indicators/relative-strength'
import { calculateTrendIndicators } from './indicators/trend'
import { calculateVolatilityIndicators } from './indicators/volatility'
import { detectNewAnnouncementEvents, detectWatchEvents } from './events/detect'
import { acknowledgeWatchEvent, pruneWatchEvents, reconcileWatchEvents } from './events/lifecycle'
import { MarketNewsRegistry } from './news/registry'
import { LayeredRefreshScheduler } from './scheduler'
import { MarketInsightStorage } from './storage'

interface MarketInsightServiceDependencies {
  getState: () => AppState
  getKline: (quoteId: string, period: 'intraday' | 'daily', limit?: number) => Promise<KlineResult>
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  onUpdated: (quoteId: string) => void
}

interface CachedSource<T> {
  value: T
  savedAt: string
  dataCutoffAt: string
  expiresAt: string
}

function isExpired(savedAt: string, interval: number): boolean {
  return Date.now() - new Date(savedAt).getTime() > interval
}

function latestQuoteTime(quote: StockQuote, intraday: KlineResult): string {
  return intraday.bars.at(-1)?.time || quote.updatedAt
}

function nearestBarTime(bars: readonly { time: string }[], occurredAt: string): string {
  const target = new Date(occurredAt).getTime()
  let nearest = bars.at(-1)?.time ?? occurredAt
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const bar of bars) {
    const timestamp = new Date(`${bar.time.replace(' ', 'T')}+08:00`).getTime()
    const distance = Math.abs(timestamp - target)
    if (distance < nearestDistance) {
      nearest = bar.time
      nearestDistance = distance
    }
  }
  return nearest
}

const BEIJING_OFFSET_MILLISECONDS = 8 * 60 * 60_000
const MARKET_CLOSE_MINUTES = 15 * 60

function regularNewsQueryDate(date: Date, closedDates: readonly string[]): string | null {
  const beijing = new Date(date.getTime() + BEIJING_OFFSET_MILLISECONDS)
  const dateKey = beijing.toISOString().slice(0, 10)
  const dayOfWeek = beijing.getUTCDay()
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return dayOfWeek !== 0
    && dayOfWeek !== 6
    && minutes >= MARKET_CLOSE_MINUTES
    && !closedDates.includes(dateKey)
    ? dateKey
    : null
}

export class MarketInsightService {
  private readonly scheduler = new LayeredRefreshScheduler()
  private readonly snapshots = new Map<string, MarketInsightSnapshot>()
  private readonly snapshotPersistedAt = new Map<string, number>()
  private readonly quotes = new Map<string, StockQuote>()
  private readonly refreshes = new Map<string, Promise<MarketInsightSnapshot>>()
  private readonly newsRefreshes = new Map<string, Promise<MarketNewsItem[]>>()
  private settings: MarketInsightSettings
  private events: WatchEvent[]
  private readonly newsIndex: Record<string, string[]>
  private readonly regularNewsQueryDates: Record<string, string>
  private readonly newsScheduleTimer: ReturnType<typeof setInterval>
  private lastBuildMilliseconds: number | null = null
  private lastNewsError: string | null = null
  private lastNewsWarning: string | null = null

  constructor(
    private readonly storage: MarketInsightStorage,
    private readonly news: MarketNewsRegistry,
    private readonly dependencies: MarketInsightServiceDependencies
  ) {
    this.settings = storage.loadSettings()
    const storedEvents = storage.loadEvents()
    this.events = pruneWatchEvents(
      storedEvents,
      MARKET_INSIGHT_RESOURCE_LIMITS.maxEventsPerStock,
      new Date().toISOString()
    )
    if (this.events.length !== storedEvents.length) storage.saveEvents(this.events)
    this.newsIndex = storage.loadNewsIndex()
    this.regularNewsQueryDates = storage.loadRegularNewsQueryDates()
    storage.cleanupCache(
      MARKET_INSIGHT_RESOURCE_LIMITS.cacheRetentionMilliseconds,
      MARKET_INSIGHT_RESOURCE_LIMITS.maxCacheFiles
    )
    this.newsScheduleTimer = setInterval(
      () => void this.refreshScheduledNews().catch(() => undefined),
      60_000
    )
    void this.refreshScheduledNews().catch(() => undefined)
  }

  getStatus(): MarketInsightStatus {
    const state = this.news.state
    return {
      enabled: this.settings.enabled,
      watchedQuoteIds: this.settings.watchedQuoteIds,
      newsProviderState: state,
      newsMessage: this.lastNewsError
        ? `新闻来源刷新失败，当前保留最近缓存：${this.lastNewsError}`
        : this.lastNewsWarning
        ? `新闻源已就绪；${this.lastNewsWarning}`
        : state === 'ready'
        ? '新闻源已就绪'
        : '桌面版尚未配置已确认使用条件的新闻来源；不会将空结果表示为“无新闻”。',
      performance: {
        snapshotCount: this.snapshots.size,
        eventCount: this.events.length,
        lastBuildMilliseconds: this.lastBuildMilliseconds
      },
      resourceLimits: {
        maxSnapshots: MARKET_INSIGHT_RESOURCE_LIMITS.maxSnapshots,
        maxEventsPerStock: MARKET_INSIGHT_RESOURCE_LIMITS.maxEventsPerStock
      }
    }
  }

  getSettings(): MarketInsightSettings {
    return this.settings
  }

  saveSettings(settings: MarketInsightSettings): void {
    this.settings = settings
    this.storage.saveSettings(settings)
  }

  dispose(): void {
    clearInterval(this.newsScheduleTimer)
  }

  async getSnapshot(quoteId: string): Promise<MarketInsightSnapshot | null> {
    const memory = this.snapshots.get(quoteId)
    if (memory) return this.currentSnapshotState({ ...memory, events: this.listEvents(quoteId) })
    const stored = this.storage.loadSnapshot(quoteId)
    if (!stored) return null
    const hydrated = this.currentSnapshotState({ ...stored, events: this.listEvents(quoteId) })
    this.snapshots.set(quoteId, hydrated)
    return hydrated
  }

  listEvents(quoteId: string): WatchEvent[] {
    return this.events.filter((event) => event.quoteId === quoteId)
  }

  acknowledgeEvent(eventId: string): void {
    this.events = acknowledgeWatchEvent(this.events, eventId)
    this.storage.saveEvents(this.events)
  }

  clearExpiredEvents(quoteId: string): void {
    this.events = this.events.filter((event) => event.quoteId !== quoteId || event.status !== 'expired')
    this.storage.saveEvents(this.events)
  }

  onMarketDataUpdated(quotes: readonly StockQuote[]): void {
    for (const quote of quotes) this.quotes.set(quote.quoteId, quote)
    if (!this.settings.enabled) return
    for (const quoteId of this.settings.watchedQuoteIds) {
      if (this.quotes.has(quoteId)) void this.refresh(quoteId, false).catch(() => undefined)
    }
  }

  refresh(quoteId: string, force = true): Promise<MarketInsightSnapshot> {
    const inFlight = this.refreshes.get(quoteId)
    if (inFlight) return inFlight
    const task = this.buildSnapshot(quoteId, force).finally(() => this.refreshes.delete(quoteId))
    this.refreshes.set(quoteId, task)
    return task
  }

  private async buildSnapshot(quoteId: string, force: boolean): Promise<MarketInsightSnapshot> {
    const buildStartedAt = Date.now()
    if (!this.settings.enabled) throw new Error('市场洞察模块已关闭')
    const quote = this.quotes.get(quoteId)
    if (!quote) throw new Error('当前没有该股票的行情快照，请先刷新行情')
    const stock = this.dependencies.getState().watchlist.find((item) => item.quoteId === quoteId)
    if (!stock) throw new Error('该股票不在自选列表中')
    const [intraday, daily, orderBook, fundsFlow] = await Promise.all([
      this.source(
        quoteId,
        'intraday',
        '1m',
        MARKET_INSIGHT_REFRESH_INTERVALS.intraday,
        force,
        () => this.dependencies.getKline(quoteId, 'intraday'),
        (value) => value.bars.at(-1)?.time ?? value.tradingDate
      ),
      this.source(
        quoteId,
        'daily',
        'daily',
        MARKET_INSIGHT_REFRESH_INTERVALS.daily,
        force,
        () => this.dependencies.getKline(quoteId, 'daily', 120),
        (value) => value.bars.at(-1)?.time ?? value.tradingDate
      ),
      this.source(
        quoteId,
        'order-book',
        'five-level',
        MARKET_INSIGHT_REFRESH_INTERVALS.orderBook,
        force,
        () => this.dependencies.getOrderBook(quoteId),
        (value) => value.updatedAt
      ).catch(() => null),
      this.source(
        quoteId,
        'funds-flow',
        '1m',
        MARKET_INSIGHT_REFRESH_INTERVALS.fundsFlow,
        force,
        () => this.dependencies.getFundsFlow(quoteId),
        (value) => value.points.at(-1)?.time ?? value.tradingDate
      ).catch(() => null)
    ])
    const calculatedAt = new Date().toISOString()
    const previous = await this.getSnapshot(quoteId)
    const intradayIndicators = calculateIntradayIndicators(intraday.value.bars, quote.latest, calculatedAt)
    const previousImbalance = previous?.indicators.orderBook.find((item) => item.id === 'order-book-imbalance')?.value ?? null
    const orderBookIndicators = calculateOrderBookIndicators(orderBook?.value ?? null, calculatedAt, previousImbalance)
    const state = this.dependencies.getState()
    const selectedIndexQuoteId = getMarketIndexStocks(state.settings.marketIndexIds)[0]?.quoteId
    const relative = calculateRelativeStrengthIndicators({
      quote,
      marketIndexQuote: selectedIndexQuoteId ? this.quotes.get(selectedIndexQuoteId) : undefined,
      fundsFlow: fundsFlow?.value ?? null
    }, calculatedAt)
    const distances = this.calculateTPlanDistances(stock, quote.latest)
    let news = previous?.news ?? this.storage.loadNews(quoteId)
    if (this.news.state === 'ready' && force) {
      try {
        news = await this.fetchNews(stock, calculatedAt)
        this.lastNewsError = null
        this.lastNewsWarning = this.news.lastWarning
      } catch (reason) {
        this.lastNewsError = reason instanceof Error ? reason.message : '未知新闻来源错误'
        this.lastNewsWarning = null
      }
    }
    const provisional: MarketInsightSnapshot = {
      version: MARKET_INSIGHT_MODULE_VERSION,
      quoteId,
      generatedAt: calculatedAt,
      dataCutoffAt: latestQuoteTime(quote, intraday.value),
      dataState: this.dataState([
        { source: intraday, interval: MARKET_INSIGHT_REFRESH_INTERVALS.intraday },
        { source: daily, interval: MARKET_INSIGHT_REFRESH_INTERVALS.daily },
        { source: orderBook, interval: MARKET_INSIGHT_REFRESH_INTERVALS.orderBook },
        { source: fundsFlow, interval: MARKET_INSIGHT_REFRESH_INTERVALS.fundsFlow }
      ]),
      indicators: {
        quoteId,
        quoteTime: quote.updatedAt,
        calculatedAt,
        intraday: intradayIndicators.values,
        trend: calculateTrendIndicators(daily.value.bars, calculatedAt),
        momentum: calculateMomentumIndicators(daily.value.bars, calculatedAt),
        volatility: calculateVolatilityIndicators(daily.value.bars, calculatedAt),
        orderBook: orderBookIndicators.values,
        relativeStrength: relative.values
      },
      news,
      events: [],
      existingTPlanDistances: distances,
      chartOverlay: {
        vwap: intradayIndicators.vwap,
        openingRange15: intradayIndicators.openingRange15,
        tPlanLevels: distances
          .filter((item) => item.side === 'buy' || item.side === 'sell')
          .map((item) => ({ id: item.id, label: item.label, price: item.price, side: item.side as 'buy' | 'sell' })),
        eventMarkers: []
      }
    }
    const detection = detectWatchEvents(previous, provisional, this.settings)
    const previousEventState = JSON.stringify(this.events)
    this.events = pruneWatchEvents(
      reconcileWatchEvents(
        this.events,
        detection.drafts,
        this.settings.eventCooldownMinutes,
        calculatedAt,
        detection.activeContinuousFingerprints
      ),
      MARKET_INSIGHT_RESOURCE_LIMITS.maxEventsPerStock,
      calculatedAt
    )
    const events = this.listEvents(quoteId)
    const snapshot: MarketInsightSnapshot = {
      ...provisional,
      events,
      chartOverlay: {
        ...provisional.chartOverlay,
        eventMarkers: events
          .filter((event) => event.status !== 'expired' && event.type !== 'new_announcement')
          .slice(0, 6)
          .map((event) => ({
            time: nearestBarTime(intraday.value.bars, event.occurredAt),
            title: event.title,
            severity: event.severity
          }))
      }
    }
    this.snapshots.set(quoteId, snapshot)
    while (this.snapshots.size > MARKET_INSIGHT_RESOURCE_LIMITS.maxSnapshots) {
      const oldestQuoteId = this.snapshots.keys().next().value as string | undefined
      if (!oldestQuoteId) break
      this.snapshots.delete(oldestQuoteId)
    }
    const lastPersistedAt = this.snapshotPersistedAt.get(quoteId) ?? 0
    if (force || Date.now() - lastPersistedAt >= MARKET_INSIGHT_REFRESH_INTERVALS.intraday) {
      this.storage.saveSnapshot(snapshot)
      this.snapshotPersistedAt.set(quoteId, Date.now())
    }
    if (JSON.stringify(this.events) !== previousEventState) this.storage.saveEvents(this.events)
    this.lastBuildMilliseconds = Date.now() - buildStartedAt
    this.dependencies.onUpdated(quoteId)
    return snapshot
  }

  private async source<T>(
    quoteId: string,
    dataType: string,
    period: string,
    interval: number,
    force: boolean,
    load: () => Promise<T>,
    dataCutoffAt: (value: T) => string
  ): Promise<CachedSource<T>> {
    const cached = this.storage.loadCache<T>(quoteId, dataType, period)
    const shouldRefresh = this.scheduler.shouldRefresh(quoteId, `${dataType}:${period}`, interval, force)
    if (!shouldRefresh && cached) return cached
    try {
      const value = await load()
      return this.storage.saveCache(
        quoteId,
        dataType,
        period,
        value,
        dataCutoffAt(value),
        interval
      )
    } catch (error) {
      if (cached) return cached
      throw error
    }
  }

  private dataState(
    entries: Array<{ source: CachedSource<unknown> | null; interval: number }>
  ): 'live' | 'cached' | 'stale' {
    if (entries.some(({ source, interval }) => (
      source !== null
      && (new Date(source.expiresAt).getTime() <= Date.now() || isExpired(source.savedAt, interval))
    ))) return 'stale'
    const timestamps = entries.flatMap(({ source }) => source ? [source.savedAt] : [])
    return timestamps.some((timestamp) => new Date(timestamp).getTime() + 2_000 < Date.now()) ? 'cached' : 'live'
  }

  private currentSnapshotState(snapshot: MarketInsightSnapshot): MarketInsightSnapshot {
    const age = Date.now() - new Date(snapshot.generatedAt).getTime()
    const dataState = snapshot.dataState === 'stale' || age > MARKET_INSIGHT_REFRESH_INTERVALS.intraday
      ? 'stale'
      : age > 2_000
        ? 'cached'
        : snapshot.dataState
    return dataState === snapshot.dataState ? snapshot : { ...snapshot, dataState }
  }

  private calculateTPlanDistances(stock: WatchStock, latest: number | null): TPlanDistance[] {
    const account = this.dependencies.getState().tTradingAccounts[stock.quoteId]
    const batch = account?.activeBatch
    const batchMetrics = batch ? calculateTBatchMetrics(batch) : null
    const cost = batchMetrics ? batchMetrics.averageCost : stock.position?.cost
    if (latest === null || cost === null || cost === undefined) return []
    const position: TPlanDistance = {
      id: 'position-cost',
      label: 'T 仓均价',
      side: 'position',
      price: cost,
      distancePercent: cost === 0 ? null : (latest / cost - 1) * 100,
      quantity: batchMetrics?.remainingQuantity ?? null,
      isNearest: false
    }
    if (!batch) return [position]
    const levels = (side: 'buy' | 'sell', items: readonly TPlanLevel[] | undefined) => (items ?? []).map((level, index): TPlanDistance => {
      const price = tPlanTargetPrice(cost, side, level.targetPercent)!
      const distancePercent = price === 0 ? null : (latest / price - 1) * 100
      return {
        id: `${side}-${index + 1}`,
        label: `T${index + 1}${side === 'buy' ? ' 买入档' : ' 卖出档'}`,
        side,
        price,
        distancePercent,
        quantity: level.quantity,
        isNearest: false
      }
    })
    const result = [position, ...levels('buy', batch.buyLevels), ...levels('sell', batch.sellLevels)]
    const nearest = result
      .filter((item) => item.side !== 'position' && item.distancePercent !== null)
      .reduce<TPlanDistance | null>((current, item) => (
        !current || Math.abs(item.distancePercent!) < Math.abs(current.distancePercent!) ? item : current
      ), null)
    return result.map((item) => item.id === nearest?.id ? { ...item, isNearest: true } : item)
  }

  private async fetchNews(stock: WatchStock, fetchedAt: string) {
    const current = this.newsRefreshes.get(stock.quoteId)
    if (current) return current
    const task = this.news.fetch({
      quoteId: stock.quoteId,
      code: stock.code,
      sectorQuoteId: this.quotes.get(stock.quoteId)?.sector?.quoteId,
      fetchedAt,
      newsLookbackDays: this.settings.includeOlderNews ? 30 : 7
    }).then((items) => {
      this.newsIndex[stock.quoteId] = items.map((item) => item.id)
      this.storage.saveNewsIndex(this.newsIndex)
      this.storage.saveNews(stock.quoteId, items, this.settings.newsCacheHours)
      return items
    }).finally(() => {
      this.newsRefreshes.delete(stock.quoteId)
    })
    this.newsRefreshes.set(stock.quoteId, task)
    return task
  }

  private async refreshScheduledNews(): Promise<void> {
    if (!this.settings.enabled || this.news.state !== 'ready') return
    const state = this.dependencies.getState()
    const now = new Date()
    const fetchedAt = now.toISOString()
    const regularDate = regularNewsQueryDate(now, state.settings.tradingCalendar.closedDates)
    const due = state.watchlist.filter((stock) => {
      if (stock.isPriority) {
        return this.scheduler.shouldRefresh(
          stock.quoteId,
          'news',
          MARKET_INSIGHT_REFRESH_INTERVALS.news,
          false
        )
      }
      if (!regularDate || this.regularNewsQueryDates[stock.quoteId] === regularDate) return false
      this.regularNewsQueryDates[stock.quoteId] = regularDate
      return true
    })
    if (due.length === 0) return
    if (regularDate && due.some((stock) => !stock.isPriority)) {
      this.storage.saveRegularNewsQueryDates(this.regularNewsQueryDates)
    }
    const results = await Promise.allSettled(due.map(async (stock) => {
      const previousNews = this.storage.loadNews(stock.quoteId)
      const items = await this.fetchNews(stock, fetchedAt)
      await this.applyBackgroundNews(stock, previousNews, items, fetchedAt)
    }))
    const errors = results.flatMap((result, index) => (
      result.status === 'rejected'
        ? [`${due[index].name}：${result.reason instanceof Error ? result.reason.message : '未知错误'}`]
        : []
    ))
    this.lastNewsError = errors.length > 0 ? errors.join('；') : null
    this.lastNewsWarning = this.news.lastWarning
  }

  private async applyBackgroundNews(
    stock: WatchStock,
    previousNews: readonly MarketNewsItem[],
    items: MarketNewsItem[],
    fetchedAt: string
  ): Promise<void> {
    const previous = await this.getSnapshot(stock.quoteId)
    if (!previous) return
    const drafts = detectNewAnnouncementEvents(previousNews, items, stock.quoteId, fetchedAt)
    const continuousTypes = new Set<WatchEventType>([
      'vwap_cross',
      'opening_range_break',
      'volume_spike',
      'intraday_extreme'
    ])
    const activeContinuousFingerprints = this.events.flatMap((event) => (
      event.status !== 'expired' && continuousTypes.has(event.type) ? [event.fingerprint] : []
    ))
    const previousEventState = JSON.stringify(this.events)
    this.events = pruneWatchEvents(
      reconcileWatchEvents(
        this.events,
        drafts,
        this.settings.eventCooldownMinutes,
        fetchedAt,
        activeContinuousFingerprints
      ),
      MARKET_INSIGHT_RESOURCE_LIMITS.maxEventsPerStock,
      fetchedAt
    )
    const snapshot = {
      ...previous,
      news: items,
      events: this.listEvents(stock.quoteId)
    }
    this.snapshots.set(stock.quoteId, snapshot)
    this.storage.saveSnapshot(snapshot)
    this.snapshotPersistedAt.set(stock.quoteId, Date.now())
    if (JSON.stringify(this.events) !== previousEventState) this.storage.saveEvents(this.events)
    this.dependencies.onUpdated(stock.quoteId)
  }
}
