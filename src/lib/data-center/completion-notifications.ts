import type { AppCompletionNotification, StockDesktopApi } from '../../shared/types'
import { subscribeCompletionNotifications } from '../completion-notifications'
import type { createDetailCenter } from './details'

type Subscribe = typeof subscribeCompletionNotifications

function normalize(items: AppCompletionNotification[]) {
  const ids = new Set<string>()
  return items
    .filter((item) => {
      if (ids.has(item.id)) return false
      ids.add(item.id)
      return true
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 100)
}

/** Window event input and ordered persistence share the same formal list. */
export function createCompletionNotifications(
  transport: StockDesktopApi,
  details: ReturnType<typeof createDetailCenter>,
  subscribe: Subscribe = subscribeCompletionNotifications
) {
  const dismissed = new Set<string>()
  let revision = 0
  let initialized = false
  let dirty = false
  let releaseDirty: (() => void) | undefined
  let replacement = false
  let saveError = ''
  let loading: Promise<AppCompletionNotification[]> | undefined
  let saves: Promise<unknown> = Promise.resolve()
  let consumers = 0
  let stop: (() => void) | undefined
  let disposed = false
  const resource = () =>
    details.resource('runtime:notifications', read, {
      quoteId: '',
      category: 'runtime-notifications',
      maxAge: Infinity,
      warning: () => saveError
    })
  function read(): Promise<AppCompletionNotification[]> {
    if (loading) return loading
    const version = revision
    const task = transport
      .getCompletionNotifications()
      .then((saved) => {
        if (disposed) throw new Error('该请求已失效')
        const next = normalize([
          ...(resource().getSnapshot().data ?? []),
          ...(replacement ? [] : saved.filter((item) => !dismissed.has(item.id)))
        ])
        initialized = true
        // Events publish immediately while disk loading continues. Merge into that newer list.
        if (version !== revision) resource().update(next)
        return next
      })
      .finally(() => {
        if (loading === task) loading = undefined
      })
    loading = task
    return task
  }
  function persist(ready: Promise<unknown> = Promise.resolve()) {
    const target = resource()
    const release = target.retain()
    const task = saves
      .catch(() => undefined)
      .then(async () => {
        await ready
        const version = revision
        const saved = await transport.saveCompletionNotifications(target.getSnapshot().data ?? [])
        saveError = ''
        if (version === revision) {
          dirty = false
          replacement = false
          target.update(normalize(saved))
          releaseDirty?.()
          releaseDirty = undefined
        }
        return saved
      })
      .catch((reason: unknown) => {
        saveError = reason instanceof Error ? reason.message : '完成通知保存失败'
        target.update(target.getSnapshot().data ?? [])
        throw reason
      })
      .finally(release)
    saves = task
    return task
  }
  function prepare() {
    return !initialized || resource().getSnapshot().data === undefined ? read() : Promise.resolve()
  }
  function markDirty() {
    dirty = true
    releaseDirty ??= resource().retain()
  }
  function add(notification: AppCompletionNotification) {
    const ready = prepare()
    dismissed.delete(notification.id)
    revision += 1
    resource().update(normalize([notification, ...(resource().getSnapshot().data ?? [])]))
    markDirty()
    void persist(ready).catch(() => undefined)
  }
  return {
    get resource() {
      return resource()
    },
    async get() {
      const next = await resource().request(true)
      if (dirty) await persist().catch(() => undefined)
      return resource().getSnapshot().data ?? next
    },
    retain() {
      consumers += 1
      if (consumers === 1) {
        stop = subscribe(add)
        resource().invalidate(true)
        void resource()
          .request()
          .then(() => {
            if (dirty) void persist().catch(() => undefined)
          })
          .catch(() => undefined)
      }
      return () => {
        consumers -= 1
        if (!consumers) {
          stop?.()
          stop = undefined
        }
      }
    },
    add,
    dismiss(id: string) {
      const ready = prepare()
      dismissed.add(id)
      revision += 1
      resource().update((resource().getSnapshot().data ?? []).filter((item) => item.id !== id))
      markDirty()
      return persist(ready)
    },
    replace(items: AppCompletionNotification[]) {
      // Compatibility save is replacement, including while the initial disk read is pending.
      revision += 1
      initialized = true
      replacement = true
      for (const item of resource().getSnapshot().data ?? []) {
        if (!items.some((next) => next.id === item.id)) dismissed.add(item.id)
      }
      for (const item of items) dismissed.delete(item.id)
      const priorRead = loading
      resource().update(normalize(items))
      markDirty()
      return persist(priorRead?.catch(() => undefined))
    },
    dispose() {
      disposed = true
      releaseDirty?.()
      releaseDirty = undefined
      stop?.()
      stop = undefined
    }
  }
}
