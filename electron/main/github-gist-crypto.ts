import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

interface EncryptedGitHubGistBackupBase {
  format: 'jianzhang-gist-encrypted-backup'
  kdf: {
    name: 'scrypt'
    salt: string
    cost: number
    blockSize: number
    parallelization: number
  }
  cipher: {
    name: 'aes-256-gcm'
    iv: string
    authTag: string
  }
  ciphertext: string
}

interface EncryptedGitHubGistBackupV1 extends EncryptedGitHubGistBackupBase {
  schemaVersion: 1
}

interface EncryptedGitHubGistBackupV2 extends EncryptedGitHubGistBackupBase {
  schemaVersion: 2
  compression: {
    name: 'gzip'
  }
}

type EncryptedGitHubGistBackup = EncryptedGitHubGistBackupV1 | EncryptedGitHubGistBackupV2

const SCRYPT_COST = 65_536
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024

function deriveKey(
  password: string,
  salt: Buffer,
  options: EncryptedGitHubGistBackupBase['kdf']
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      {
        N: options.cost,
        r: options.blockSize,
        p: options.parallelization,
        maxmem: SCRYPT_MAX_MEMORY
      },
      (error, key) => {
        if (error) reject(error)
        else resolve(key)
      }
    )
  })
}

function parseEnvelope(content: string): EncryptedGitHubGistBackup {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('GitHub Gist 中的用户数据不是有效的加密备份')
  }
  const envelope = value as {
    format?: unknown
    schemaVersion?: unknown
    compression?: { name?: unknown }
    kdf?: Partial<EncryptedGitHubGistBackupBase['kdf']>
    cipher?: Partial<EncryptedGitHubGistBackupBase['cipher']>
    ciphertext?: unknown
  }
  if (
    envelope.format !== 'jianzhang-gist-encrypted-backup' ||
    (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2) ||
    (envelope.schemaVersion === 2 && envelope.compression?.name !== 'gzip') ||
    envelope.kdf?.name !== 'scrypt' ||
    envelope.cipher?.name !== 'aes-256-gcm' ||
    typeof envelope.kdf.salt !== 'string' ||
    envelope.kdf.cost !== SCRYPT_COST ||
    envelope.kdf.blockSize !== SCRYPT_BLOCK_SIZE ||
    envelope.kdf.parallelization !== SCRYPT_PARALLELIZATION ||
    typeof envelope.cipher.iv !== 'string' ||
    typeof envelope.cipher.authTag !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('GitHub Gist 中的用户数据加密格式不受支持')
  }
  return envelope as EncryptedGitHubGistBackup
}

export async function encryptGitHubGistBackup(content: string, password: string): Promise<string> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kdf: EncryptedGitHubGistBackupBase['kdf'] = {
    name: 'scrypt',
    salt: salt.toString('base64'),
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION
  }
  const key = await deriveKey(password, salt, kdf)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const compressed = gzipSync(Buffer.from(content, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  const envelope: EncryptedGitHubGistBackupV2 = {
    format: 'jianzhang-gist-encrypted-backup',
    schemaVersion: 2,
    compression: { name: 'gzip' },
    kdf,
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  }
  return JSON.stringify(envelope)
}

export async function decryptGitHubGistBackup(content: string, password: string): Promise<string> {
  const envelope = parseEnvelope(content)
  try {
    const key = await deriveKey(password, Buffer.from(envelope.kdf.salt, 'base64'), envelope.kdf)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.cipher.authTag, 'base64'))
    const plainContent = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
    return (envelope.schemaVersion === 2 ? gunzipSync(plainContent) : plainContent).toString('utf8')
  } catch {
    throw new Error('同步密码不正确，无法解密 GitHub Gist 用户数据')
  }
}
