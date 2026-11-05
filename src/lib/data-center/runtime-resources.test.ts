import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState,
  type CacheSummary,
  type GitHubSyncSettings,
  type OptionalModulesState,
  type StockDesktopApi
} from '../../shared/types'
import { createDataCenter } from './center'
import { createDetailCenter } from './details'
import { createRuntimeResources, EMPTY_GITHUB_SETTINGS } from './runtime-resources'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const ready: OptionalModulesState = {
  marketInsight: { status: 'ready', error: null },
  ai: { status: 'ready', error: null },
  aiTAdvice: { status: 'disabled', error: null }
}
const connected: GitHubSyncSettings = {
  ...EMPTY_GITHUB_SETTINGS,
  connected: true,
  accountLogin: 'test'
}
const summary: CacheSummary = { generatedAt: 'new', categories: [] }
function setup() {
  let receive: ((next: OptionalModulesState) => void) | undefined
  const stop = vi.fn(() => {
    receive = undefined
  })
  const api = {
    onStateUpdated: () => () => undefined,
    onQuotesUpdated: () => () => undefined,
    getOptionalModulesState: vi
      .fn<StockDesktopApi['getOptionalModulesState']>()
      .mockResolvedValue(ready),
    onOptionalModulesStateUpdated: vi.fn((callback: (next: OptionalModulesState) => void) => {
      receive = callback
      return stop
    }),
    getCacheSummary: vi.fn<StockDesktopApi['getCacheSummary']>().mockResolvedValue(summary),
    clearCaches: vi.fn<StockDesktopApi['clearCaches']>().mockResolvedValue({
      categoryIds: [],
      clearedFileCount: 1,
      clearedBytes: 100,
      failedPaths: [],
      webCacheCleared: false
    }),
    getGitHubSyncSettings: vi
      .fn<StockDesktopApi['getGitHubSyncSettings']>()
      .mockResolvedValue(connected),
    getGitHubSyncPassword: vi
      .fn<StockDesktopApi['getGitHubSyncPassword']>()
      .mockResolvedValue(null),
    saveGitHubSyncPassword: vi
      .fn<StockDesktopApi['saveGitHubSyncPassword']>()
      .mockResolvedValue({ ...connected, hasStoredPassword: true, syncPasswordReady: true }),
    disconnectGitHub: vi
      .fn<StockDesktopApi['disconnectGitHub']>()
      .mockResolvedValue(EMPTY_GITHUB_SETTINGS),
    completeGitHubLogin: vi
      .fn<StockDesktopApi['completeGitHubLogin']>()
      .mockResolvedValue({ settings: connected }),
    refreshGitHubGist: vi.fn<StockDesktopApi['refreshGitHubGist']>().mockResolvedValue(connected),
    uploadUserDataToGitHub: vi.fn<StockDesktopApi['uploadUserDataToGitHub']>().mockResolvedValue({
      gistId: 'id',
      gistUrl: 'url',
      version: 'new',
      uploadedAt: 'now',
      fileName: 'backup',
      apiKeyCount: 0
    }),
    downloadUserDataFromGitHub: vi
      .fn<StockDesktopApi['downloadUserDataFromGitHub']>()
      .mockResolvedValue({ canceled: true })
  }
  const transport = api as unknown as StockDesktopApi
  const details = createDetailCenter(transport)
  const runtime = createRuntimeResources(transport, details)
  return {
    api,
    transport,
    details,
    runtime,
    stop,
    emit: (next: OptionalModulesState) => receive?.(next),
    dispose() {
      runtime.dispose()
      details.dispose()
    }
  }
}

