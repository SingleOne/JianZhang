import { describe, expect, it, vi } from 'vitest'
import type {
  DailyMarketScanResult,
  DailyMarketScanState,
  StockDesktopApi
} from '../../shared/types'
import { createDetailCenter } from './details'
import { createDailyScanCenter, EMPTY_DAILY_SCAN_STATE } from './daily-scan'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function snapshot(id: string): DailyMarketScanResult {
  return {
    schemaVersion: 1,
    tradingDate: id,
    generatedAt: `2026-11-05T${id === 'old' ? '10' : '11'}:00:00Z`,
    source: 'test',
    universeCount: 0,
    activeCount: 0,
    klineSuccessCount: 0,
    klineFailureCount: 0,
    signalCount: 0,
    rows: []
  }
}
const completed: DailyMarketScanState = {
  running: false,
  progress: { stage: 'completed', message: 'done', completed: 1, total: 1 },
  error: null
}
const running: DailyMarketScanState = {
  running: true,
  progress: { stage: 'quotes', message: 'running', completed: 0, total: 1 },
  error: null
}
function setup() {
  let current: DailyMarketScanResult | null = snapshot('old')
  let status = completed
  let listener: ((state: DailyMarketScanState) => void) | undefined
  const stop = vi.fn(() => {
    listener = undefined
  })
  const api = {
    getDailyMarketScanResult: vi.fn(async () => current),
    getDailyMarketScanState: vi.fn(async () => status),
    runDailyMarketScan: vi.fn(async () => current!),
    onDailyMarketScanProgress: vi.fn((callback: (state: DailyMarketScanState) => void) => {
      listener = callback
      return stop
    })
  }
  const details = createDetailCenter(api as unknown as StockDesktopApi)
  const scan = createDailyScanCenter(api as unknown as StockDesktopApi, details)
  return {
    api,
    scan,
    stop,
    details,
    setResult(value: DailyMarketScanResult | null) {
      current = value
    },
    emit(value: DailyMarketScanState) {
      status = value
      listener?.(value)
    },
    dispose() {
      scan.dispose()
      details.dispose()
    }
  }
}

