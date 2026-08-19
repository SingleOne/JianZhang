import type { WatchStock } from '../shared/types'

export function getTaskbarVisibleStocks(watchlist: readonly WatchStock[]): WatchStock[] {
  return watchlist.filter((stock) => stock.showInTaskbar)
}

export function shouldShowTaskbarTicker(
  showTaskbarTicker: boolean,
  watchlist: readonly WatchStock[]
): boolean {
  return showTaskbarTicker && watchlist.some((stock) => stock.showInTaskbar)
}
