import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptGitHubGistBackup } from './github-gist-crypto'

const { clipboardWriteText, openExternal } = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  openExternal: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  clipboard: { writeText: clipboardWriteText },
  shell: { openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

import { GitHubSyncService } from './github-sync-service'

interface FakeGist {
  id: string
  html_url: string
  public: false
  description: string
  updated_at: string
  files: Record<string, { content: string; truncated: false }>
  history: Array<{ version: string }>
}

const directories: string[] = []

function response(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => value),
    text: vi.fn(async () => (typeof value === 'string' ? value : JSON.stringify(value)))
  } as unknown as Response
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jianzhang-github-sync-'))
  directories.push(directory)
  return directory
}

function installGitHubApi() {
  let gist: FakeGist | null = null
  let version = 0
  const nextVersion = () => {
    version += 1
    return {
      updatedAt: `2026-08-18T0${version}:00:00.000Z`,
      version: `version-${version}`
    }
  }
  const updateGist = (content: string) => {
    const next = nextVersion()
    gist = {
      id: 'gist-1',
      html_url: 'https://gist.github.com/gist-1',
      public: false,
      description: '见涨用户数据同步',
      updated_at: next.updatedAt,
      files: { 'jianzhang-user-data.json': { content, truncated: false } },
      history: [{ version: next.version }]
    }
    return gist
  }
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === 'https://github.com/login/device/code') {
      return response({
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      return response({ access_token: 'access-token' })
    }
    if (url === 'https://api.github.com/user') return response({ login: 'jianzhang-user' })
    if (url.startsWith('https://api.github.com/gists?')) return response(gist ? [gist] : [])
    if (url === 'https://api.github.com/gists' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        public: boolean
        files: Record<string, { content: string }>
      }
      expect(body.public).toBe(false)
      return response(updateGist(body.files['jianzhang-user-data.json'].content), 201)
    }
    if (url === 'https://api.github.com/gists/gist-1' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as {
        files: Record<string, { content: string }>
      }
      return response(updateGist(body.files['jianzhang-user-data.json'].content))
    }
    if (url === 'https://api.github.com/gists/gist-1') {
      return gist ? response(gist) : response({ message: 'Not Found' }, 404)
    }
    throw new Error(`Unexpected request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    getGist: () => gist,
    advanceRemoteVersion: () => {
      if (!gist) throw new Error('Gist has not been created')
      updateGist(gist.files['jianzhang-user-data.json'].content)
    }
  }
}

async function completeAuthorization(service: GitHubSyncService) {
  const authorization = await service.startLogin()
  const completion = service.completeLogin(authorization.loginId)
  await vi.advanceTimersByTimeAsync(5_000)
  return completion
}

describe('GitHubSyncService Gist sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('authorizes the gist scope and creates an encrypted secret Gist on first upload', async () => {
    const api = installGitHubApi()
    const directory = temporaryDirectory()
    const service = new GitHubSyncService(directory, 'client-id')

    const login = await completeAuthorization(service)
    expect(login.settings).toMatchObject({ connected: true, hasStoredPassword: false })
    const deviceRequest = api.fetchMock.mock.calls[0][1] as RequestInit
    expect(String(deviceRequest.body)).toContain('scope=gist')

    await service.refreshGist()
    await service.saveSyncPassword('my-sync-password')
    const backup = JSON.stringify({ aiApiKeys: { openai: 'secret-api-key' } })
    const uploaded = await service.upload(backup, 1)
    const encrypted = api.getGist()?.files['jianzhang-user-data.json'].content ?? ''

    expect(encrypted).not.toContain('secret-api-key')
    await expect(decryptGitHubGistBackup(encrypted, 'my-sync-password')).resolves.toBe(backup)
    expect(uploaded).toMatchObject({ gistId: 'gist-1', version: 'version-1', apiKeyCount: 1 })
    expect(service.getSettings()).toMatchObject({
      gistId: 'gist-1',
      hasStoredPassword: true,
      remoteVersion: 'version-1'
    })
    expect(service.getSyncPassword()).toBe('my-sync-password')
    expect(service.generateSyncPassword()).toMatch(/^JZ-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/)
    expect(readFileSync(join(directory, 'github-sync/token.bin'), 'utf8')).toBe('access-token')
  })

  it('automatically finds the newest matching Gist and binds a password on another machine', async () => {
    installGitHubApi()
    const first = new GitHubSyncService(temporaryDirectory(), 'client-id')
    await completeAuthorization(first)
    await first.refreshGist()
    await first.saveSyncPassword('shared-password')
    await first.upload('{"state":"from-first-machine"}', 0)

    const secondDirectory = temporaryDirectory()
    const second = new GitHubSyncService(secondDirectory, 'client-id')
    await completeAuthorization(second)
    const discovered = await second.refreshGist()

    expect(discovered).toMatchObject({ gistId: 'gist-1', hasStoredPassword: false })
    await expect(second.saveSyncPassword('wrong-password')).rejects.toThrow('同步密码不正确')
    await second.saveSyncPassword('shared-password')
    expect(second.getSettings().requiresRemoteRestore).toBe(true)
    const download = await second.download()
    expect(download.content).toBe('{"state":"from-first-machine"}')
    expect(second.confirmRestore(download.version)).toMatchObject({
      hasStoredPassword: true,
      requiresRemoteRestore: false
    })
    expect(existsSync(join(secondDirectory, 'github-sync/sync-password.bin'))).toBe(true)
  })

  it('blocks an upload when another device has changed the remote Gist version', async () => {
    const api = installGitHubApi()
    const service = new GitHubSyncService(temporaryDirectory(), 'client-id')
    await completeAuthorization(service)
    await service.refreshGist()
    await service.saveSyncPassword('sync-password')
    await service.upload('{"version":1}', 0)

    api.advanceRemoteVersion()

    await expect(service.upload('{"version":2}', 0)).rejects.toThrow('远程备份已由其他设备更新')
  })

  it('re-encrypts the current remote backup when the local password is changed', async () => {
    const api = installGitHubApi()
    const service = new GitHubSyncService(temporaryDirectory(), 'client-id')
    await completeAuthorization(service)
    await service.refreshGist()
    await service.saveSyncPassword('old-password')
    await service.upload('{"value":1}', 0)

    await service.saveSyncPassword('new-password')
    const encrypted = api.getGist()?.files['jianzhang-user-data.json'].content ?? ''

    await expect(decryptGitHubGistBackup(encrypted, 'new-password')).resolves.toBe('{"value":1}')
    await expect(decryptGitHubGistBackup(encrypted, 'old-password')).rejects.toThrow(
      '同步密码不正确'
    )
    expect(service.getSyncPassword()).toBe('new-password')
  })
})
