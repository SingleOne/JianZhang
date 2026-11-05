import { useEffect } from 'react'
import { dataCenter, stockApi } from '../api'
import { useDetailResource } from './detail-hooks'
import type { DetailResource } from './resource'
import type { DataSnapshotRuntimeState } from '../../shared/types'

export const EMPTY_DATA_SNAPSHOT_STATE: DataSnapshotRuntimeState = {
  status: 'missing',
  progressMessage: null,
  error: null,
  snapshotDate: null,
  generatedAt: null,
  recordCount: 0,
  periodLabel: null,
  staleReason: null
}
const options = (category: string) => ({ category, quoteId: '', maxAge: Infinity })
export const dividendDataResource = () =>
  dataCenter.details.resource(
    'dividend:data',
    async () => {
      const [snapshot, changeReport] = await Promise.all([
        stockApi.getDividendFinancingSnapshot(),
        stockApi.getDividendFinancingChangeReport()
      ])
      return { snapshot, changeReport }
    },
    options('dividend-financing')
  )
export const fundamentalDataResource = () =>
  dataCenter.details.resource(
    'fundamental:data',
    async () => {
      const [snapshot, changeReport] = await Promise.all([
        stockApi.getFundamentalSnapshot(),
        stockApi.getFundamentalChangeReport()
      ])
      return { snapshot, changeReport }
    },
    options('fundamental')
  )
const dividendStateResource = () =>
  dataCenter.details.resource(
    'dividend:state',
    () => stockApi.getDividendFinancingState(),
    options('dividend-state')
  )
const fundamentalStateResource = () =>
  dataCenter.details.resource(
    'fundamental:state',
    () => stockApi.getFundamentalState(),
    options('fundamental-state')
  )

// Retire pre-write requests while retaining the last successful display on read failure.
function reload<T>(resource: DetailResource<T>) {
  resource.invalidate(true)
  void resource.request().catch(() => undefined)
}
function reloadDomain(domain: 'dividend' | 'fundamental') {
  dataCenter.details.invalidate(
    undefined,
    domain === 'dividend'
      ? ['dividend-financing', 'dividend-overview']
      : ['fundamental', 'fundamental-overview'],
    true
  )
}
function useUpdates(enabled: boolean) {
  useEffect(() => (enabled ? retainUpdates() : undefined), [enabled])
}
let consumers = 0
let unsubscribe: (() => void) | undefined
function retainUpdates() {
  consumers += 1
  if (consumers === 1) {
    const onState = (domain: 'dividend' | 'fundamental', next: DataSnapshotRuntimeState) => {
      const resource = domain === 'dividend' ? dividendStateResource() : fundamentalStateResource()
      const previous = resource.getSnapshot().data
      resource.update(next)
      if (!previous || previous.generatedAt !== next.generatedAt || previous.status !== next.status)
        reloadDomain(domain)
    }
    const stopDividend = stockApi.onDividendFinancingStateUpdated((next) =>
      onState('dividend', next)
    )
    const stopFundamental = stockApi.onFundamentalStateUpdated((next) =>
      onState('fundamental', next)
    )
    unsubscribe = () => {
      stopDividend()
      stopFundamental()
    }
    // Fresh reads on re-entry; update() in the push handler invalidates older initialization.
    reloadDomain('dividend')
    reloadDomain('fundamental')
    reload(dividendStateResource())
    reload(fundamentalStateResource())
  }
  return () => {
    consumers -= 1
    if (!consumers) {
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}
export function useMarketDataState(enabled = true) {
  useUpdates(enabled)
  const dividend = useDetailResource(dividendStateResource(), enabled)
  const fundamental = useDetailResource(fundamentalStateResource(), enabled)
  return {
    dividendState: dividend.data ?? EMPTY_DATA_SNAPSHOT_STATE,
    fundamentalState: fundamental.data ?? EMPTY_DATA_SNAPSHOT_STATE
  }
}
export function useDividendData(enabled: boolean) {
  useUpdates(enabled)
  return useDetailResource(dividendDataResource(), enabled)
}
export function useFundamentalData(enabled: boolean) {
  useUpdates(enabled)
  return useDetailResource(fundamentalDataResource(), enabled)
}
export function useMarketDataOverviews(codes: string[], enabled: boolean) {
  const normalized = [...new Set(codes)].sort()
  const key = JSON.stringify(normalized)
  const dividend = dataCenter.details.resource(
    ['dividend:overview', key].join(':'),
    () => stockApi.getDividendFinancingOverview(normalized),
    options('dividend-overview')
  )
  const fundamental = dataCenter.details.resource(
    ['fundamental:overview', key].join(':'),
    () => stockApi.getFundamentalOverview(normalized),
    options('fundamental-overview')
  )
  return {
    dividend: useDetailResource(dividend, enabled).data,
    fundamental: useDetailResource(fundamental, enabled).data
  }
}
export async function updateDividendData() {
  const result = await stockApi.runDividendFinancingUpdate()
  dividendDataResource().update({ snapshot: result.snapshot, changeReport: result.changeReport })
  reload(dividendStateResource())
  dataCenter.details.invalidate(undefined, ['dividend-overview'], true)
  return result
}
export async function updateFundamentalData() {
  const result = await stockApi.runFundamentalUpdate()
  fundamentalDataResource().update({ snapshot: result.snapshot, changeReport: result.changeReport })
  reload(fundamentalStateResource())
  dataCenter.details.invalidate(undefined, ['fundamental-overview'], true)
  return result
}
