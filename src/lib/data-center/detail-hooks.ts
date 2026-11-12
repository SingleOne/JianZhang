import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { dataCenter } from '../api'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  FUNDS_FLOW_REFRESH_MILLISECONDS,
  isMarketOpen,
  millisecondsUntilNextMarketOpen,
  isBeijingAutoRefreshTime,
  millisecondsUntilNextAutoRefreshWindow
} from '../../shared/market-hours'
import { marketFromQuoteId } from '../../shared/stock-market'
import type { KlineAdjustment, KlinePeriod } from '../../shared/types'
import type { MarketCalendarDates } from '../../shared/market-calendar'
import type { DetailResource, RefreshDemand, ResourceSnapshot } from './resource'
import { useAppSetting } from './hooks'

const EMPTY: ResourceSnapshot<never> = { data: undefined, loading: false, error: '', updatedAt: 0 }
const emptySnapshot = () => EMPTY
const noSubscribe = () => () => undefined

export function useDetailResource<T>(
  resource: DetailResource<T> | undefined,
  enabled = true,
  demand?: RefreshDemand
) {
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? noSubscribe,
    resource?.getSnapshot ?? emptySnapshot
  )
  useEffect(() => (enabled ? resource?.retain(demand) : undefined), [resource, enabled, demand])
  return {
    ...snapshot,
    loading:
      enabled &&
      Boolean(resource) &&
      (snapshot.loading || (snapshot.data === undefined && !snapshot.error)),
    refresh: () => {
      if (resource) void resource.request(true).catch(() => undefined)
    }
  }
}

export function useKlineResource(
  quoteId: string | undefined,
  period: KlinePeriod | null,
  limit?: number,
  enabled = true,
  live = period === 'intraday' || period === 'fiveDay',
  calendarOverride?: MarketCalendarDates,
  adjustment: KlineAdjustment = 'forward'
) {
  const calendars = useAppSetting('tradingCalendar')
  const market = quoteId ? marketFromQuoteId(quoteId) : 'CN'
  const calendar = calendarOverride ?? calendars.markets[market]
  const demand = useMemo<RefreshDemand | undefined>(
    () =>
      live
        ? {
            interval: INTRADAY_REFRESH_MILLISECONDS,
            canRefresh: () => isMarketOpen(market, new Date(), calendar),
            nextWindow: () => millisecondsUntilNextMarketOpen(market, new Date(), calendar)
          }
        : undefined,
    [live, market, calendar]
  )
  return useDetailResource(
    quoteId && period ? dataCenter.details.kline(quoteId, period, limit, adjustment) : undefined,
    enabled,
    demand
  )
}

function useBeijingDemand(interval: number, enabled = true) {
  return useMemo<RefreshDemand | undefined>(
    () =>
      enabled
        ? {
            interval,
            canRefresh: isBeijingAutoRefreshTime,
            nextWindow: millisecondsUntilNextAutoRefreshWindow
          }
        : undefined,
    [interval, enabled]
  )
}

export function useFundsFlowResource(quoteId: string) {
  return useDetailResource(
    dataCenter.details.fundsFlow(quoteId),
    true,
    useBeijingDemand(FUNDS_FLOW_REFRESH_MILLISECONDS)
  )
}

export function useSectorResource(quoteId: string) {
  return useDetailResource(
    dataCenter.details.sector(quoteId),
    true,
    useBeijingDemand(INTRADAY_REFRESH_MILLISECONDS)
  )
}

export function useOrderBookResource(
  quoteId: string,
  refreshSeconds: number,
  autoRefresh: boolean
) {
  return useDetailResource(
    dataCenter.details.orderBook(quoteId),
    true,
    useBeijingDemand(Math.max(3, refreshSeconds) * 1000, autoRefresh)
  )
}
