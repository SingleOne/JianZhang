import { describe, expect, it, vi } from 'vitest'
import type { AppCompletionNotification, StockDesktopApi } from '../../shared/types'
import { createDetailCenter } from './details'
import { createCompletionNotifications } from './completion-notifications'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function notification(id: string, second = 1): AppCompletionNotification {
  return {
    id,
    quoteId: '1.600001',
    target: 'reports',
    message: id,
    createdAt: `2026-11-05T08:00:${String(second).padStart(2, '0')}Z`
  }
}
function setup() {
  let saved: AppCompletionNotification[] = []
  let receive: ((item: AppCompletionNotification) => void) | undefined
  const stop = vi.fn(() => {
    receive = undefined
  })
  const subscribe = vi.fn((callback: (item: AppCompletionNotification) => void) => {
    receive = callback
    return stop
  })
  const api = {
    getCompletionNotifications: vi.fn(async () => saved),
    saveCompletionNotifications: vi.fn(async (items: AppCompletionNotification[]) => {
      saved = items
      return items
    })
  }
  const transport = api as unknown as StockDesktopApi
  const details = createDetailCenter(transport)
  const notifications = createCompletionNotifications(transport, details, subscribe)
  return {
    api,
    details,
    notifications,
    subscribe,
    stop,
    emit: (item: AppCompletionNotification) => receive?.(item),
    saved: () => saved,
    dispose() {
      notifications.dispose()
      details.dispose()
    }
  }
}

