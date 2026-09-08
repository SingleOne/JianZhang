import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptGitHubGistBackup, encryptGitHubGistBackup } from './github-gist-crypto'

function encryptLegacyBackup(content: string, password: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kdf = {
    name: 'scrypt' as const,
    salt: salt.toString('base64'),
    cost: 65_536,
    blockSize: 8,
    parallelization: 1
  }
  const key = scryptSync(password, salt, 32, {
    N: kdf.cost,
    r: kdf.blockSize,
    p: kdf.parallelization,
    maxmem: 128 * 1024 * 1024
  })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  return JSON.stringify({
    format: 'jianzhang-gist-encrypted-backup',
    schemaVersion: 1,
    kdf,
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  })
}

describe('GitHub Gist backup encryption', () => {
  it('encrypts the complete backup and decrypts it with the same password', async () => {
    const backup = JSON.stringify({ state: { watchlist: [] }, aiApiKeys: { openai: 'secret' } })
    const encrypted = await encryptGitHubGistBackup(backup, 'my-sync-password')
    const envelope = JSON.parse(encrypted) as {
      schemaVersion: number
      compression?: { name?: string }
    }

    expect(encrypted).not.toContain('secret')
    expect(envelope).toMatchObject({ schemaVersion: 2, compression: { name: 'gzip' } })
    await expect(decryptGitHubGistBackup(encrypted, 'my-sync-password')).resolves.toBe(backup)
  })

  it('continues to decrypt legacy schema version 1 backups', async () => {
    const backup = JSON.stringify({ state: { watchlist: [] } })
    const encrypted = encryptLegacyBackup(backup, 'legacy-password')

    await expect(decryptGitHubGistBackup(encrypted, 'legacy-password')).resolves.toBe(backup)
  })

  it('rejects a wrong password', async () => {
    const encrypted = await encryptGitHubGistBackup('{"value":1}', 'correct-password')

    await expect(decryptGitHubGistBackup(encrypted, 'wrong-password')).rejects.toThrow(
      '同步密码不正确'
    )
  })
})
