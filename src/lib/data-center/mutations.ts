import type {
  AppState,
  AppSettings,
  StockTradingBook,
  WatchStock,
  StockTrackingProfile,
  SecuritiesAccounts,
  BrokerFeeSchemes,
  CnFixedFeeRates
} from '../../shared/types'
import {
  upsertStockTradingBook,
  flattenStockAccountBooks,
  normalizeAccountState
} from '../../shared/stock-accounts'
import { createStatePatch } from '../../shared/state-changes'
import { getTrackingWatchlistGroup, synchronizeWatchlistGroupMemberships } from '../../shared/types'
import { validateFeeConfiguration } from '../../shared/fee-schemes'
import { getActiveStockTBatches } from '../../shared/stock-t-batches'
import { getBatchTrades } from '../trade-records'

export type StateMutation = (current: AppState) => AppState

/** Draft replacements must not overwrite changes made while waiting in the queue. */
export function withUnchangedData<T>(
  base: AppState,
  select: (state: AppState) => T,
  mutate: StateMutation
): StateMutation {
  return withUnchangedValue(select(base), select, mutate)
}

export function withUnchangedValue<T>(
  expected: T,
  select: (state: AppState) => T,
  mutate: StateMutation
): StateMutation {
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
  const watchlist = synchronizeWatchlistGroupMemberships(
    next.watchlist,
    next.watchlistGroups,
    next.stockTrackingProfiles
  )
  return {
    ...next,
    revision: current.revision,
    watchlist: watchlist.every((stock, index) => stock === next.watchlist[index])
      ? next.watchlist
      : watchlist
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

export function saveFeeConfiguration(
  feeSchemes: BrokerFeeSchemes,
  fixedFeeDefaults: CnFixedFeeRates
): StateMutation {
  return (current) => {
    validateFeeConfiguration(current.securitiesAccounts!, feeSchemes, fixedFeeDefaults)
    return normalizeAccountState({ ...current, feeSchemes, fixedFeeDefaults })
  }
}

export function saveSecuritiesAccounts(accounts: SecuritiesAccounts): StateMutation {
  return (current) => {
    validateFeeConfiguration(accounts, current.feeSchemes!, current.fixedFeeDefaults!)
    const books = Object.values(flattenStockAccountBooks(current.stockTradingBooks))
    for (const previous of Object.values(current.securitiesAccounts ?? {})) {
      const next = accounts[previous.id]
      const accountBooks = books.filter((book) => book.accountId === previous.id)
      if (
        !next &&
        (accountBooks.length ||
          Object.values(current.corporateActionApplications).some(
            (record) => record.accountId === previous.id
          ))
      ) {
        throw new Error('该账户已有业务记录，可以停用并保留历史。')
      }
      if (
        previous.enabled &&
        next &&
        !next.enabled &&
        accountBooks.some(
          (book) =>
            (book.position?.quantity ?? 0) > 0 ||
            getActiveStockTBatches(current.stockTradingBooks[book.quoteId]).some((batch) =>
              getBatchTrades(current.stockTradingBooks[book.quoteId], batch).some(
                (trade) => trade.accountId === previous.id
              )
            )
        )
      ) {
        throw new Error('该账户仍有持仓或未结算 T 批次，请先处理后再停用。')
      }
    }
    return normalizeAccountState({ ...current, securitiesAccounts: accounts })
  }
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
