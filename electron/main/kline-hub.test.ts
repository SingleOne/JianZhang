import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KlineAdjustment,
  KlineDateRange,
  KlinePeriod,
  KlineResult
} from '../../src/shared/types'
import { HistoricalKlineCache } from './historical-kline-cache'
import { KlineHub } from './kline-hub'

function result(quoteId: string): KlineResult {
  return {
    quoteId,
    name: quoteId,
    tradingDate: '2026-07-31',
    bars: [
      {
        time: '2026-07-31 09:30',
        open: 10,
        close: 10,
        high: 10,
        low: 10,
        volume: 100,
        amount: 1_000
      }
    ],
    intervalMinutes: 1
  }
}

describe('KlineHub', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jianzhang-kline-hub-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('evicts the least recently used live entry', async () => {
    const fetchKline = vi.fn(async (quoteId: string) => result(quoteId))
    const hub = new KlineHub(fetchKline, new HistoricalKlineCache(directory), () => [], 60_000, 2)

    await hub.get('quote-1', 'intraday', undefined, 'test')
    await hub.get('quote-2', 'intraday', undefined, 'test')
    await hub.get('quote-1', 'intraday', undefined, 'test')
    await hub.get('quote-3', 'intraday', undefined, 'test')
    await hub.get('quote-2', 'intraday', undefined, 'test')

    expect(fetchKline.mock.calls.map(([quoteId]) => quoteId)).toEqual([
      'quote-1',
      'quote-2',
      'quote-3',
      'quote-2'
    ])
  })

  it('coalesces requests with the same stock, period and limit', async () => {
    let resolveRequest: ((value: KlineResult) => void) | undefined
    const fetchKline = vi.fn(
      () =>
        new Promise<KlineResult>((resolve) => {
          resolveRequest = resolve
        })
    )
    const hub = new KlineHub(fetchKline, new HistoricalKlineCache(directory), () => [], 60_000)

    const first = hub.get('quote-1', 'intraday', undefined, 'first')
    const second = hub.get('quote-1', 'intraday', undefined, 'second')
    await vi.waitFor(() => expect(fetchKline).toHaveBeenCalledTimes(1))
    resolveRequest?.(result('quote-1'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      result('quote-1'),
      result('quote-1')
    ])
    expect(first).toBe(second)
  })

  it('requests only the specified completed daily range', async () => {
    const fetchKline = vi.fn(async (quoteId: string) => result(quoteId))
    const hub = new KlineHub(fetchKline, new HistoricalKlineCache(directory), () => [], 60_000)
    const dateRange = { startDate: '2026-07-29', endDate: '2026-07-31' }

    await hub.getDailyRange('1.600000', dateRange, 'tracking:test')

    expect(fetchKline).toHaveBeenCalledWith('1.600000', 'daily', 3, 'tracking:test', dateRange)
  })

  it('coalesces only matching adjustments and caches each mode separately', async () => {
    const fetchKline = vi.fn(
      async (
        quoteId: string,
        _period: KlinePeriod,
        _limit: number | undefined,
        _caller: string,
        _range?: KlineDateRange,
        adjustment: KlineAdjustment = 'forward'
      ) => ({
        ...result(quoteId),
        adjustment,
        bars: [{ ...result(quoteId).bars[0], turnoverRate: 1 }]
      })
    )
    const hub = new KlineHub(fetchKline, new HistoricalKlineCache(directory), () => [], 60_000)

    const forward = hub.get('1.600000', 'daily', 120, 'first')
    const forwardAgain = hub.get('1.600000', 'daily', 120, 'second', 'forward')
    const backward = hub.get('1.600000', 'daily', 120, 'third', 'backward')
    const unadjusted = hub.get('1.600000', 'daily', 120, 'fourth', 'none')
    expect(forwardAgain).toBe(forward)
    expect(backward).not.toBe(forward)
    await expect(Promise.all([forward, backward, unadjusted])).resolves.toMatchObject([
      { adjustment: 'forward' },
      { adjustment: 'backward' },
      { adjustment: 'none' }
    ])

    for (const adjustment of ['forward', 'backward', 'none'] as const) {
      await expect(hub.get('1.600000', 'daily', 120, 'cached', adjustment)).resolves.toMatchObject({
        adjustment,
        fromCache: true
      })
    }
    expect(fetchKline).toHaveBeenCalledTimes(3)
  })

  it('does not use another adjustment as a fallback after a request fails', async () => {
    const cache = new HistoricalKlineCache(directory)
    cache.save('1.600000', 'daily', 120, result('1.600000'))
    const fetchKline = vi.fn().mockRejectedValue(new Error('network unavailable'))
    const hub = new KlineHub(fetchKline, cache, () => [], 60_000)

    await expect(hub.get('1.600000', 'daily', 120, 'test', 'backward')).rejects.toThrow(
      'network unavailable'
    )
  })

  it('keeps different network requests in the global serial queue', async () => {
    const started: string[] = []
    const resolvers = new Map<string, (value: KlineResult) => void>()
    const fetchKline = vi.fn(
      (quoteId: string, _period: KlinePeriod) =>
        new Promise<KlineResult>((resolve) => {
          started.push(quoteId)
          resolvers.set(quoteId, resolve)
        })
    )
    const hub = new KlineHub(fetchKline, new HistoricalKlineCache(directory), () => [], 60_000)

    const first = hub.get('quote-1', 'intraday', undefined, 'first')
    const second = hub.get('quote-2', 'intraday', undefined, 'second')
    await vi.waitFor(() => expect(started).toEqual(['quote-1']))
    resolvers.get('quote-1')?.(result('quote-1'))
    await first
    await vi.waitFor(() => expect(started).toEqual(['quote-1', 'quote-2']))
    resolvers.get('quote-2')?.(result('quote-2'))
    await second
  })
})
