import type { KlinePeriod, StockDesktopApi } from '../../shared/types'
import {
  INTRADAY_REFRESH_MILLISECONDS,
  FUNDS_FLOW_REFRESH_MILLISECONDS
} from '../../shared/market-hours'
import { createResourceCache } from './resource'

export function createDetailCenter(transport: StockDesktopApi) {
  const cache = createResourceCache()
  const kline = (quoteId: string, period: KlinePeriod, limit?: number) =>
    cache.get(
      JSON.stringify(['kline', quoteId, period, limit ?? null]),
      () => transport.getKline(quoteId, period, limit),
      {
        quoteId,
        category: 'klines',
        maxAge:
          period === 'intraday' || period === 'fiveDay'
            ? INTRADAY_REFRESH_MILLISECONDS
            : 5 * 60 * 1000,
        validate: (next, previous) => {
          if (
            period === 'intraday' &&
            next.intervalMinutes === 5 &&
            previous &&
            previous.intervalMinutes !== 5
          ) {
            throw new Error(next.fallbackReason || '1分钟分时数据刷新失败')
          }
        }
      }
    )
  const fundsFlow = (quoteId: string) =>
    cache.get(JSON.stringify(['funds', quoteId]), () => transport.getFundsFlow(quoteId), {
      quoteId,
      category: 'market-details',
      maxAge: FUNDS_FLOW_REFRESH_MILLISECONDS
    })
  const sector = (quoteId: string) =>
    cache.get(JSON.stringify(['sector', quoteId]), () => transport.getSectorIndex(quoteId), {
      quoteId,
      category: 'market-details',
      maxAge: INTRADAY_REFRESH_MILLISECONDS
    })
  const orderBook = (quoteId: string) =>
    cache.get(JSON.stringify(['orders', quoteId]), () => transport.getOrderBook(quoteId), {
      quoteId,
      category: 'market-details',
      maxAge: 750,
      warning: (data) => data.refreshError ?? ''
    })
  const shareholders = (quoteId: string) =>
    cache.get(
      JSON.stringify(['shareholders', quoteId]),
      (force) => transport.getShareholderSnapshot(quoteId, force),
      { quoteId, category: 'shareholders', maxAge: 5 * 60 * 1000 }
    )
  const reports = (quoteId: string) =>
    cache.get(
      JSON.stringify(['reports', quoteId]),
      (force) => transport.getCompanyReports(quoteId, force),
      { quoteId, category: 'company-reports', maxAge: Infinity }
    )
  const fundamentals = (quoteId: string) =>
    cache.get(
      JSON.stringify(['fundamentals', quoteId]),
      (force) => transport.getGlobalFundamentals(quoteId, force),
      { quoteId, category: 'company-reports', maxAge: Infinity }
    )
  const valuations = (quoteId: string) =>
    cache.get(
      JSON.stringify(['valuations', quoteId]),
      () => transport.getValuationHistory(quoteId),
      { quoteId, category: 'valuations', maxAge: 5 * 60 * 1000 }
    )
  const corporateActions = (quoteId: string) =>
    cache.get(
      JSON.stringify(['corporateActions', quoteId]),
      (force) => transport.listCorporateActions(quoteId, force),
      { quoteId, category: 'corporate-actions', maxAge: 5 * 60 * 1000 }
    )
  const trackingArchive = (quoteId: string, cycleId: string) =>
    cache.get(
      JSON.stringify(['archive', quoteId, cycleId]),
      () => transport.getStockTrackingArchiveCycle(quoteId, cycleId),
      { quoteId, category: 'tracking-archives', maxAge: Infinity }
    )
  return {
    resource: cache.get,
    kline,
    fundsFlow,
    sector,
    orderBook,
    shareholders,
    reports,
    fundamentals,
    valuations,
    corporateActions,
    trackingArchive,
    invalidate: cache.invalidate,
    dispose: cache.dispose
  }
}
