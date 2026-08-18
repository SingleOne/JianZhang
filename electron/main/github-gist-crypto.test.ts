import { describe, expect, it } from 'vitest'
import { decryptGitHubGistBackup, encryptGitHubGistBackup } from './github-gist-crypto'

describe('GitHub Gist backup encryption', () => {
  it('encrypts the complete backup and decrypts it with the same password', async () => {
    const backup = JSON.stringify({ state: { watchlist: [] }, aiApiKeys: { openai: 'secret' } })
    const encrypted = await encryptGitHubGistBackup(backup, 'my-sync-password')

    expect(encrypted).not.toContain('secret')
    await expect(decryptGitHubGistBackup(encrypted, 'my-sync-password')).resolves.toBe(backup)
  })

  it('rejects a wrong password', async () => {
    const encrypted = await encryptGitHubGistBackup('{"value":1}', 'correct-password')

    await expect(decryptGitHubGistBackup(encrypted, 'wrong-password')).rejects.toThrow(
      '同步密码不正确'
    )
  })
})
