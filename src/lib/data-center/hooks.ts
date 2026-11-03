import { useMemo, useSyncExternalStore } from 'react'
import { dataCenter } from '../api'
import type { AppDataSnapshot } from './center'
import type { Equality } from './store'

export function useAppData<Value>(
  selector: (snapshot: AppDataSnapshot) => Value,
  equal: Equality<Value> = Object.is
): Value {
  const selection = useMemo(() => dataCenter.select(selector, equal), [selector, equal])
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot)
}

export function useStockQuote(quoteId: string) {
  return useAppData((snapshot) => snapshot.quotesById.get(quoteId))
}

export function useAppSetting<Key extends keyof AppDataSnapshot['state']['settings']>(key: Key) {
  return useAppData((snapshot) => snapshot.state.settings[key])
}
