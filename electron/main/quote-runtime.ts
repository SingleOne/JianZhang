import {
  applyTAlertTriggersToAccounts,
  type TriggeredTFloatingProfitAlert
} from '../../src/lib/t-alerts'
import { detectFiveLevelLargeOrders } from '../../src/lib/order-book-alerts'
import { applyStockAlertTriggers, type TriggeredStockAlert } from '../../src/lib/stock-alerts'
import { isBeijingAutoRefreshTime } from '../../src/shared/market-hours'
import {
  getMarketIndexStocks,
  type AppState,
  type KlineResult,
  type SectorIndexResult,
  type StockQuote,
  type WatchStock
} from '../../src/shared/types'
import { fetchQuotes } from './market'
import type { MarketRequestLogger } from './market-request-logger'
import type { OrderBookHub } from './order-book-hub'
import { QuoteRefreshCoordinator, type QuoteRefreshBatch } from './quote-refresh-coordinator'
import type { SectorMarketCache } from './sector-market-cache'

interface QuoteRuntimeDependencies {
  getState: () => AppState
  setState: (state: AppState) => void
  persistState: () => void
  sendToWindows: (channel: string, payload: unknown) => void
  updateWindowSurfaces: () => void
  publishQuotes: (quotes: readonly StockQuote[]) => void
  showStockAlertNotification: (alert: TriggeredStockAlert) => void
  showTFloatingProfitAlertNotification: (alert: TriggeredTFloatingProfitAlert) => void
  orderBookHub: OrderBookHub
  sectorMarketCache: SectorMarketCache
  marketRequestLogger: MarketRequestLogger
}

export class QuoteRuntime {
  private latestQuotes: StockQuote[] = []
  private fiveLevelRefreshCursor = 0
  private sectorBindingPrime: Promise<void> | null = null
  private lastSectorBindingPrimeAt = 0
  private readonly coordinator: QuoteRefreshCoordinator<StockQuote[]>

  constructor(private readonly dependencies: QuoteRuntimeDependencies) {
    this.coordinator = new QuoteRefreshCoordinator<StockQuote[]>({
      getPriorityIntervalMilliseconds: () =>
        this.dependencies.getState().settings.priorityRefreshSeconds * 1000,
      getRegularIntervalMilliseconds: () =>
        this.dependencies.getState().settings.regularRefreshSeconds * 1000,
      canAutoRefresh: () => this.isAutoRefreshTime(),
      run: (batch) => this.executeRefresh(batch)
    })
  }

  start(): void {
    this.coordinator.start()
  }

  dispose(): void {
    this.coordinator.dispose()
  }

  getQuotes(): StockQuote[] {
    return this.latestQuotes
  }

  refreshAll(reason = 'manual'): Promise<StockQuote[]> {
    return this.coordinator.request({ scope: 'all', reason })
  }

  refreshStock(quoteId: string, reason = 'stock-added'): Promise<StockQuote[]> {
    return this.coordinator.request({ reason, stockQuoteIds: [quoteId] })
  }

  refreshStocks(quoteIds: readonly string[], reason = 'stocks-requested'): Promise<StockQuote[]> {
    return this.coordinator.request({ reason, stockQuoteIds: quoteIds })
  }

  refreshAutomatically(reason = 'automatic'): Promise<StockQuote[]> {
    return this.isAutoRefreshTime() ? this.refreshAll(reason) : Promise.resolve(this.latestQuotes)
  }

  restartSchedule(): void {
    this.coordinator.restartSchedule()
  }

  primeSectorBindings(refreshWhenReady: boolean): Promise<void> {
    if (this.sectorBindingPrime) return this.sectorBindingPrime
    this.lastSectorBindingPrimeAt = Date.now()
    this.sectorBindingPrime = this.dependencies.sectorMarketCache
      .prime(this.dependencies.getState().watchlist)
      .then((changed) => {
        if (!changed || !refreshWhenReady || !this.isAutoRefreshTime()) return
        const sectorQuoteIds = this.dependencies.sectorMarketCache
          .dueBoardStocks(this.dependencies.getState().watchlist)
          .map((stock) => stock.quoteId)
        if (sectorQuoteIds.length > 0) {
          void this.coordinator.request({ reason: 'sector-binding', sectorQuoteIds })
        }
      })
      .finally(() => {
        this.sectorBindingPrime = null
      })
    return this.sectorBindingPrime
  }

  clearInactiveFiveLevelAlerts(): boolean {
    const activeTQuoteIds = new Set(
      Object.values(this.dependencies.getState().tTradingAccounts)
        .filter((account) => Boolean(account.activeBatch))
        .map((account) => account.quoteId)
    )
    let changed = false
    this.latestQuotes = this.latestQuotes.map((quote) => {
      if (activeTQuoteIds.has(quote.quoteId) || quote.fiveLevelLargeOrders === undefined) {
        return quote
      }
      changed = true
      return { ...quote, fiveLevelLargeOrders: undefined }
    })
    return changed
  }

