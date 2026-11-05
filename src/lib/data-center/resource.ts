export interface ResourceSnapshot<T> {
  data: T | undefined
  loading: boolean
  error: string
  updatedAt: number
}

export interface RefreshDemand {
  interval: number
  canRefresh: () => boolean
  nextWindow: () => number
}

export interface DetailResource<T> {
  getSnapshot: () => ResourceSnapshot<T>
  subscribe: (listener: () => void) => () => void
  retain: (demand?: RefreshDemand) => () => void
  request: (force?: boolean) => Promise<T>
  invalidate: (preserveData?: boolean) => void
  update: (data: T) => void
}

interface ResourceOptions<T> {
  maxAge: number
  quoteId: string
  category: string
  validate?: (next: T, previous: T | undefined) => void
  warning?: (data: T) => string
}

/** Per-window request/cache ownership. Active consumers share one request and one timer. */
export function createResourceCache(maxEntries = 200) {
  const entries = new Map<
    string,
    {
      resource: DetailResource<unknown>
      options: ResourceOptions<unknown>
      idle: () => boolean
      dispose: () => void
    }
  >()
  const trim = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break
      if (!entry.idle()) continue
      entry.dispose()
      entries.delete(key)
    }
  }

  function get<T>(
    key: string,
    load: (force: boolean) => Promise<T>,
    options: ResourceOptions<T>
  ): DetailResource<T> {
    const existing = entries.get(key)
    if (existing) {
      entries.delete(key)
      entries.set(key, existing)
      return existing.resource as DetailResource<T>
    }
    let snapshot: ResourceSnapshot<T> = { data: undefined, loading: false, error: '', updatedAt: 0 }
    const listeners = new Set<() => void>()
    const consumers = new Map<object, RefreshDemand | undefined>()
    let pending: Promise<T> | undefined
    let pendingForce = false
    let forcedRequest: Promise<T> | undefined
    let generation = 0
    let cacheValid = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = (next: ResourceSnapshot<T>) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    }
    const stopTimer = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const schedule = () => {
      stopTimer()
      if (pending) return
      const demands = [...consumers.values()].filter((value): value is RefreshDemand =>
        Boolean(value)
      )
      if (!demands.length) return
      const delay = Math.min(
        ...demands.map((demand) => (demand.canRefresh() ? demand.interval : demand.nextWindow()))
      )
      timer = setTimeout(
        () => {
          if (demands.some((demand) => demand.canRefresh()))
            void request(true).catch(() => undefined)
          else schedule()
        },
        Math.max(1, delay)
      )
    }
    const request = (force = false): Promise<T> => {
      if (pending) {
        if (!force || pendingForce) return pending
        // A manual refresh must still reach transports that distinguish cache reads.
        if (!forcedRequest) {
          const version = generation
          const queued = pending
            .catch(() => undefined)
            .then(() => {
              if (version !== generation) throw new Error('该请求已失效')
              return request(true)
            })
            .finally(() => {
              if (forcedRequest === queued) forcedRequest = undefined
              trim()
            })
          forcedRequest = queued
        }
        return forcedRequest
      }
      if (
        !force &&
        cacheValid &&
        snapshot.data !== undefined &&
        Date.now() - snapshot.updatedAt < options.maxAge
      ) {
        return Promise.resolve(snapshot.data)
      }
      stopTimer()
      const version = generation
      const task = Promise.resolve()
        .then(() => load(force))
        .then((data) => {
          if (version !== generation) throw new Error('该请求已失效')
          options.validate?.(data, snapshot.data)
          cacheValid = true
          publish({
            data,
            loading: false,
            error: options.warning?.(data) ?? '',
            updatedAt: Date.now()
          })
          return data
        })
        .catch((reason: unknown) => {
          if (version === generation)
            publish({
              ...snapshot,
              loading: false,
              error: reason instanceof Error ? reason.message : '数据加载失败'
            })
          throw reason
        })
        .finally(() => {
          if (pending !== task) return
          pending = undefined
          schedule()
          trim()
        })
      pending = task
      pendingForce = force
      publish({ ...snapshot, loading: true, error: '' })
      return task
    }
    const resource: DetailResource<T> = {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          trim()
        }
      },
      retain(demand) {
        const token = {}
        consumers.set(token, demand)
        void request(Boolean(demand && Date.now() - snapshot.updatedAt >= demand.interval)).catch(
          () => undefined
        )
        schedule()
        return () => {
          consumers.delete(token)
          schedule()
          trim()
        }
      },
      request,
      invalidate(preserveData = false) {
        generation += 1
        cacheValid = false
        pending = undefined
        forcedRequest = undefined
        stopTimer()
        publish({
          data: preserveData ? snapshot.data : undefined,
          loading: false,
          error: '',
          updatedAt: preserveData ? snapshot.updatedAt : 0
        })
        if (consumers.size) void request().catch(() => undefined)
      },
      update(data) {
        generation += 1
        cacheValid = true
        pending = undefined
        forcedRequest = undefined
        publish({
          data,
          loading: false,
          error: options.warning?.(data) ?? '',
          updatedAt: Date.now()
        })
        schedule()
      }
    }
    entries.set(key, {
      resource: resource as DetailResource<unknown>,
      options: options as ResourceOptions<unknown>,
      idle: () => !listeners.size && !consumers.size && !pending && !forcedRequest,
      dispose: () => {
        generation += 1
        pending = undefined
        forcedRequest = undefined
        consumers.clear()
        stopTimer()
      }
    })
    return resource
  }
  return {
    get,
    invalidate(quoteId?: string, categories?: readonly string[], preserveData = false) {
      for (const entry of [...entries.values()]) {
        if (
          (quoteId === undefined || entry.options.quoteId === quoteId) &&
          (!categories || categories.includes(entry.options.category))
        )
          entry.resource.invalidate(preserveData)
      }
    },
    dispose() {
      for (const entry of entries.values()) entry.dispose()
      entries.clear()
    }
  }
}
