import type {
  AppState,
  BootstrapResult,
  StockDesktopApi,
  StockQuote,
  StockTrackingArchiveIndex
} from '../../shared/types'
import { getMarketIndexStocks } from '../../shared/types'
import { reconcileStockQuotes } from '../quote-state'
import { createSnapshotStore } from './store'
import {
  createMutationQueue,
  prepareStateMutation,
  type StateMutation,
  type WriteStatus
} from './mutations'

export interface AppDataSnapshot {
  state: AppState
  quotes: StockQuote[]
  quotesById: ReadonlyMap<string, StockQuote>
  trackingArchiveIndex: StockTrackingArchiveIndex
  writes: WriteStatus
}

/** Owns shared renderer snapshots; the existing state client owns IPC revision handling. */
export function createDataCenter(transport: StockDesktopApi, initialState: AppState) {
  const store = createSnapshotStore<AppDataSnapshot>({
    state: initialState,
    quotes: [],
    quotesById: new Map(),
    trackingArchiveIndex: {},
    writes: { pendingCount: 0, activeOperation: null, lastError: null }
  })
  let quoteEventVersion = 0
  let bootstrapRequest: Promise<BootstrapResult> | null = null
  let activeQuoteIds: Set<string> | undefined
  let confirmedState = initialState
  let archiveVersion = 0
  const receiveArchives = (trackingArchiveIndex: StockTrackingArchiveIndex) => {
    archiveVersion += 1
    store.publish({ ...store.getSnapshot(), trackingArchiveIndex })
  }

  const receiveState = (state: AppState) => {
    const current = store.getSnapshot()
    if ((state.revision ?? 0) < (confirmedState.revision ?? 0)) return
    confirmedState = state
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
    const knownArchiveVersion = archiveVersion
    bootstrapRequest = transport
      .getBootstrap()
      .then((result) => {
        receiveState(result.state)
        // A push arriving while bootstrap is in flight is newer than its snapshot.
        if (version === quoteEventVersion) receiveQuotes(result.quotes)
        if (knownArchiveVersion === archiveVersion) receiveArchives(result.trackingArchiveIndex)
        const current = store.getSnapshot()
        return {
          ...result,
          state: current.state,
          quotes: current.quotes,
          trackingArchiveIndex: current.trackingArchiveIndex
        }
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

  const enqueue = createMutationQueue({
    onStatus: (writes) => store.publish({ ...store.getSnapshot(), writes }),
    recover: async () => {
      // Restore the latest confirmed state, never a snapshot captured before the failed write.
      receiveState(confirmedState)
      await getBootstrap()
    }
  })
  const preview = (mutate: StateMutation) => {
    const next = prepareStateMutation(confirmedState, mutate)
    // An optimistic deletion must not discard quotes needed if saving fails.
    store.publish({ ...store.getSnapshot(), state: next })
    return next
  }
  const update = (mutate: StateMutation, name = '保存数据') =>
    enqueue(name, async () => {
      const next = preview(mutate)
      if (next === confirmedState) return confirmedState
      const saved = await transport.saveState(next)
      receiveState(saved)
      return confirmedState
    })
  const legacyMutation =
    (next: AppState): StateMutation =>
    (current) => {
      if (next.revision !== current.revision) throw new Error('数据已在后台更新，请重试刚才的操作')
      return next
    }
  const archive = (
    prepare: (state: AppState) => {
      state: AppState
      profile: Parameters<StockDesktopApi['archiveStockTrackingCycle']>[1] | undefined
      deletePreviousArchives: boolean
    }
  ) =>
    enqueue('归档追踪记录', async () => {
      const command = prepare(confirmedState)
      const next = preview(() => command.state)
      const result = command.profile
        ? await transport.archiveStockTrackingCycle(
            next,
            command.profile,
            command.deletePreviousArchives
          )
        : {
            state: await transport.saveState(next),
            archiveIndex: store.getSnapshot().trackingArchiveIndex
          }
      receiveState(result.state)
      receiveArchives(result.archiveIndex)
      return { ...result, state: confirmedState }
    })

  // Compatibility facade routes all local writes through the same queue.
  const api: StockDesktopApi = {
    ...transport,
    getBootstrap,
    saveState: (state) => update(legacyMutation(state)),
    archiveStockTrackingCycle: (state, profile, deletePreviousArchives) =>
      archive((current) => ({
        state: legacyMutation(state)(current),
        profile,
        deletePreviousArchives
      })),
    deleteStockTrackingArchiveCycle: (quoteId, cycleId) =>
      enqueue('删除追踪周期', async () => {
        const index = await transport.deleteStockTrackingArchiveCycle(quoteId, cycleId)
        receiveArchives(index)
        return index
      }),
    deleteAllStockTrackingArchives: (quoteId) =>
      enqueue('清空追踪档案', async () => {
        const index = await transport.deleteAllStockTrackingArchives(quoteId)
        receiveArchives(index)
        return index
      }),
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
    commands: { update, archive },
    dispose() {
      unsubscribeState()
      unsubscribeQuotes()
    }
  }
}