  async getSectorIndex(
    stockQuoteId: string,
    getIntradayKline: (quoteId: string) => Promise<KlineResult>
  ): Promise<SectorIndexResult> {
    const binding = await this.dependencies.sectorMarketCache.ensureBinding(stockQuoteId)
    const cachedQuote = this.dependencies.sectorMarketCache.getFreshQuote(binding.boardQuoteId)
    const quotePromise = cachedQuote
      ? Promise.resolve(cachedQuote)
      : this.coordinator
          .request({
            reason: 'detail:sector',
            sectorQuoteIds: [binding.boardQuoteId]
          })
          .then(() => this.dependencies.sectorMarketCache.getFreshQuote(binding.boardQuoteId))
    const [quote, trend] = await Promise.all([quotePromise, getIntradayKline(binding.boardQuoteId)])
    if (!quote) throw new Error('行情服务未返回板块指数数据')
    return {
      stockQuoteId,
      boardCode: binding.boardCode,
      boardName: binding.boardName,
      boardQuoteId: binding.boardQuoteId,
      quote,
      trend
    }
  }

  private isAutoRefreshTime(): boolean {
    return isBeijingAutoRefreshTime(
      new Date(),
      this.dependencies.getState().settings.tradingCalendar.closedDates
    )
  }

  private mergeQuotes(refreshedQuotes: StockQuote[]): void {
    const quoteMap = new Map(this.latestQuotes.map((quote) => [quote.quoteId, quote]))
    for (const quote of refreshedQuotes) {
      const previous = quoteMap.get(quote.quoteId)
      quoteMap.set(quote.quoteId, {
        ...quote,
        sector: quote.sector ?? previous?.sector,
        radarSignals: quote.radarSignals ?? previous?.radarSignals,
        fiveLevelLargeOrders: quote.fiveLevelLargeOrders ?? previous?.fiveLevelLargeOrders
      })
    }
    const state = this.dependencies.getState()
    const displayedStocks = [
      ...state.watchlist,
      ...this.trackingProfileStocks(state),
      ...getMarketIndexStocks(state.settings.marketIndexIds)
    ]
    this.latestQuotes = this.uniqueStocks(displayedStocks).flatMap((stock) => {
      const quote = quoteMap.get(stock.quoteId)
      return quote ? [quote] : []
    })
    this.clearInactiveFiveLevelAlerts()
  }

  private applyCachedSectorQuotes(): void {
    const stockQuoteIds = new Set(
      this.dependencies.getState().watchlist.map((stock) => stock.quoteId)
    )
    this.latestQuotes = this.latestQuotes.map((quote) => {
      if (!stockQuoteIds.has(quote.quoteId)) return quote
      const sector = this.dependencies.sectorMarketCache.sectorQuote(quote.quoteId)
      if (!sector) return quote
      if (
        quote.sector?.quoteId === sector.quoteId &&
        quote.sector.code === sector.code &&
        quote.sector.name === sector.name &&
        quote.sector.changePercent === sector.changePercent
      ) {
        return quote
      }
      return { ...quote, sector }
    })
  }

  private async refreshFiveLevelLargeOrders(stocks: WatchStock[]): Promise<void> {
    const state = this.dependencies.getState()
    const tTradingStocks = stocks.filter((stock) =>
      Boolean(state.tTradingAccounts[stock.quoteId]?.activeBatch)
    )
    if (tTradingStocks.length === 0) return
    const stock = tTradingStocks[this.fiveLevelRefreshCursor % tTradingStocks.length]
    this.fiveLevelRefreshCursor = (this.fiveLevelRefreshCursor + 1) % tTradingStocks.length
    try {
      const orderBook = await this.dependencies.orderBookHub.get(stock.quoteId, {
        maxAgeMilliseconds: 3_000,
        allowStaleOnError: false,
        caller: 't-position-large-orders'
      })
      const alerts = detectFiveLevelLargeOrders(orderBook)
      this.latestQuotes = this.latestQuotes.map((quote) =>
        quote.quoteId === stock.quoteId ? { ...quote, fiveLevelLargeOrders: alerts } : quote
      )
      this.dependencies.sendToWindows('quotes:updated', this.latestQuotes)
      this.dependencies.updateWindowSurfaces()
    } catch {}
  }

  private uniqueStocks(stocks: readonly WatchStock[]): WatchStock[] {
    return [...new Map(stocks.map((stock) => [stock.quoteId, stock])).values()]
  }

  private trackingProfileStocks(state: AppState): WatchStock[] {
    return Object.values(state.stockTrackingProfiles).map((profile) => ({
      code: profile.code,
      name: profile.name,
      quoteId: profile.quoteId,
      marketLabel: profile.marketLabel,
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: false
    }))
  }

