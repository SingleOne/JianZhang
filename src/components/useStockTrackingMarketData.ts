import { useMemo } from 'react'
import { useKlineResource } from '../lib/data-center/detail-hooks'
import {
  calculateRealtimeVolumeRatio,
  type RealtimeVolumeRatioPoint
} from '../lib/stock-tracking-metrics'
import { marketFromQuoteId } from '../shared/stock-market'
import type { MarketCalendarDates } from '../shared/market-calendar'
import type { KlineBar } from '../shared/types'

export interface StockTrackingMarketData {
  dailyBars: KlineBar[]
  realtimeVolumeRatioPoints: RealtimeVolumeRatioPoint[]
  realtimeTradingDate: string
  realtimeIntervalMinutes?: 1 | 5
  realtimeFallbackReason?: string
  realtimeLoading: boolean
  realtimeError: string
}

export function useStockTrackingMarketData(
  quoteId?: string,
  marketCalendar?: MarketCalendarDates
): StockTrackingMarketData {
  const daily = useKlineResource(quoteId, 'daily', 500, Boolean(quoteId), true, marketCalendar)
  const intraday = useKlineResource(
    quoteId,
    'intraday',
    undefined,
    Boolean(quoteId),
    true,
    marketCalendar
  )
  return useMemo(() => {
    const dailyBars = daily.data?.bars ?? []
    const result = intraday.data
    return {
      dailyBars,
      realtimeVolumeRatioPoints: result
        ? calculateRealtimeVolumeRatio(
            result.bars,
            dailyBars,
            result.tradingDate,
            marketFromQuoteId(quoteId ?? '')
          )
        : [],
      realtimeTradingDate: result?.tradingDate ?? '',
      realtimeIntervalMinutes: result?.intervalMinutes,
      realtimeFallbackReason: result?.fallbackReason,
      realtimeLoading: daily.loading || intraday.loading,
      realtimeError: [daily.error, intraday.error].filter(Boolean).join('；')
    }
  }, [
    daily.data,
    daily.error,
    daily.loading,
    intraday.data,
    intraday.error,
    intraday.loading,
    quoteId
  ])
}
