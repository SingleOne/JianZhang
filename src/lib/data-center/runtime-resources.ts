import type { GitHubSyncSettings, StockDesktopApi } from '../../shared/types'
import type { createDetailCenter } from './details'

export const EMPTY_GITHUB_SETTINGS: GitHubSyncSettings = {
  oauthAvailable: false,
  connected: false,
  hasStoredPassword: false,
  syncPasswordReady: false,
  requiresRemoteRestore: false
}

/** Formal runtime metadata only. Passwords and authorization workflows stay with callers. */
export function createRuntimeResources(
  transport: StockDesktopApi,
  details: ReturnType<typeof createDetailCenter>
) {
  const options = (category: string) => ({ quoteId: '', category, maxAge: Infinity })
  const modules = () =>
    details.resource(
      'runtime:modules',
      () => transport.getOptionalModulesState(),
      options('runtime-modules')
    )
  const cache = () =>
    details.resource('runtime:cache', () => transport.getCacheSummary(), options('runtime-cache'))
  const github = () =>
    details.resource(
      'runtime:github',
      () => transport.getGitHubSyncSettings(),
      options('runtime-github')
    )
  let consumers = 0
  let stop: (() => void) | undefined
  let writes: Promise<unknown> = Promise.resolve()
  let disposed = false
  function reloadModules() {
    modules().invalidate(true)
    void modules()
      .request()
      .catch(() => undefined)
  }
  function githubWrite<T>(
    operation: () => Promise<T>,
    settings: (result: T) => ReturnType<StockDesktopApi['getGitHubSyncSettings']>
  ) {
    const task = writes
      .catch(() => undefined)
      .then(async () => {
        github().invalidate(true)
        const result = await operation()
        const next = await settings(result)
        if (!disposed) github().update(next)
        return result
      })
    writes = task
    return task
  }
  return {
    get modules() {
      return modules()
    },
    get cache() {
      return cache()
    },
    get github() {
      return github()
    },
    retainModules() {
      consumers += 1
      if (consumers === 1) {
        stop = transport.onOptionalModulesStateUpdated((next) => modules().update(next))
        reloadModules()
      }
      return () => {
        consumers -= 1
        if (!consumers) {
          stop?.()
          stop = undefined
        }
      }
    },
    refreshCache() {
      cache().invalidate()
      void cache()
        .request()
        .catch(() => undefined)
    },
    completeGitHubLogin: (loginId: string) =>
      githubWrite(
        () => transport.completeGitHubLogin(loginId),
        async (result) => result.settings
      ),
    refreshGitHubGist: () =>
      githubWrite(
        () => transport.refreshGitHubGist(),
        async (result) => result
      ),
    saveGitHubSyncPassword: (password: string) =>
      githubWrite(
        () => transport.saveGitHubSyncPassword(password),
        async (result) => result
      ),
    disconnectGitHub: () =>
      githubWrite(
        () => transport.disconnectGitHub(),
        async (result) => result
      ),
    uploadUserDataToGitHub: (overwriteRemote?: boolean) =>
      githubWrite(
        () => transport.uploadUserDataToGitHub(overwriteRemote),
        () => transport.getGitHubSyncSettings()
      ),
    downloadUserDataFromGitHub: () =>
      githubWrite(
        () => transport.downloadUserDataFromGitHub(),
        () => transport.getGitHubSyncSettings()
      ),
    applyGitHubGistRestore: (importId: string, version: string) =>
      githubWrite(
        () => transport.applyGitHubGistRestore(importId, version),
        () => transport.getGitHubSyncSettings()
      ),
    dispose() {
      disposed = true
      stop?.()
      stop = undefined
    }
  }
}