  private async executeRefresh(batch: QuoteRefreshBatch): Promise<StockQuote[]> {
    const state = this.dependencies.getState()
    const refreshAllStocks = batch.scopes.has('all')
    const refreshPriority = refreshAllStocks || batch.scopes.has('priority')
    const refreshRegular = refreshAllStocks || batch.scopes.has('regular')
    const scopedStocks = state.watchlist.filter((stock) =>
      stock.isPriority ? refreshPriority : refreshRegular
    )
    const requestableStocks = this.uniqueStocks([
      ...state.watchlist,
      ...this.trackingProfileStocks(state)
    ])
    const explicitlyRequestedStocks = requestableStocks.filter((stock) =>
      batch.stockQuoteIds.has(stock.quoteId)
    )
    const stocks = this.uniqueStocks([...scopedStocks, ...explicitlyRequestedStocks])
    const radarStocks = state.watchlist.filter((stock) => stock.showRadarSignals)
    const marketIndices = refreshRegular ? getMarketIndexStocks(state.settings.marketIndexIds) : []
    const dueSectorStocks = this.dependencies.sectorMarketCache.dueBoardStocks(scopedStocks)
    const requestedSectorStocks = [...batch.sectorQuoteIds].flatMap((quoteId) => {
      const stock = this.dependencies.sectorMarketCache.boardStockByQuoteId(quoteId)
      return stock ? [stock] : []
    })
    const sectorStocks = this.uniqueStocks([...dueSectorStocks, ...requestedSectorStocks])
    const requestedStocks = this.uniqueStocks([...stocks, ...marketIndices, ...sectorStocks])
    if (requestedStocks.length === 0) return this.latestQuotes

    const startedAt = Date.now()
    const reasons = [...batch.reasons]
    try {
      const result = await fetchQuotes(
        requestedStocks,
        radarStocks,
        `quote-cycle:${reasons.join('+')}`,
        () => {
          void this.coordinator.request({ scope: 'all', reason: 'radar-updated' })
        }
      )
      const sectorQuoteIds = new Set(sectorStocks.map((stock) => stock.quoteId))
      this.dependencies.sectorMarketCache.saveQuotes(
        result.quotes.filter((quote) => sectorQuoteIds.has(quote.quoteId))
      )
      const displayedQuoteIds = new Set([...stocks, ...marketIndices].map((stock) => stock.quoteId))
      this.mergeQuotes(result.quotes.filter((quote) => displayedQuoteIds.has(quote.quoteId)))
      this.applyCachedSectorQuotes()
      this.dependencies.publishQuotes(this.latestQuotes)
      const currentState = this.dependencies.getState()
      const tAlertUpdate = applyTAlertTriggersToAccounts(
        currentState.tTradingAccounts,
        this.latestQuotes
      )
      const stockAlertUpdate = applyStockAlertTriggers(
        currentState.watchlist,
        this.latestQuotes,
        tAlertUpdate.accounts
      )
      if (tAlertUpdate.changed || stockAlertUpdate.changed) {
        const nextState = {
          ...currentState,
          watchlist: stockAlertUpdate.watchlist,
          tTradingAccounts: tAlertUpdate.accounts
        }
        this.dependencies.setState(nextState)
        this.dependencies.persistState()
        this.dependencies.sendToWindows('state:updated', nextState)
      }
      tAlertUpdate.triggered.forEach(this.dependencies.showTFloatingProfitAlertNotification)
      stockAlertUpdate.triggered.forEach(this.dependencies.showStockAlertNotification)
      this.dependencies.sendToWindows('quotes:updated', this.latestQuotes)
      this.dependencies.updateWindowSurfaces()
      if (stocks.length > 0) void this.refreshFiveLevelLargeOrders(stocks)
      this.dependencies.marketRequestLogger.logQuoteCycle({
        reasons,
        stockCount: stocks.length,
        indexCount: marketIndices.length,
        sectorCount: sectorStocks.length,
        requestedCount: requestedStocks.length,
        returnedCount: result.quotes.length,
        durationMs: Date.now() - startedAt,
        source: result.source,
        fallbackUsed: result.source !== 'eastmoney-primary'
      })
      if (Date.now() - this.lastSectorBindingPrimeAt >= 60_000) {
        void this.primeSectorBindings(true)
      }
      return this.latestQuotes
    } catch (error) {
      const message = error instanceof Error ? error.message : '行情刷新失败'
      this.dependencies.marketRequestLogger.logQuoteCycle({
        reasons,
        stockCount: stocks.length,
        indexCount: marketIndices.length,
        sectorCount: sectorStocks.length,
        requestedCount: requestedStocks.length,
        returnedCount: 0,
        durationMs: Date.now() - startedAt,
        error: message
      })
      this.dependencies.sendToWindows('data:error', message)
      return this.latestQuotes
    }
  }
}
