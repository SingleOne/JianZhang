import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyMarketScanResult, KlineResult } from '../../src/shared/types'
import { DailyMarketScanService } from './daily-market-scan-service'
import type { HistoricalKlineCache } from './historical-kline-cache'
import type { DailyMarketActiveQuotesResult } from './market'

const disk = vi.hoisted(() => ({ readFile: vi.fn<() => Promise<string>>() }))
vi.mock('node:fs/promises', () => ({ readFile: disk.readFile }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const market: DailyMarketActiveQuotesResult = { quotes: [], source: 'test', universeCount: 0 }

describe('daily scan cache clearing', () => {
  let directory: string
  let snapshotPath: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jianzhang-daily-scan-'))
    snapshotPath = join(directory, 'daily-market-scan', 'latest.json')
    disk.readFile.mockReset()
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function setup() {
    const fetchActiveQuotes = vi.fn(async () => market)
    const fetchKline = vi.fn<() => Promise<KlineResult>>()
    const notifyState = vi.fn()
    const service = new DailyMarketScanService({
      userDataDirectory: directory,
      historicalKlineCache: {
        get: () => null,
        shouldKeepFallback: () => true
      } as unknown as HistoricalKlineCache,
      getClosedDates: () => [],
      fetchActiveQuotes,
      fetchKline,
      notifyState
    })
    return { service, fetchActiveQuotes, fetchKline, notifyState }
  }

  it('suppresses late kline progress and snapshot writes after clearing', async () => {
    const test = setup()
    const kline = deferred<KlineResult>()
    const started = deferred<void>()
    test.fetchKline.mockImplementationOnce(() => {
      started.resolve()
      return kline.promise
    })
    test.fetchActiveQuotes.mockResolvedValueOnce({
      ...market,
      quotes: [
        {
          quoteId: '1.600001',
          code: '600001',
          name: '测试',
          tradingDate: '',
          latest: 10,
          change: 0,
          changePercent: 0,
          open: 10,
          high: 10,
          low: 10,
          previousClose: 10,
          volume: 100,
          amount: 1000,
          turnoverRate: 1,
          updatedAt: ''
        }
      ]
    })
    const task = test.service.run()
    const rejected = expect(task).rejects.toThrow('扫描已因缓存清理失效')
    await started.promise
    test.service.clearForCache()
    test.notifyState.mockClear()
    kline.resolve({ quoteId: '1.600001', name: '测试', tradingDate: '', bars: [] })
    await rejected
    expect(test.notifyState).not.toHaveBeenCalled()
    expect(test.service.getResult()).toBeNull()
    expect(existsSync(snapshotPath)).toBe(false)
  })

  it('writes the original atomic snapshot format and retains it after a normal failure', async () => {
    const test = setup()
    const result = await test.service.run()
    expect(JSON.parse(readFileSync(snapshotPath, 'utf8'))).toEqual(result)
    expect(existsSync(join(directory, 'daily-market-scan', 'latest.next.json'))).toBe(false)
    test.fetchActiveQuotes.mockRejectedValueOnce(new Error('offline'))
    await expect(test.service.run()).rejects.toThrow('offline')
    expect(test.service.getResult()).toBe(result)
  })

  it.each(['resolve', 'reject'] as const)(
    'does not recreate deleted snapshots or emit a terminal state after an old scan %ss',
    async (outcome) => {
      const test = setup()
      await test.service.run()
      const quotes = deferred<DailyMarketActiveQuotesResult>()
      test.fetchActiveQuotes.mockReturnValueOnce(quotes.promise)
      const task = test.service.run()
      const rejected = expect(task).rejects.toThrow('扫描已因缓存清理失效')
      test.service.clearForCache()
      expect(test.service.run()).toBe(task)
      expect(test.fetchActiveQuotes).toHaveBeenCalledTimes(2)
      rmSync(join(directory, 'daily-market-scan'), { recursive: true })
      test.notifyState.mockClear()
      if (outcome === 'resolve') quotes.resolve(market)
      else quotes.reject(new Error('late failure'))
      await rejected
      expect(existsSync(snapshotPath)).toBe(false)
      expect(test.service.getResult()).toBeNull()
      expect(test.service.getState().progress.stage).toBe('idle')
      expect(test.notifyState).not.toHaveBeenCalled()
      await test.service.run()
      expect(test.fetchActiveQuotes).toHaveBeenCalledTimes(3)
      expect(existsSync(snapshotPath)).toBe(true)
    }
  )

  it.each([false, true])(
    'ignores delayed disk initialization after clearing (queued run: %s)',
    async (queuedRun) => {
      const previous: DailyMarketScanResult = {
        schemaVersion: 1,
        tradingDate: '2026-11-05',
        generatedAt: '2026-11-05T08:00:00Z',
        source: 'test',
        universeCount: 0,
        activeCount: 0,
        klineSuccessCount: 0,
        klineFailureCount: 0,
        signalCount: 0,
        rows: []
      }
      mkdirSync(join(directory, 'daily-market-scan'))
      writeFileSync(snapshotPath, JSON.stringify(previous))
      const loaded = deferred<string>()
      disk.readFile.mockReturnValueOnce(loaded.promise)
      const test = setup()
      const task = queuedRun ? test.service.run() : undefined
      const rejected = task ? expect(task).rejects.toThrow('扫描已因缓存清理失效') : undefined
      test.service.clearForCache()
      rmSync(join(directory, 'daily-market-scan'), { recursive: true })
      test.notifyState.mockClear()
      loaded.resolve(JSON.stringify(previous))
      await loaded.promise
      await rejected
      expect(test.service.getResult()).toBeNull()
      expect(test.service.getState().progress.stage).toBe('idle')
      expect(test.notifyState).not.toHaveBeenCalled()
      expect(test.fetchActiveQuotes).not.toHaveBeenCalled()
      expect(existsSync(snapshotPath)).toBe(false)
    }
  )
})
