import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'

interface EncryptedGitHubGistBackup {
  format: 'jianzhang-gist-encrypted-backup'
  schemaVersion: 1
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

const SCRYPT_COST = 65_536
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024

function deriveKey(
  password: string,
  salt: Buffer,
  options: EncryptedGitHubGistBackup['kdf']
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
  const envelope = value as Partial<EncryptedGitHubGistBackup>
  if (
    envelope.format !== 'jianzhang-gist-encrypted-backup' ||
    envelope.schemaVersion !== 1 ||
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
  const kdf: EncryptedGitHubGistBackup['kdf'] = {
    name: 'scrypt',
    salt: salt.toString('base64'),
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION
  }
  const key = await deriveKey(password, salt, kdf)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  const envelope: EncryptedGitHubGistBackup = {
    format: 'jianzhang-gist-encrypted-backup',
    schemaVersion: 1,
    kdf,
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  }
  return JSON.stringify(envelope, null, 2)
}

export async function decryptGitHubGistBackup(content: string, password: string): Promise<string> {
  const envelope = parseEnvelope(content)
  try {
    const key = await deriveKey(password, Buffer.from(envelope.kdf.salt, 'base64'), envelope.kdf)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.cipher.authTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('同步密码不正确，无法解密 GitHub Gist 用户数据')
  }
}
