import { useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import {
  calculateRealtimeVolumeRatio,
  type RealtimeVolumeRatioPoint
} from '../lib/stock-tracking-metrics'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  isMarketOpen,
  millisecondsUntilNextMarketOpen
} from '../shared/market-hours'
import { marketFromQuoteId } from '../shared/stock-market'
import type { KlineBar, KlineResult } from '../shared/types'

export interface StockTrackingMarketData {
  dailyBars: KlineBar[]
  realtimeVolumeRatioPoints: RealtimeVolumeRatioPoint[]
  realtimeTradingDate: string
  realtimeIntervalMinutes?: 1 | 5
  realtimeFallbackReason?: string
  realtimeLoading: boolean
  realtimeError: string
}

interface MarketDataState {
  quoteId: string
  daily: KlineResult | null
  intraday: KlineResult | null
  loading: boolean
  error: string
}

const EMPTY_STATE: MarketDataState = {
  quoteId: '',
  daily: null,
  intraday: null,
  loading: false,
  error: ''
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function useStockTrackingMarketData(quoteId?: string): StockTrackingMarketData {
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [state, setState] = useState<MarketDataState>(EMPTY_STATE)

  useEffect(() => {
    if (!quoteId) return
    const market = marketFromQuoteId(quoteId)
    let active = true
    let refreshTimer: number | undefined

    const scheduleRefresh = () => {
      refreshTimer = window.setTimeout(
        () => {
          if (isMarketOpen(market)) {
            setRefreshVersion((current) => current + 1)
          } else {
            scheduleRefresh()
          }
        },
        isMarketOpen(market)
          ? INTRADAY_REFRESH_MILLISECONDS
          : millisecondsUntilNextMarketOpen(market)
      )
    }

    setState((current) => ({
      quoteId,
      daily: current.quoteId === quoteId ? current.daily : null,
      intraday: current.quoteId === quoteId ? current.intraday : null,
      loading: true,
      error: ''
    }))

    void Promise.allSettled([
      stockApi.getKline(quoteId, 'daily', 500),
      stockApi.getKline(quoteId, 'intraday')
    ]).then(([dailyResult, intradayResult]) => {
      if (!active) return
      const errors: string[] = []
      if (dailyResult.status === 'rejected') {
        errors.push(errorMessage(dailyResult.reason, '近5日成交量加载失败'))
      }
      if (intradayResult.status === 'rejected') {
        errors.push(errorMessage(intradayResult.reason, '实时分时数据加载失败'))
      }
      setState((current) => ({
        quoteId,
        daily: dailyResult.status === 'fulfilled' ? dailyResult.value : current.daily,
        intraday: intradayResult.status === 'fulfilled' ? intradayResult.value : current.intraday,
        loading: false,
        error: errors.join('；')
      }))
      scheduleRefresh()
    })

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [quoteId, refreshVersion])

  const currentState = state.quoteId === quoteId ? state : EMPTY_STATE
  return useMemo(() => {
    const dailyBars = currentState.daily?.bars ?? []
    const intraday = currentState.intraday
    const realtimeVolumeRatioPoints = intraday
      ? calculateRealtimeVolumeRatio(
          intraday.bars,
          dailyBars,
          intraday.tradingDate,
          marketFromQuoteId(quoteId ?? '')
        )
      : []
    return {
      dailyBars,
      realtimeVolumeRatioPoints,
      realtimeTradingDate: intraday?.tradingDate ?? '',
      realtimeIntervalMinutes: intraday?.intervalMinutes,
      realtimeFallbackReason: intraday?.fallbackReason,
      realtimeLoading: currentState.loading,
      realtimeError: currentState.error
    }
  }, [currentState, quoteId])
}