describe('completion notification ownership', () => {
  it('merges new events and dismissals over delayed initialization, without duplicate subscriptions', async () => {
    const test = setup()
    const initial = deferred<AppCompletionNotification[]>()
    test.api.getCompletionNotifications.mockReturnValueOnce(initial.promise)
    const first = test.notifications.retain()
    const last = test.notifications.retain()
    test.emit(notification('new', 3))
    const dismissed = test.notifications.dismiss('removed')
    initial.resolve([notification('removed', 2), notification('saved')])
    await dismissed
    expect(test.notifications.resource.getSnapshot().data?.map((item) => item.id)).toEqual([
      'new',
      'saved'
    ])
    expect(test.saved().map((item) => item.id)).toEqual(['new', 'saved'])
    expect(test.subscribe).toHaveBeenCalledTimes(1)
    first()
    expect(test.stop).not.toHaveBeenCalled()
    last()
    expect(test.stop).toHaveBeenCalledTimes(1)
    const reopen = test.notifications.retain()
    await test.notifications.resource.request()
    expect(test.api.getCompletionNotifications).toHaveBeenCalledTimes(2)
    reopen()
    test.dispose()
  })

  it('serializes latest-list saves and never publishes a late older normalized response over a new event', async () => {
    const test = setup()
    await test.notifications.resource.request()
    const firstSave = deferred<AppCompletionNotification[]>()
    const started = deferred<void>()
    test.api.saveCompletionNotifications.mockImplementationOnce(() => {
      started.resolve()
      return firstSave.promise
    })
    test.notifications.add(notification('A'))
    await started.promise
    test.notifications.add(notification('B', 2))
    const drained = test.notifications.dismiss('absent')
    firstSave.resolve([notification('A')])
    await drained
    expect(test.notifications.resource.getSnapshot().data?.map((item) => item.id)).toEqual([
      'B',
      'A'
    ])
    expect(test.api.saveCompletionNotifications.mock.calls[1][0].map((item) => item.id)).toEqual([
      'B',
      'A'
    ])
    expect(test.saved().map((item) => item.id)).toEqual(['B', 'A'])
    test.dispose()
  })

  it('preserves replacement semantics while an unknown initial saved list is still loading', async () => {
    const test = setup()
    const initial = deferred<AppCompletionNotification[]>()
    test.api.getCompletionNotifications.mockReturnValueOnce(initial.promise)
    const stale = expect(test.notifications.resource.request()).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    const replaced = test.notifications.replace([notification('replacement')])
    initial.resolve([notification('unknown-saved')])
    await replaced
    await stale
    expect(test.saved().map((item) => item.id)).toEqual(['replacement'])
    expect(test.notifications.resource.getSnapshot().data?.map((item) => item.id)).toEqual([
      'replacement'
    ])
    test.dispose()
  })

  it('does not overwrite unknown disk notifications after initialization fails, then merges and retries', async () => {
    const test = setup()
    const initial = deferred<AppCompletionNotification[]>()
    test.api.getCompletionNotifications.mockReturnValueOnce(initial.promise)
    test.notifications.add(notification('new', 3))
    const rejected = expect(test.notifications.dismiss('absent')).rejects.toThrow('read offline')
    initial.reject(new Error('read offline'))
    await rejected
    expect(test.api.saveCompletionNotifications).not.toHaveBeenCalled()
    expect(test.notifications.resource.getSnapshot().data).toEqual([notification('new', 3)])
    expect(test.notifications.resource.getSnapshot().error).toBe('read offline')
    test.api.getCompletionNotifications.mockResolvedValueOnce([notification('saved')])
    await expect(test.notifications.get()).resolves.toEqual([
      notification('new', 3),
      notification('saved')
    ])
    expect(test.saved().map((item) => item.id)).toEqual(['new', 'saved'])
    test.dispose()
  })

  it('keeps failed writes and dismissals in memory through reads and LRU pressure, then retries on re-entry', async () => {
    const test = setup()
    await test.notifications.replace([notification('remove'), notification('keep', 2)])
    test.api.saveCompletionNotifications.mockRejectedValueOnce(new Error('disk offline'))
    await expect(test.notifications.dismiss('remove')).rejects.toThrow('disk offline')
    const resource = test.notifications.resource
    expect(resource.getSnapshot().error).toBe('disk offline')
    await resource.request(true)
    expect(resource.getSnapshot().data?.map((item) => item.id)).toEqual(['keep'])
    for (let index = 0; index < 205; index += 1) {
      await test.details
        .resource(`idle:${index}`, async () => index, {
          quoteId: '',
          category: 'idle',
          maxAge: Infinity
        })
        .request()
    }
    expect(test.notifications.resource).toBe(resource)
    const retried = deferred<void>()
    test.api.saveCompletionNotifications.mockImplementationOnce(async (items) => {
      retried.resolve()
      return items
    })
    const release = test.notifications.retain()
    await retried.promise
    await test.notifications.dismiss('absent')
    expect(test.notifications.resource.getSnapshot().error).toBe('')
    expect(test.saved().map((item) => item.id)).toEqual(['keep'])
    release()
    test.dispose()
  })

  it('keeps a successful get readable after retry failure and returns events received during a later retry', async () => {
    const test = setup()
    test.api.saveCompletionNotifications.mockRejectedValueOnce(new Error('disk offline'))
    await expect(test.notifications.replace([notification('A')])).rejects.toThrow('disk offline')
    test.api.saveCompletionNotifications.mockRejectedValueOnce(new Error('disk still offline'))
    await expect(test.notifications.get()).resolves.toEqual([notification('A')])
    expect(test.notifications.resource.getSnapshot().error).toBe('disk still offline')
    const pending = deferred<AppCompletionNotification[]>()
    const started = deferred<void>()
    test.api.saveCompletionNotifications.mockImplementationOnce(() => {
      started.resolve()
      return pending.promise
    })
    const read = test.notifications.get()
    await started.promise
    test.notifications.add(notification('B', 2))
    pending.resolve([notification('A')])
    await expect(read).resolves.toEqual([notification('B', 2), notification('A')])
    await test.notifications.dismiss('absent')
    expect(test.saved().map((item) => item.id)).toEqual(['B', 'A'])
    test.dispose()
  })

  it('allows an explicit same-id event after dismissal and normalizes order, duplicates and the 100-item cap', async () => {
    const test = setup()
    await test.notifications.replace([notification('same')])
    await test.notifications.dismiss('same')
    test.notifications.add(notification('same', 3))
    await test.notifications.dismiss('absent')
    expect(test.notifications.resource.getSnapshot().data).toEqual([notification('same', 3)])
    const items = Array.from({ length: 105 }, (_, index) => ({
      ...notification(String(index)),
      createdAt: new Date(Date.UTC(2026, 10, 5, 8, 0, index)).toISOString()
    }))
    await test.notifications.replace([items[104], ...items])
    const saved = test.notifications.resource.getSnapshot().data!
    expect(saved).toHaveLength(100)
    expect(saved[0].id).toBe('104')
    expect(new Set(saved.map((item) => item.id)).size).toBe(100)
    await test.notifications.replace([])
    expect(test.notifications.resource.getSnapshot().data).toEqual([])
    test.dispose()
  })
})
