import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiApi } from '../../modules/ai/shared/types'
import type { MemoryStatus } from '../../modules/ai/shared/memory-types'
import type {
  MarketInsightApi,
  MarketInsightSettings,
  MarketInsightSnapshot
} from '../../modules/market-insight/shared/types'

vi.mock('../api', async () => {
  const { createResourceCache } = await import('./resource')
  const cache = createResourceCache()
  return {
    dataCenter: {
      details: { resource: cache.get, invalidate: cache.invalidate, dispose: cache.dispose }
    }
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', {})
})
afterEach(async () => {
  const { dataCenter } = await import('../api')
  dataCenter.details.dispose()
  vi.unstubAllGlobals()
})

describe('optional module resources', () => {
  it('waits for an identity switch before a finishing child workflow rereads status', async () => {
    const switching = deferred<void>()
    const api = {
      getMemoryStatus: vi
        .fn()
        .mockResolvedValue({ activeProfileId: 'B', profiles: [], pendingDeletes: 0, bindings: {} })
    } as unknown as AiApi
    const { memoryStatusResource, changeMemoryIdentity } = await import('./memory-resources')
    const changed = changeMemoryIdentity(api, () => switching.promise)
    const read = memoryStatusResource(api).request()
    await Promise.resolve()
    expect(api.getMemoryStatus).not.toHaveBeenCalled()
    switching.resolve()
    await Promise.all([changed, read])
    expect(memoryStatusResource(api).getSnapshot().data?.activeProfileId).toBe('B')
  })
  it('starts a fresh memory read after a write instead of joining an older forced read', async () => {
    const old = deferred<[]>()
    const latest = [{ id: 'new-library' }]
    const api = {
      listMemoryLibraries: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(latest)
    } as unknown as AiApi
    const { memoryLibrariesResource, reloadMemoryResource } = await import('./memory-resources')
    const resource = memoryLibrariesResource(api, 'A')
    const initial = resource.request(true)
    const rejected = expect(initial).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    await expect(reloadMemoryResource(resource)).resolves.toEqual(latest)
    old.resolve([])
    await rejected
    expect(resource.getSnapshot().data).toEqual(latest)
  })
  it('only generates AI analysis on an explicit force request and isolates stocks', async () => {
    const api = {
      getLatestInterpretation: vi.fn().mockResolvedValue(null),
      interpret: vi.fn().mockResolvedValue(null)
    }
    window.aiApi = api as unknown as AiApi
    const { shortAnalysisResource } = await import('./optional-resources')
    const a = shortAnalysisResource('A')!
    const b = shortAnalysisResource('B')!
    const first = a.request()
    expect(a.request()).toBe(first)
    await first
    expect(api.interpret).not.toHaveBeenCalled()
    await a.request(true)
    expect(api.interpret).toHaveBeenCalledExactlyOnceWith('A')
    expect(b.getSnapshot().data).toBeUndefined()
  })

  it('merges queued insight setting edits against the latest confirmed settings', async () => {
    let settings: MarketInsightSettings = {
      enabled: true,
      watchedQuoteIds: [],
      showChartOverlay: true,
      volumeSpikeRatio: 2,
      eventCooldownMinutes: 10,
      newsCacheHours: 1,
      includeOlderNews: false
    }
    const api = {
      getSettings: vi.fn(async () => settings),
      saveSettings: vi.fn(async (next: MarketInsightSettings) => {
        settings = next
      })
    }
    window.marketInsightApi = api as unknown as MarketInsightApi
    const { changeInsightSettings, insightSettingsResource } = await import('./optional-resources')
    await Promise.all([
      changeInsightSettings((current) => ({
        ...current,
        watchedQuoteIds: [...current.watchedQuoteIds, 'A']
      })),
      changeInsightSettings((current) => ({ ...current, showChartOverlay: false }))
    ])
    expect(insightSettingsResource().getSnapshot().data).toMatchObject({
      watchedQuoteIds: ['A'],
      showChartOverlay: false
    })
  })

  it('does not invalidate its own refresh when the insight service emits an update', async () => {
    let emit: (quoteId: string) => void = () => undefined
    const api = {
      getSnapshot: vi.fn().mockResolvedValue(null),
      refresh: vi.fn(async (quoteId: string) => {
        emit(quoteId)
        return { quoteId }
      }),
      onUpdated: vi.fn((listener: (quoteId: string) => void) => {
        emit = listener
        return vi.fn()
      })
    }
    window.marketInsightApi = api as unknown as MarketInsightApi
    const { retainInsightUpdates, refreshInsight, insightSnapshotResource } =
      await import('./optional-resources')
    const release = retainInsightUpdates()
    await Promise.resolve()
    await refreshInsight('A')
    expect(insightSnapshotResource('A').getSnapshot().data?.quoteId).toBe('A')
    release()
  })

  it('keeps the displayed insight snapshot while an update rereads the latest data', async () => {
    let emit: (quoteId: string) => void = () => undefined
    const previous = { quoteId: 'A', generatedAt: '2026-11-10T01:00:00.000Z' }
    const next = { ...previous, generatedAt: '2026-11-10T01:01:00.000Z' }
    const reread = deferred<MarketInsightSnapshot>()
    const api = {
      getSnapshot: vi.fn().mockResolvedValueOnce(previous).mockReturnValueOnce(reread.promise),
      onUpdated: vi.fn((listener: (quoteId: string) => void) => {
        emit = listener
        return vi.fn()
      })
    }
    window.marketInsightApi = api as unknown as MarketInsightApi
    const { retainInsightUpdates, insightSnapshotResource } = await import('./optional-resources')
    const releaseUpdates = retainInsightUpdates()
    const resource = insightSnapshotResource('A')
    await resource.request()
    const releaseSnapshot = resource.retain()
    const displayed: Array<MarketInsightSnapshot | null | undefined> = []
    const unsubscribe = resource.subscribe(() => displayed.push(resource.getSnapshot().data))

    emit('A')
    expect(resource.getSnapshot()).toMatchObject({ data: previous, loading: true })
    reread.resolve(next as MarketInsightSnapshot)
    await resource.request()
    expect(resource.getSnapshot().data).toEqual(next)
    expect(displayed.length).toBeGreaterThan(0)
    expect(displayed.every((snapshot) => snapshot != null)).toBe(true)

    unsubscribe()
    releaseSnapshot()
    releaseUpdates()
  })

  it('retires memory identity keys so a late old response cannot populate a switched-back profile', async () => {
    let status: MemoryStatus = {
      activeProfileId: 'A',
      profiles: [],
      pendingDeletes: 0,
      bindings: {}
    }
    const old = deferred<[]>()
    const api = {
      getMemoryStatus: vi.fn(async () => status),
      listMemoryFacts: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([])
    } as unknown as AiApi
    const { memoryFactsResource, memoryStatusResource, changeMemoryIdentity } =
      await import('./memory-resources')
    await memoryStatusResource(api).request()
    const retired = memoryFactsResource(api, 'A')
    const request = retired.request()
    const rejected = expect(request).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    await changeMemoryIdentity(api, async () => {
      status = { ...status, activeProfileId: 'B' }
    })
    await changeMemoryIdentity(api, async () => {
      status = { ...status, activeProfileId: 'A' }
    })
    const current = memoryFactsResource(api, 'A')
    expect(current).not.toBe(retired)
    old.resolve([])
    await rejected
    expect(current.getSnapshot().data).toBeUndefined()
    await current.request()
    expect(current.getSnapshot().data).toEqual([])
  })
})
