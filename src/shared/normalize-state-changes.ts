import { normalizeAccountCorporateActions, normalizeAccountState } from './stock-accounts'
import { createStatePatch, reuseUnchangedState } from './state-changes'
import {
  WATCHLIST_COLUMN_ORDER_VERSION,
  normalizeAppSettings,
  normalizeCorporateActionRecords,
  normalizePortfolioPerformanceAdjustments,
  normalizePortfolioPerformanceCache,
  normalizeStockTrackingProfiles,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  normalizeWatchlistGroups,
  synchronizeWatchlistGroupMemberships,
  type AppState
} from './types'

/** Normal inputs already share unchanged branches with the committed state. */
export function normalizeStateChanges(previous: AppState, input: AppState): AppState {
  let next = { ...input }
  if (next.settings !== previous.settings) {
    next.settings = reuseUnchangedState(previous.settings, normalizeAppSettings(next.settings))
  }
  if (next.columnOrder !== previous.columnOrder) {
    next.columnOrder = normalizeWatchlistColumnOrder(next.columnOrder)
    next.columnOrderVersion = WATCHLIST_COLUMN_ORDER_VERSION
  }
  if (next.watchlistGroups !== previous.watchlistGroups) {
    next.watchlistGroups = normalizeWatchlistGroups(next.watchlistGroups)
  }
  if (next.stockTrackingProfiles !== previous.stockTrackingProfiles) {
    next.stockTrackingProfiles = Object.fromEntries(
      Object.entries(next.stockTrackingProfiles).flatMap(([quoteId, profile]) => {
        const before = previous.stockTrackingProfiles[quoteId]
        if (profile === before) return [[quoteId, profile]]
        const keepHistory = before && profile.metricSnapshots === before.metricSnapshots
        const normalized = normalizeStockTrackingProfiles({
          [quoteId]: keepHistory ? { ...profile, metricSnapshots: [] } : profile
        })[quoteId]
        if (!normalized) return []
        return [
          [
            quoteId,
            keepHistory ? { ...normalized, metricSnapshots: before.metricSnapshots } : normalized
          ]
        ]
      })
    )
  }
  const previousStocks = new Map(previous.watchlist.map((stock) => [stock.quoteId, stock]))
  if (next.watchlist !== previous.watchlist) {
    next.watchlist = next.watchlist.map((stock) =>
      stock === previousStocks.get(stock.quoteId) ? stock : normalizeWatchlist([stock])[0]
    )
  }

  const accountConfigurationChanged =
    next.securitiesAccounts !== previous.securitiesAccounts ||
    next.feeSchemes !== previous.feeSchemes ||
    next.fixedFeeDefaults !== previous.fixedFeeDefaults ||
    next.portfolioSchemaVersion !== previous.portfolioSchemaVersion ||
    next.settings.lastUsedAccountIdByMarket !== previous.settings.lastUsedAccountIdByMarket ||
    next.settings.tTradingFees !== previous.settings.tTradingFees ||
    next.settings.marketTradeFees !== previous.settings.marketTradeFees

  if (accountConfigurationChanged) {
    next = normalizeAccountState(next)
  } else {
    const affectedStocks = new Set<string>()
    if (next.stockTradingBooks !== previous.stockTradingBooks) {
      for (const quoteId of new Set([
        ...Object.keys(previous.stockTradingBooks),
        ...Object.keys(next.stockTradingBooks)
      ])) {
        if (next.stockTradingBooks[quoteId] !== previous.stockTradingBooks[quoteId]) {
          affectedStocks.add(quoteId)
        }
      }
    }
    for (const stock of next.watchlist) {
      const before = previousStocks.get(stock.quoteId)
      if (
        !before ||
        before.code !== stock.code ||
        before.name !== stock.name ||
        before.market !== stock.market ||
        createStatePatch(before.position, stock.position)
      ) {
        affectedStocks.add(stock.quoteId)
      }
    }
    if (affectedStocks.size > 0) {
      const normalized = normalizeAccountState({
        ...next,
        watchlist: next.watchlist.filter((stock) => affectedStocks.has(stock.quoteId)),
        stockTradingBooks: Object.fromEntries(
          Object.entries(next.stockTradingBooks).filter(([quoteId]) => affectedStocks.has(quoteId))
        )
      })
      const normalizedStocks = new Map(normalized.watchlist.map((stock) => [stock.quoteId, stock]))
      next = {
        ...next,
        watchlist: next.watchlist.map((stock) => normalizedStocks.get(stock.quoteId) ?? stock),
        stockTradingBooks: { ...next.stockTradingBooks, ...normalized.stockTradingBooks }
      }
    }
  }
  if (next.corporateActionApplications !== previous.corporateActionApplications) {
    next.corporateActionApplications = normalizeAccountCorporateActions(
      normalizeCorporateActionRecords(next.corporateActionApplications),
      next.securitiesAccounts ?? {}
    )
  }
  if (
    next.watchlist !== previous.watchlist ||
    next.watchlistGroups !== previous.watchlistGroups ||
    next.stockTrackingProfiles !== previous.stockTrackingProfiles
  ) {
    next.watchlist = synchronizeWatchlistGroupMemberships(
      next.watchlist,
      next.watchlistGroups,
      next.stockTrackingProfiles
    )
  }
  if (
    next.watchlist !== previous.watchlist ||
    next.portfolioPerformanceAdjustments !== previous.portfolioPerformanceAdjustments
  ) {
    next.portfolioPerformanceAdjustments = normalizePortfolioPerformanceAdjustments(
      next.portfolioPerformanceAdjustments,
      next.watchlist
    )
  }
  if (
    next.watchlist !== previous.watchlist ||
    next.portfolioPerformanceCache !== previous.portfolioPerformanceCache
  ) {
    next.portfolioPerformanceCache = normalizePortfolioPerformanceCache(
      next.portfolioPerformanceCache,
      next.watchlist
    )
  }
  return reuseUnchangedState(previous, next)
}
