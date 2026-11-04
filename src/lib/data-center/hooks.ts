import { useMemo, useSyncExternalStore } from 'react'
import { dataCenter } from '../api'
import type { AppDataSnapshot } from './center'
import type { Equality } from './store'
import { selectSettings, selectStockTradingBook, shallowEqual } from './selectors'

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

export function useAppStateField<Key extends keyof AppDataSnapshot['state']>(key: Key) {
  return useAppData((snapshot) => snapshot.state[key])
}

export function useAppSettings<Key extends keyof AppDataSnapshot['state']['settings']>(
  keys: readonly Key[]
) {
  return useAppData((snapshot) => selectSettings(snapshot, keys), shallowEqual)
}

export function useStockTradingBook(quoteId: string) {
  return useAppData((snapshot) => selectStockTradingBook(snapshot, quoteId))
}

export function useStockTrackingProfile(quoteId: string) {
  return useAppData((snapshot) => snapshot.state.stockTrackingProfiles[quoteId])
}

export function useAccountFeeData() {
  const securitiesAccounts = useAppStateField('securitiesAccounts')
  const feeSchemes = useAppStateField('feeSchemes')
  const settings = useAppSettings(['tTradingFees', 'marketTradeFees', 'lastUsedAccountIdByMarket'])
  return useMemo(
    () => ({ securitiesAccounts, feeSchemes, settings }),
    [securitiesAccounts, feeSchemes, settings]
  )
}