describe('runtime metadata ownership', () => {
  it('shares module subscriptions, keeps pushes over delayed reads, and rereads on re-entry', async () => {
    const test = setup()
    const initial = deferred<OptionalModulesState>()
    test.api.getOptionalModulesState.mockReturnValueOnce(initial.promise)
    const first = test.runtime.retainModules()
    const second = test.runtime.retainModules()
    const stale = expect(test.runtime.modules.request()).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    test.emit(ready)
    initial.resolve({ ...ready, ai: { status: 'initializing', error: null } })
    await stale
    expect(test.runtime.modules.getSnapshot().data).toBe(ready)
    expect(test.api.onOptionalModulesStateUpdated).toHaveBeenCalledTimes(1)
    first()
    expect(test.stop).not.toHaveBeenCalled()
    second()
    expect(test.stop).toHaveBeenCalledTimes(1)
    const reopened = test.runtime.retainModules()
    await test.runtime.modules.request()
    expect(test.api.getOptionalModulesState).toHaveBeenCalledTimes(2)
    reopened()
    test.dispose()
  })

  it('rejects an older settings read after a password save without caching the plaintext', async () => {
    const test = setup()
    const initial = deferred<GitHubSyncSettings>()
    test.api.getGitHubSyncSettings.mockReturnValueOnce(initial.promise)
    const stale = expect(test.runtime.github.request()).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    const saved = await test.runtime.saveGitHubSyncPassword('temporary-input')
    initial.resolve(EMPTY_GITHUB_SETTINGS)
    await stale
    expect(test.runtime.github.getSnapshot().data).toBe(saved)
    expect(test.runtime.github.getSnapshot().data).not.toHaveProperty('password')
    expect(test.api.getGitHubSyncPassword).not.toHaveBeenCalled()
    test.dispose()
  })

  it('serializes mutations and continues after a rejected operation while retaining prior settings', async () => {
    const test = setup()
    await test.runtime.github.request()
    const pending = deferred<GitHubSyncSettings>()
    const started = deferred<void>()
    test.api.disconnectGitHub.mockImplementationOnce(() => {
      started.resolve()
      return pending.promise
    })
    const failed = expect(test.runtime.disconnectGitHub()).rejects.toThrow('offline')
    const save = test.runtime.saveGitHubSyncPassword('temporary-input')
    await started.promise
    expect(test.api.saveGitHubSyncPassword).not.toHaveBeenCalled()
    expect(test.runtime.github.getSnapshot().data).toBe(connected)
    pending.reject(new Error('offline'))
    await failed
    const saved = await save
    expect(test.runtime.github.getSnapshot().data).toBe(saved)
    test.dispose()
  })

  it('publishes login, refresh, upload and download settings through the same resource', async () => {
    const test = setup()
    await test.runtime.completeGitHubLogin('temporary-login')
    expect(test.runtime.github.getSnapshot().data).toBe(connected)
    await test.runtime.refreshGitHubGist()
    const uploaded = await test.runtime.uploadUserDataToGitHub(true)
    expect(uploaded.version).toBe('new')
    const downloaded = await test.runtime.downloadUserDataFromGitHub()
    expect(downloaded.canceled).toBe(true)
    expect(test.api.getGitHubSyncSettings).toHaveBeenCalledTimes(2)
    expect(test.runtime.github.getSnapshot().data).toBe(connected)
    test.dispose()
  })

  it('invalidates old cache statistics after clearing, and keeps facade getters fresh', async () => {
    const test = setup()
    const state: AppState = {
      watchlist: [],
      watchlistGroups: [],
      stockTrackingProfiles: {},
      stockTradingBooks: {},
      corporateActionApplications: {},
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER]
    }
    const center = createDataCenter(test.transport, state)
    const old = deferred<CacheSummary>()
    test.api.getCacheSummary.mockReturnValueOnce(old.promise)
    const stale = expect(center.api.getCacheSummary()).rejects.toThrow('该请求已失效')
    await Promise.resolve()
    await center.api.clearCaches(['temporary-market'])
    await expect(center.runtime.cache.request()).resolves.toBe(summary)
    old.resolve({ generatedAt: 'old', categories: [] })
    await stale
    expect(center.runtime.cache.getSnapshot().data).toBe(summary)
    await center.api.getGitHubSyncSettings()
    await center.api.getGitHubSyncSettings()
    expect(test.api.getGitHubSyncSettings).toHaveBeenCalledTimes(2)
    await center.api.getGitHubSyncPassword()
    await center.api.getGitHubSyncPassword()
    expect(test.api.getGitHubSyncPassword).toHaveBeenCalledTimes(2)
    center.dispose()
    test.dispose()
  })

  it('reacquires idle resources after LRU eviction before publishing a command result', async () => {
    const test = setup()
    const old = test.runtime.github
    await old.request()
    for (let index = 0; index < 205; index += 1) {
      await test.details
        .resource(`idle:${index}`, async () => index, {
          quoteId: '',
          category: 'idle',
          maxAge: Infinity
        })
        .request()
    }
    expect(test.runtime.github).not.toBe(old)
    const saved = await test.runtime.saveGitHubSyncPassword('temporary-input')
    expect(test.runtime.github.getSnapshot().data).toBe(saved)
    test.dispose()
  })
})
