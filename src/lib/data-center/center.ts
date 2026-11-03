import type { AppState, BootstrapResult, StockDesktopApi, StockQuote } from '../../shared/types'
import { getMarketIndexStocks } from '../../shared/types'
import { reconcileStockQuotes } from '../quote-state'
import { createSnapshotStore } from './store'

export interface AppDataSnapshot {
  state: AppState
  quotes: StockQuote[]
  quotesById: ReadonlyMap<string, StockQuote>
}

/** Owns shared renderer snapshots; the existing state client owns IPC revision handling. */
export function createDataCenter(transport: StockDesktopApi, initialState: AppState) {
  const store = createSnapshotStore<AppDataSnapshot>({
    state: initialState,
    quotes: [],
    quotesById: new Map()
  })
  let quoteEventVersion = 0
  let bootstrapRequest: Promise<BootstrapResult> | null = null
  let activeQuoteIds: Set<string> | undefined

  const receiveState = (state: AppState) => {
    const current = store.getSnapshot()
    if ((state.revision ?? 0) < (current.state.revision ?? 0)) return
    const ids = new Set([
      ...state.watchlist.map((stock) => stock.quoteId),
      ...Object.values(state.stockTrackingProfiles).map((profile) => profile.quoteId),
      ...getMarketIndexStocks(state.settings.marketIndexIds).map((stock) => stock.quoteId)
    ])
    activeQuoteIds = ids
    const quotes = current.quotes.filter((quote) => ids.has(quote.quoteId))
    const removed = quotes.length !== current.quotes.length
    if (state !== current.state || removed) {
      store.publish({
        ...current,
        state,
        quotes: removed ? quotes : current.quotes,
        quotesById: removed
          ? new Map(quotes.map((quote) => [quote.quoteId, quote]))
          : current.quotesById
      })
    }
  }
  const receiveQuotes = (incoming: StockQuote[]) => {
    const current = store.getSnapshot()
    // Until bootstrap establishes ownership, keep early pushes. Afterwards an old response
    // must not resurrect a stock removed while the request was in flight.
    const ids = activeQuoteIds
    const accepted = ids ? incoming.filter((quote) => ids.has(quote.quoteId)) : incoming
    const quotes = reconcileStockQuotes(current.quotes, accepted)
    if (quotes === current.quotes) return
    store.publish({ ...current, quotes, quotesById: new Map(quotes.map((q) => [q.quoteId, q])) })
  }
  const unsubscribeState = transport.onStateUpdated(receiveState)
  const unsubscribeQuotes = transport.onQuotesUpdated((quotes) => {
    quoteEventVersion += 1
    receiveQuotes(quotes)
  })

  const getBootstrap = (): Promise<BootstrapResult> => {
    if (bootstrapRequest) return bootstrapRequest
    const version = quoteEventVersion
    bootstrapRequest = transport
      .getBootstrap()
      .then((result) => {
        receiveState(result.state)
        // A push arriving while bootstrap is in flight is newer than its snapshot.
        if (version === quoteEventVersion) receiveQuotes(result.quotes)
        const current = store.getSnapshot()
        return { ...result, state: current.state, quotes: current.quotes }
      })
      .finally(() => {
        bootstrapRequest = null
      })
    return bootstrapRequest
  }

  const refreshQuotes = async (request: () => Promise<StockQuote[]>, partial = false) => {
    const version = quoteEventVersion
    const quotes = await request()
    if (version === quoteEventVersion) {
      const incoming = partial
        ? [
            ...new Map(
              [...store.getSnapshot().quotes, ...quotes].map((q) => [q.quoteId, q])
            ).values()
          ]
        : quotes
      receiveQuotes(incoming)
    }
    return quotes
  }

  // Compatibility facade lets components migrate independently without extra IPC listeners.
  const api: StockDesktopApi = {
    ...transport,
    getBootstrap,
    async saveState(state) {
      const saved = await transport.saveState(state)
      receiveState(saved)
      return store.getSnapshot().state
    },
    async archiveStockTrackingCycle(...args) {
      const result = await transport.archiveStockTrackingCycle(...args)
      receiveState(result.state)
      return { ...result, state: store.getSnapshot().state }
    },
    refreshQuotes: () => refreshQuotes(() => transport.refreshQuotes()),
    refreshQuote: (quoteId) => refreshQuotes(() => transport.refreshQuote(quoteId), true),
    refreshQuotesByIds: (quoteIds) =>
      refreshQuotes(() => transport.refreshQuotesByIds(quoteIds), true),
    onStateUpdated(callback) {
      const selection = store.select((snapshot) => snapshot.state)
      return selection.subscribe(() => callback(selection.getSnapshot()))
    },
    onQuotesUpdated(callback) {
      const selection = store.select((snapshot) => snapshot.quotes)
      return selection.subscribe(() => callback(selection.getSnapshot()))
    }
  }

  return {
    getSnapshot: store.getSnapshot,
    select: store.select,
    api,
    dispose() {
      unsubscribeState()
      unsubscribeQuotes()
    }
  }
}
