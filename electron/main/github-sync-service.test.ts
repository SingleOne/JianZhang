import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const directories: string[] = []

function response(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => value)
  } as unknown as Response
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jianzhang-github-sync-'))
  directories.push(directory)
  return directory
}

async function completeAuthorization(service: GitHubSyncService) {
  const authorization = await service.startLogin()
  const completion = service.completeLogin(authorization.loginId)
  await vi.advanceTimersByTimeAsync(5_000)
  return completion
}

describe('GitHubSyncService', () => {
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

  it('persists a successful login before repositories are requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      )
      .mockResolvedValueOnce(response({ access_token: 'access-token' }))
    vi.stubGlobal('fetch', fetchMock)
    const directory = temporaryDirectory()
    const service = new GitHubSyncService(directory, 'client-id')

    const result = await completeAuthorization(service)

    expect(result.settings).toMatchObject({ connected: true })
    expect(result.settings.accountLogin).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/user/repos'))).toBe(false)
    expect(readFileSync(join(directory, 'github-sync/token.bin'), 'utf8')).toBe('access-token')
  })

  it('keeps the token connected when later account lookup temporarily fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      )
      .mockResolvedValueOnce(response({ access_token: 'access-token' }))
      .mockRejectedValueOnce(new Error('network unavailable'))
    vi.stubGlobal('fetch', fetchMock)
    const directory = temporaryDirectory()
    const service = new GitHubSyncService(directory, 'client-id')

    const result = await completeAuthorization(service)

    expect(result.settings.connected).toBe(true)
    await expect(service.listRepositories()).rejects.toThrow('network unavailable')
    expect(service.getSettings().connected).toBe(true)
    expect(existsSync(join(directory, 'github-sync/token.bin'))).toBe(true)
  })

  it('keeps the account connected when repository loading temporarily fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      )
      .mockResolvedValueOnce(response({ access_token: 'access-token' }))
      .mockResolvedValueOnce(response({ login: 'jianzhang-user' }))
      .mockRejectedValueOnce(new Error('repository request failed'))
    vi.stubGlobal('fetch', fetchMock)
    const directory = temporaryDirectory()
    const service = new GitHubSyncService(directory, 'client-id')

    const result = await completeAuthorization(service)

    expect(result.settings.connected).toBe(true)
    await expect(service.listRepositories()).rejects.toThrow('repository request failed')
    expect(service.getSettings()).toMatchObject({
      connected: true,
      accountLogin: 'jianzhang-user'
    })
  })
})
