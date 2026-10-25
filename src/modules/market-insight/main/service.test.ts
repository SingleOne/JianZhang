import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState, type WatchStock } from '../../../shared/types'
import type { MarketNewsItem } from '../shared/types'
import { MarketNewsRegistry } from './news/registry'
import type { MarketNewsProvider } from './news/types'
import { MarketInsightService } from './service'
import { MarketInsightStorage } from './storage'

function stock(code: string, isPriority = false): WatchStock {
  return {
    code,
    name: `股票${code}`,
    quoteId: `0.${code}`,
    marketLabel: '深A',
    showInTaskbar: false,
    isPriority,
    showRadarSignals: true,
    groupIds: [],
    positionSnapshots: [],
    alertRules: []
  }
}

function announcement(id: string, quoteId = '0.000876'): MarketNewsItem {
  return {
    id,
    title: id,
    source: '巨潮资讯',
    publishedAt: '2026-10-22T08:00:00.000Z',
    url: `https://example.com/${id}`,
    category: 'announcement',
    scope: 'stock',
    relatedQuoteIds: [quoteId],
    fetchedAt: '2026-10-23T08:00:00.000Z'
  }
}

let directory: string
let service: MarketInsightService | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jianzhang-news-'))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T08:00:00.000Z'))
})

afterEach(() => {
  service?.dispose()
  service = undefined
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

function setup(watchlist: WatchStock[], load: MarketNewsProvider['fetchStockNews']) {
  const storage = new MarketInsightStorage(directory)
  const state: AppState = {
    watchlist,
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [],
    columnOrderVersion: 1,
    stockTradingBooks: {},
    corporateActionApplications: {},
    portfolioPerformanceAdjustments: {}
  }
  const provider: MarketNewsProvider = {
    id: 'cninfo-announcement',
    name: '巨潮资讯',
    fetchStockNews: load,
    fetchSectorNews: async () => [],
    fetchMarketNews: async () => []
  }
  const onUpdated = vi.fn()
  service = new MarketInsightService(storage, new MarketNewsRegistry([provider]), {
    getState: () => state,
    getKline: vi.fn(),
    getOrderBook: vi.fn(),
    getFundsFlow: vi.fn(),
    onUpdated
  })
  return { service, storage, onUpdated }
}

describe('scheduled market news', () => {
  it('retains the cache and retries failed regular stocks before marking the day complete', async () => {
    const existing = new MarketInsightStorage(directory)
    const cached = [announcement('cached')]
    existing.saveNews('0.000876', cached, 12)
    const load = vi
      .fn<MarketNewsProvider['fetchStockNews']>()
      .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
      .mockResolvedValue([announcement('updated')])
    const { service: current, storage, onUpdated } = setup([stock('000876')], load)

    await vi.advanceTimersByTimeAsync(0)
    expect(storage.loadNews('0.000876')).toEqual(cached)
    expect(storage.loadRegularNewsQueryDates()).toEqual({})
    expect(current.getStatus().newsMessage).toContain('将自动重试')
    expect(onUpdated).toHaveBeenCalledWith('0.000876')

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(storage.loadNews('0.000876').map((item) => item.id)).toEqual(['updated'])
    expect(storage.loadRegularNewsQueryDates()).toEqual({ '0.000876': '2026-10-23' })
    expect(current.getStatus().newsMessage).toBe('新闻源已就绪')

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('summarizes the same failure across seven stocks once', async () => {
    const load = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const { service: current } = setup(
      Array.from({ length: 7 }, (_, index) => stock(`00000${index}`, true)),
      load
    )

    await vi.advanceTimersByTimeAsync(0)

    expect(load).toHaveBeenCalledTimes(7)
    expect(current.getStatus().newsMessage).toBe('新闻来源刷新失败，将自动重试。巨潮资讯：请求超时')
  })

  it('does not let another stock succeeding erase an outstanding failure', async () => {
    const load = vi.fn<MarketNewsProvider['fetchStockNews']>(async (query) => {
      if (query.code === '000876') throw new Error('network connection failed')
      return []
    })
    const { service: current, storage } = setup([stock('000876'), stock('000798')], load)

    await vi.advanceTimersByTimeAsync(0)

    expect(current.getStatus().newsMessage).toBe(
      '部分新闻来源刷新失败，将自动重试。巨潮资讯：网络连接失败'
    )
    expect(storage.loadRegularNewsQueryDates()).toEqual({ '0.000798': '2026-10-23' })
  })

  it('does not start overlapping scheduled batches while a source is still pending', async () => {
    let finish!: (items: MarketNewsItem[]) => void
    const load = vi.fn(
      () =>
        new Promise<MarketNewsItem[]>((resolve) => {
          finish = resolve
        })
    )
    const { storage } = setup([stock('000876')], load)

    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(storage.loadRegularNewsQueryDates()).toEqual({})
    finish([])
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.loadRegularNewsQueryDates()).toEqual({ '0.000876': '2026-10-23' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
