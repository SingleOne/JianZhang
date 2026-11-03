import type {
  AppState,
  AppSettings,
  StockTradingBook,
  WatchStock,
  StockTrackingProfile
} from '../../shared/types'
import { upsertStockTradingBook } from '../../shared/stock-accounts'
import { createStatePatch } from '../../shared/state-changes'
import { getTrackingWatchlistGroup, synchronizeWatchlistGroupMemberships } from '../../shared/types'

export type StateMutation = (current: AppState) => AppState

/** Draft replacements must not overwrite changes made while waiting in the queue. */
export function withUnchangedData<T>(
  base: AppState,
  select: (state: AppState) => T,
  mutate: StateMutation
): StateMutation {
  const expected = select(base)
  return (current) => {
    if (createStatePatch(expected, select(current))) {
      throw new Error('相关数据已更新，请重新确认后保存')
    }
    return mutate(current)
  }
}

export interface WriteStatus {
  pendingCount: number
  activeOperation: string | null
  lastError: string | null
}

export function prepareStateMutation(current: AppState, mutate: StateMutation): AppState {
  const next = mutate(current)
  if (next === current) return current
  return {
    ...next,
    revision: current.revision,
    watchlist: synchronizeWatchlistGroupMemberships(
      next.watchlist,
      next.watchlistGroups,
      next.stockTrackingProfiles
    )
  }
}

export function changeStock(
  quoteId: string,
  change: (stock: WatchStock) => WatchStock
): StateMutation {
  return (current) => ({
    ...current,
    watchlist: current.watchlist.map((stock) => (stock.quoteId === quoteId ? change(stock) : stock))
  })
}

export function changeSettings(changes: Partial<AppSettings>): StateMutation {
  return (current) => ({ ...current, settings: { ...current.settings, ...changes } })
}

export function removeWatchStock(quoteId: string): StateMutation {
  return (current) => ({
    ...current,
    watchlist: current.watchlist.filter((stock) => stock.quoteId !== quoteId),
    portfolioPerformanceAdjustments: Object.fromEntries(
      Object.entries(current.portfolioPerformanceAdjustments ?? {}).filter(([id]) => id !== quoteId)
    )
  })
}

export function saveTrackingProfileMutation(profile: StockTrackingProfile): StateMutation {
  return (current) => {
    const group = getTrackingWatchlistGroup(current.watchlistGroups)
    return {
      ...current,
      watchlistGroups: current.watchlistGroups.some((item) => item.id === group.id)
        ? current.watchlistGroups
        : [...current.watchlistGroups, group],
      stockTrackingProfiles: { ...current.stockTrackingProfiles, [profile.quoteId]: profile }
    }
  }
}

export function saveTradingBook(book: StockTradingBook, showRadarSignals?: boolean): StateMutation {
  return (current) => {
    const next =
      showRadarSignals === undefined
        ? current
        : changeStock(book.quoteId, (stock) => ({
            ...stock,
            showRadarSignals,
            isPriority: Object.values(book.accounts).some((account) => account.position)
              ? true
              : stock.isPriority
          }))(current)
    return upsertStockTradingBook(next, book)
  }
}

/** Serialize locally initiated writes. A failed operation never replays automatically. */
export function createMutationQueue(options: {
  recover: () => Promise<void>
  onStatus: (status: WriteStatus) => void
}) {
  let tail: Promise<void> = Promise.resolve()
  let pendingCount = 0
  let needsRecovery = false
  let activeOperation: string | null = null
  let lastError: string | null = null
  const publish = () => options.onStatus({ pendingCount, activeOperation, lastError })

  return function enqueue<Result>(name: string, execute: () => Promise<Result>): Promise<Result> {
    pendingCount += 1
    publish()
    const task = tail.then(async () => {
      activeOperation = name
      publish()
      try {
        if (needsRecovery) {
          await options.recover()
          needsRecovery = false
        }
        const result = await execute()
        lastError = null
        return result
      } catch (reason) {
        lastError = reason instanceof Error ? reason.message : '保存失败'
        const shouldRecover = !needsRecovery
        needsRecovery = true
        if (shouldRecover) {
          try {
            await options.recover()
            needsRecovery = false
          } catch {
            /* The next operation must synchronize successfully before it can write. */
          }
        }
        throw reason
      } finally {
        pendingCount -= 1
        activeOperation = null
        publish()
      }
    })
    tail = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }
}