describe('daily scan ownership', () => {
  it('keeps newer progress over delayed state initialization and reloads startup null on completed', async () => {
    const test = setup()
    const oldState = deferred<DailyMarketScanState>()
    test.setResult(null)
    test.api.getDailyMarketScanState.mockReturnValueOnce(oldState.promise)
    const release = test.scan.retain()
    const stale = expect(test.scan.state.request()).rejects.toThrow('该请求已失效')
    await expect(test.scan.result.request()).resolves.toBeNull()
    test.emit(running)
    oldState.resolve(EMPTY_DAILY_SCAN_STATE)
    await stale
    expect(test.scan.state.getSnapshot().data).toBe(running)
    test.setResult(snapshot('startup'))
    test.emit(completed)
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('startup'))
    release()
    test.dispose()
  })

  it('shares one window command and subscription, then rereads after every consumer closed', async () => {
    const test = setup()
    const task = deferred<DailyMarketScanResult>()
    test.api.runDailyMarketScan.mockReturnValueOnce(task.promise)
    const firstConsumer = test.scan.retain()
    const lastConsumer = test.scan.retain()
    const first = test.scan.run()
    expect(test.scan.run()).toBe(first)
    await Promise.resolve()
    expect(test.api.runDailyMarketScan).toHaveBeenCalledTimes(1)
    expect(test.api.onDailyMarketScanProgress).toHaveBeenCalledTimes(1)
    firstConsumer()
    expect(test.stop).not.toHaveBeenCalled()
    lastConsumer()
    expect(test.stop).toHaveBeenCalledTimes(1)
    test.setResult(snapshot('new'))
    test.emit(completed)
    task.resolve(snapshot('new'))
    await first
    const reopened = test.scan.retain()
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('new'))
    await expect(test.scan.state.request()).resolves.toBe(completed)
    expect(test.api.runDailyMarketScan).toHaveBeenCalledTimes(1)
    reopened()
    test.dispose()
  })

  it('discards result reads from before a start or terminal event', async () => {
    const test = setup()
    const old = deferred<DailyMarketScanResult | null>()
    const task = deferred<DailyMarketScanResult>()
    const release = test.scan.retain()
    await test.scan.result.request()
    test.api.getDailyMarketScanResult.mockReturnValueOnce(old.promise)
    test.api.runDailyMarketScan.mockReturnValueOnce(task.promise)
    const stale = expect(test.scan.result.request(true)).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    const command = test.scan.run()
    test.setResult(snapshot('new'))
    test.emit(completed)
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('new'))
    old.resolve(snapshot('old'))
    await stale
    task.resolve(snapshot('new'))
    await command
    await test.scan.result.request()
    expect(test.scan.result.getSnapshot().data).toEqual(snapshot('new'))
    release()
    test.dispose()
  })

  it('retains the previous successful result when a scan and subsequent read fail', async () => {
    const test = setup()
    const release = test.scan.retain()
    await test.scan.result.request()
    const previous = test.scan.result.getSnapshot().data
    test.api.runDailyMarketScan.mockRejectedValueOnce(new Error('offline'))
    test.api.getDailyMarketScanResult.mockRejectedValue(new Error('read offline'))
    await expect(test.scan.run()).rejects.toThrow('offline')
    await expect(test.scan.result.request()).rejects.toThrow('read offline')
    expect(test.scan.result.getSnapshot().data).toBe(previous)
    release()
    test.dispose()
  })

  it('does not revive cleared data from old commands or completion events, even on repeated run clicks', async () => {
    const test = setup()
    const task = deferred<DailyMarketScanResult>()
    test.api.runDailyMarketScan.mockReturnValueOnce(task.promise)
    const release = test.scan.retain()
    await test.scan.result.request()
    const command = test.scan.run()
    await Promise.resolve()
    test.scan.clear()
    expect(test.scan.run()).toBe(command)
    test.emit(completed)
    task.resolve(snapshot('old'))
    await command
    await expect(test.scan.result.request()).resolves.toBeNull()
    expect(test.scan.state.getSnapshot().data?.running ?? false).toBe(false)
    test.setResult(snapshot('explicit-new'))
    await test.scan.run()
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('explicit-new'))
    release()
    test.dispose()
  })

  it('blocks pre-clear backend data during a new command and its failure until a fresh success', async () => {
    const test = setup()
    const release = test.scan.retain()
    const keepResult = test.scan.result.retain()
    const keepState = test.scan.state.retain()
    await test.scan.result.request()
    test.scan.clear()
    await test.scan.result.request()
    const failure = deferred<DailyMarketScanResult>()
    test.api.runDailyMarketScan.mockReturnValueOnce(failure.promise)
    const failed = expect(test.scan.run()).rejects.toThrow('new scan failed')
    await expect(test.scan.result.request()).resolves.toBeNull()
    test.emit(running)
    expect(test.scan.state.getSnapshot().data?.running).toBe(true)
    failure.reject(new Error('new scan failed'))
    await failed
    await expect(test.scan.result.request()).resolves.toBeNull()
    const success = deferred<DailyMarketScanResult>()
    test.api.runDailyMarketScan.mockReturnValueOnce(success.promise)
    const command = test.scan.run()
    await expect(test.scan.result.request()).resolves.toBeNull()
    test.setResult(snapshot('after-clear'))
    test.emit(completed)
    await expect(test.scan.result.request()).resolves.toBeNull()
    success.resolve(snapshot('after-clear'))
    await command
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('after-clear'))
    keepState()
    keepResult()
    release()
    test.dispose()
  })

  it('publishes a successful run response even if the following read fails without progress events', async () => {
    const test = setup()
    await test.scan.result.request()
    test.api.runDailyMarketScan.mockResolvedValueOnce(snapshot('demo'))
    test.api.getDailyMarketScanResult.mockRejectedValue(new Error('read offline'))
    await test.scan.run()
    await expect(test.scan.result.request()).rejects.toThrow('read offline')
    expect(test.scan.result.getSnapshot().data).toEqual(snapshot('demo'))
    test.dispose()
  })

  it('keeps a newer external scan when an older command response arrives late', async () => {
    const test = setup()
    const task = deferred<DailyMarketScanResult>()
    test.api.runDailyMarketScan.mockReturnValueOnce(task.promise)
    const release = test.scan.retain()
    await test.scan.result.request()
    const command = test.scan.run()
    await Promise.resolve()
    test.emit(completed)
    test.emit(running)
    test.setResult(snapshot('external'))
    test.emit(completed)
    await test.scan.result.request()
    task.resolve(snapshot('old'))
    await command
    await test.scan.result.request()
    expect(test.scan.result.getSnapshot().data).toEqual(snapshot('external'))
    release()
    test.dispose()
  })

  it('retains a post-clear successful scan while a later external scan runs and fails', async () => {
    const test = setup()
    const task = deferred<DailyMarketScanResult>()
    const release = test.scan.retain()
    await test.scan.result.request()
    test.scan.clear()
    test.api.runDailyMarketScan.mockReturnValueOnce(task.promise)
    const command = test.scan.run()
    await Promise.resolve()
    test.setResult(snapshot('after-clear'))
    test.emit(completed)
    test.emit(running)
    task.resolve(snapshot('after-clear'))
    await command
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('after-clear'))
    expect(test.scan.state.getSnapshot().data?.running).toBe(true)
    test.emit({
      running: false,
      progress: { ...completed.progress, stage: 'failed', message: 'external failure' },
      error: 'external failure'
    })
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('after-clear'))
    expect(test.scan.state.getSnapshot().data?.error).toBe('external failure')
    release()
    test.dispose()
  })

  it('reacquires registry resources after idle LRU eviction', async () => {
    const test = setup()
    const old = test.scan.result
    await old.request()
    for (let index = 0; index < 205; index += 1) {
      const resource = test.details.resource('idle:' + index, async () => index, {
        quoteId: '',
        category: 'idle',
        maxAge: Infinity
      })
      await resource.request()
    }
    expect(test.scan.result).not.toBe(old)
    await test.scan.result.request()
    test.details.invalidate(undefined, ['daily-scan-result'])
    expect(test.scan.result.getSnapshot().data).toBeUndefined()
    test.dispose()
  })

  it('refreshes result and state after a demo command that emits no events', async () => {
    const test = setup()
    await test.scan.result.request()
    test.setResult(snapshot('demo'))
    await test.scan.run()
    await expect(test.scan.result.request()).resolves.toEqual(snapshot('demo'))
    await expect(test.scan.state.request()).resolves.toBe(completed)
    test.dispose()
  })
})
