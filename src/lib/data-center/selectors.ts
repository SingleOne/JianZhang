import type { AppDataSnapshot } from './center'

/** Select references only; the data remains owned by the center. */
export function pickFields<T, Key extends keyof T>(value: T, keys: readonly Key[]): Pick<T, Key> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, Key>
}

export function shallowEqual<T extends object>(previous: T, next: T): boolean {
  const keys = Object.keys(previous) as (keyof T)[]
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.hasOwn(next, key) && Object.is(previous[key], next[key]))
  )
}

export function selectSettings<Key extends keyof AppDataSnapshot['state']['settings']>(
  snapshot: AppDataSnapshot,
  keys: readonly Key[]
) {
  return pickFields(snapshot.state.settings, keys)
}

export function selectStockTradingBook(snapshot: AppDataSnapshot, quoteId: string) {
  return snapshot.state.stockTradingBooks[quoteId]
}
