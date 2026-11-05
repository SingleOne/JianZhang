import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResourceCache } from './resource'

const options = { quoteId: 'A', category: 'klines', maxAge: 1000 }
const demand = (interval: number) => ({ interval, canRefresh: () => true, nextWindow: () => 1000 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('detail resources', () => {
  it('reloads invalidated infinite-TTL data while preserving its successful timestamp on failure', async () => {
    const cache = createResourceCache()
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(2)
    const resource = cache.get('A', load, { ...options, maxAge: Infinity })
    await resource.request()
    const updatedAt = resource.getSnapshot().updatedAt
    cache.invalidate(undefined, ['klines'], true)
    expect(resource.getSnapshot().data).toBe(1)
    expect(resource.getSnapshot().updatedAt).toBe(updatedAt)
    await expect(resource.request()).rejects.toThrow('offline')
    expect(resource.getSnapshot()).toEqual({ data: 1, loading: false, error: 'offline', updatedAt })
    await expect(resource.request()).resolves.toBe(2)
    cache.dispose()
  })

  it('retires both an old read and its queued force refresh when preserving data', async () => {
    const cache = createResourceCache()
    const old = deferred<number>()
    const load = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(3)
    const resource = cache.get('A', load, { ...options, maxAge: Infinity })
    resource.update(1)
    resource.invalidate(true)
    const first = resource.request()
    const forced = resource.request(true)
    const rejected = expect(first).rejects.toThrow('该请求已失效')
    const forcedRejected = expect(forced).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    resource.invalidate(true)
    await expect(resource.request()).resolves.toBe(3)
    old.resolve(2)
    await rejected
    await forcedRejected
    expect(load).toHaveBeenCalledTimes(2)
    expect(resource.getSnapshot().data).toBe(3)
    cache.dispose()
  })

  it('shares requests and fresh snapshots for the same key, while isolating other keys', async () => {
    const cache = createResourceCache()
    const pending = deferred<number>()
    const load = vi.fn(() => pending.promise)
    const first = cache.get('A:daily:500', load, options)
    expect(cache.get('A:daily:500', load, options)).toBe(first)
    expect(cache.get('A:daily:1000', load, options)).not.toBe(first)
    expect(cache.get('B:daily:500', load, { ...options, quoteId: 'B' })).not.toBe(first)
    const request = first.request()
    expect(first.request()).toBe(request)
    pending.resolve(42)
    await request
    const snapshot = first.getSnapshot()
    await expect(first.request()).resolves.toBe(42)
    expect(first.getSnapshot()).toBe(snapshot)
    expect(load).toHaveBeenCalledTimes(1)
    cache.dispose()
  })

  it('queues one forced transport refresh behind an ordinary in-flight read', async () => {
    const cache = createResourceCache()
    const pending = deferred<number>()
    const load = vi
      .fn<(force: boolean) => Promise<number>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(2)
    const resource = cache.get('A', load, options)
    const ordinary = resource.request()
    const forced = resource.request(true)
    expect(resource.request(true)).toBe(forced)
    pending.resolve(1)
    await expect(ordinary).resolves.toBe(1)
    await expect(forced).resolves.toBe(2)
    expect(load.mock.calls).toEqual([[false], [true]])
    expect(resource.getSnapshot().data).toBe(2)
    cache.dispose()
  })

  it('keeps the previous data when a stale-cache refresh fails', async () => {
    vi.useFakeTimers()
    const cache = createResourceCache()
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('offline'))
    const resource = cache.get('A', load, options)
    await resource.request()
    const updatedAt = resource.getSnapshot().updatedAt
    await vi.advanceTimersByTimeAsync(1001)
    await expect(resource.request()).rejects.toThrow('offline')
    expect(resource.getSnapshot()).toEqual({ data: 1, loading: false, error: 'offline', updatedAt })
    cache.dispose()
  })

  it('ignores a late result after invalidation and lets the new request win', async () => {
    const cache = createResourceCache()
    const old = deferred<number>()
    const load = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(2)
    const resource = cache.get('A', load, options)
    const first = resource.request()
    const rejected = expect(first).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    resource.invalidate()
    await expect(resource.request()).resolves.toBe(2)
    old.resolve(1)
    await rejected
    expect(resource.getSnapshot().data).toBe(2)
    cache.dispose()
  })

  it('combines refresh demands and stops refreshing when the last consumer leaves', async () => {
    vi.useFakeTimers()
    const cache = createResourceCache()
    const load = vi.fn().mockResolvedValue(1)
    const resource = cache.get('A', load, options)
    await resource.request()
    const releaseSlow = resource.retain(demand(200))
    const releaseFast = resource.retain(demand(50))
    await vi.advanceTimersByTimeAsync(50)
    expect(load).toHaveBeenCalledTimes(2)
    releaseFast()
    await vi.advanceTimersByTimeAsync(199)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(3)
    releaseSlow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    cache.dispose()
  })

  it('waits for an allowed refresh window', async () => {
    vi.useFakeTimers()
    const cache = createResourceCache()
    const load = vi.fn().mockResolvedValue(1)
    const resource = cache.get('A', load, options)
    await resource.request()
    let open = false
    const release = resource.retain({ interval: 50, canRefresh: () => open, nextWindow: () => 500 })
    await vi.advanceTimersByTimeAsync(499)
    expect(load).toHaveBeenCalledTimes(1)
    open = true
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    release()
    cache.dispose()
  })

  it('does not restart timers when a disposed center receives a late response', async () => {
    vi.useFakeTimers()
    const cache = createResourceCache()
    const pending = deferred<number>()
    const resource = cache.get('A', () => pending.promise, options)
    resource.retain(demand(50))
    const request = resource.request()
    const rejected = expect(request).rejects.toThrow('该请求已失效')
    cache.dispose()
    pending.resolve(1)
    await rejected
    expect(resource.getSnapshot().data).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates only matching resources even if subscribers touch the registry', async () => {
    const cache = createResourceCache()
    const load = vi.fn().mockResolvedValue(1)
    const a = cache.get('A', load, options)
    const b = cache.get('B', load, { ...options, quoteId: 'B' })
    await Promise.all([a.request(), b.request()])
    const unsubscribe = a.subscribe(() => {
      cache.get('A', load, options)
    })
    cache.invalidate('A', ['shareholders'])
    expect(a.getSnapshot().data).toBe(1)
    cache.invalidate('A', ['klines'])
    expect(a.getSnapshot().data).toBeUndefined()
    expect(b.getSnapshot().data).toBe(1)
    unsubscribe()
    cache.dispose()
  })

  it('evicts inactive cache entries while retaining subscribed resources', async () => {
    const cache = createResourceCache(1)
    const load = vi.fn().mockResolvedValue(1)
    const active = cache.get('A', load, options)
    const unsubscribe = active.subscribe(() => undefined)
    await active.request()
    const idle = cache.get('B', load, options)
    await idle.request()
    expect(cache.get('A', load, options)).toBe(active)
    expect(cache.get('B', load, options)).not.toBe(idle)
    unsubscribe()
    cache.dispose()
  })
})
