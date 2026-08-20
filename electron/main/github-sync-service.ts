import { randomInt, randomUUID } from 'node:crypto'
import { clipboard, shell, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  GitHubDeviceAuthorization,
  GitHubLoginResult,
  GitHubSyncSettings,
  GitHubSyncUploadResult
} from '../../src/shared/types'
import { atomicWriteFileSync, atomicWriteJsonSync } from './file-storage'
import { decryptGitHubGistBackup, encryptGitHubGistBackup } from './github-gist-crypto'

interface StoredGitHubSyncSettings {
  syncTarget?: 'gist'
  accountLogin?: string
  gistId?: string
  gistUrl?: string
  remoteDataUpdatedAt?: string
  remoteVersion?: string
  lastSynchronizedVersion?: string
  passwordGistId?: string
}

interface PendingDeviceLogin {
  id: string
  deviceCode: string
  intervalMilliseconds: number
  expiresAt: number
}

interface GitHubDeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

interface GitHubAccessTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
  interval?: number
}

interface GitHubUserResponse {
  login?: string
}

interface GitHubGistFileResponse {
  content?: string
  truncated?: boolean
  raw_url?: string
}

interface GitHubGistResponse {
  id?: string
  html_url?: string
  public?: boolean
  description?: string | null
  updated_at?: string
  files?: Record<string, GitHubGistFileResponse | undefined>
  history?: Array<{ version?: string }>
}

interface RemoteGist {
  id: string
  url: string
  updatedAt: string
  version: string
  response: GitHubGistResponse
}

export interface GitHubGistDownload {
  content: string
  version: string
}

const GIST_DESCRIPTION = '见涨用户数据同步'
const GIST_FILE_NAME = 'jianzhang-user-data.json'
const OAUTH_SCOPE = 'gist'
const GENERATED_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class GitHubSyncService {
  private readonly directory: string
  private readonly settingsPath: string
  private readonly tokenPath: string
  private readonly passwordPath: string
  private readonly pendingLogins = new Map<string, PendingDeviceLogin>()

  constructor(
    userDataDirectory: string,
    private readonly oauthClientId: string,
    private readonly getLocalDataUpdatedAt: () => string | undefined = () => undefined
  ) {
    this.directory = join(userDataDirectory, 'github-sync')
    this.settingsPath = join(this.directory, 'settings.json')
    this.tokenPath = join(this.directory, 'token.bin')
    this.passwordPath = join(this.directory, 'sync-password.bin')
    mkdirSync(this.directory, { recursive: true })
  }

  getSettings(): GitHubSyncSettings {
    const saved = this.readSettings()
    const localDataUpdatedAt = this.getLocalDataUpdatedAt()
    const hasStoredPassword = existsSync(this.passwordPath)
    const syncPasswordReady =
      hasStoredPassword && (!saved.gistId || saved.passwordGistId === saved.gistId)
    return {
      oauthAvailable: Boolean(this.oauthClientId),
      connected: saved.syncTarget === 'gist' && existsSync(this.tokenPath),
      hasStoredPassword,
      syncPasswordReady,
      requiresRemoteRestore: Boolean(
        syncPasswordReady && saved.gistId && saved.remoteVersion !== saved.lastSynchronizedVersion
      ),
      accountLogin: saved.accountLogin,
      gistId: saved.gistId,
      gistUrl: saved.gistUrl,
      remoteDataUpdatedAt: saved.remoteDataUpdatedAt,
      remoteVersion: saved.remoteVersion,
      ...(localDataUpdatedAt ? { localDataUpdatedAt } : {})
    }
  }

  async startLogin(): Promise<GitHubDeviceAuthorization> {
    this.requireOAuthClientId()
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: this.oauthHeaders(),
      body: new URLSearchParams({ client_id: this.oauthClientId, scope: OAUTH_SCOPE })
    })
    if (!response.ok) throw await this.githubError(response, '无法开始 GitHub 网页授权')
    const result = (await response.json()) as GitHubDeviceCodeResponse
    if (
      !result.device_code ||
      !result.user_code ||
      !result.verification_uri ||
      !result.expires_in
    ) {
      throw new Error(result.error_description ?? 'GitHub 没有返回有效的网页授权信息')
    }
    const id = randomUUID()
    const expiresAt = Date.now() + result.expires_in * 1_000
    this.pendingLogins.set(id, {
      id,
      deviceCode: result.device_code,
      intervalMilliseconds: Math.max(5, result.interval ?? 5) * 1_000,
      expiresAt
    })
    clipboard.writeText(result.user_code)
    await shell.openExternal(result.verification_uri)
    return {
      loginId: id,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  async completeLogin(loginId: string): Promise<GitHubLoginResult> {
    const login = this.pendingLogins.get(loginId)
    if (!login) throw new Error('GitHub 网页授权已失效，请重新连接')
    try {
      const token = await this.pollForAccessToken(login)
      this.writeToken(token)
      const saved = this.readSettings()
      this.writeSettings({
        syncTarget: 'gist',
        ...(saved.passwordGistId ? { passwordGistId: saved.passwordGistId } : {})
      })
      return { settings: this.getSettings() }
    } finally {
      this.pendingLogins.delete(loginId)
    }
  }

  async refreshGist(): Promise<GitHubSyncSettings> {
    const token = this.requireToken()
    const saved = this.readSettings()
    const [accountLogin, gist] = await Promise.all([
      this.getAccountLogin(token),
      this.resolveGist(token, saved.gistId)
    ])
    const next: StoredGitHubSyncSettings = gist
      ? {
          syncTarget: 'gist',
          accountLogin,
          gistId: gist.id,
          gistUrl: gist.url,
          remoteDataUpdatedAt: gist.updatedAt,
          remoteVersion: gist.version,
          ...(saved.gistId === gist.id && saved.lastSynchronizedVersion
            ? { lastSynchronizedVersion: saved.lastSynchronizedVersion }
            : {}),
          ...(saved.passwordGistId ? { passwordGistId: saved.passwordGistId } : {})
        }
      : {
          syncTarget: 'gist',
          accountLogin,
          ...(saved.passwordGistId ? { passwordGistId: saved.passwordGistId } : {})
        }
    this.writeSettings(next)
    return this.getSettings()
  }

  disconnect(): GitHubSyncSettings {
    const saved = this.readSettings()
    rmSync(this.tokenPath, { force: true })
    this.writeSettings({
      syncTarget: 'gist',
      ...(saved.passwordGistId ? { passwordGistId: saved.passwordGistId } : {})
    })
    return this.getSettings()
  }

  getSyncPassword(): string | null {
    if (!existsSync(this.passwordPath)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法读取本机同步密码')
    try {
      return safeStorage.decryptString(readFileSync(this.passwordPath))
    } catch {
      throw new Error('本机同步密码无法解密，请重新设置')
    }
  }

  generateSyncPassword(): string {
    const characters = Array.from(
      { length: 24 },
      () => GENERATED_PASSWORD_ALPHABET[randomInt(GENERATED_PASSWORD_ALPHABET.length)]
    )
    return `JZ-${Array.from({ length: 6 }, (_, index) =>
      characters.slice(index * 4, index * 4 + 4).join('')
    ).join('-')}`
  }

  async saveSyncPassword(passwordValue: string): Promise<GitHubSyncSettings> {
    const password = this.normalizePassword(passwordValue)
    const currentPassword = this.getSyncPassword()
    const settings = await this.refreshGist()
    const current = this.readSettings()
    if (settings.gistId) {
      const token = this.requireToken()
      const remote = await this.getGist(settings.gistId, token)
      const remoteContent = await this.readGistContent(remote.response, token)
      if (currentPassword && current.passwordGistId === remote.id && currentPassword !== password) {
        const plainContent = await decryptGitHubGistBackup(remoteContent, currentPassword)
        const encryptedContent = await encryptGitHubGistBackup(plainContent, password)
        const updated = await this.updateGist(remote.id, encryptedContent, token)
        const saved = this.readSettings()
        this.writeSettings({
          ...saved,
          gistId: updated.id,
          gistUrl: updated.url,
          remoteDataUpdatedAt: updated.updatedAt,
          remoteVersion: updated.version,
          ...(saved.lastSynchronizedVersion === remote.version
            ? { lastSynchronizedVersion: updated.version }
            : {})
        })
      } else if (!currentPassword || current.passwordGistId !== remote.id) {
        await decryptGitHubGistBackup(remoteContent, password)
      }
    }
    this.writePassword(password)
    const saved = this.readSettings()
    this.writeSettings({
      ...saved,
      ...(saved.gistId ? { passwordGistId: saved.gistId } : { passwordGistId: undefined })
    })
    return this.getSettings()
  }

  async upload(
    content: string,
    apiKeyCount: number,
    overwriteRemote = false
  ): Promise<GitHubSyncUploadResult> {
    const password = this.requireSyncPassword()
    const token = this.requireToken()
    await this.refreshGist()
    const settings = this.readSettings()
    const encryptedContent = await encryptGitHubGistBackup(content, password)
    let uploaded: RemoteGist
    if (settings.gistId) {
      const remote = await this.getGist(settings.gistId, token)
      if (!overwriteRemote && !settings.lastSynchronizedVersion) {
        throw new Error('当前机器尚未与远程备份建立同步基线，请先从 GitHub Gist 恢复')
      }
      if (!overwriteRemote && remote.version !== settings.lastSynchronizedVersion) {
        throw new Error('远程备份已由其他设备更新，请先从 GitHub Gist 恢复后再上传')
      }
      uploaded = await this.updateGist(remote.id, encryptedContent, token)
    } else {
      uploaded = await this.createGist(encryptedContent, token)
    }
    this.writeSettings({
      ...this.readSettings(),
      gistId: uploaded.id,
      gistUrl: uploaded.url,
      remoteDataUpdatedAt: uploaded.updatedAt,
      remoteVersion: uploaded.version,
      lastSynchronizedVersion: uploaded.version,
      passwordGistId: uploaded.id
    })
    return {
      gistId: uploaded.id,
      gistUrl: uploaded.url,
      version: uploaded.version,
      uploadedAt: uploaded.updatedAt,
      fileName: GIST_FILE_NAME,
      apiKeyCount
    }
  }

  async download(): Promise<GitHubGistDownload> {
    const password = this.requireSyncPassword()
    const token = this.requireToken()
    const settings = await this.refreshGist()
    if (!settings.gistId) throw new Error('当前 GitHub 账号中还没有见涨用户数据 Gist')
    const remote = await this.getGist(settings.gistId, token)
    const encryptedContent = await this.readGistContent(remote.response, token)
    return {
      content: await decryptGitHubGistBackup(encryptedContent, password),
      version: remote.version
    }
  }

  confirmRestore(version: string): GitHubSyncSettings {
    const saved = this.readSettings()
    if (!saved.gistId || saved.remoteVersion !== version) {
      throw new Error('GitHub Gist 远程版本已经变化，请重新恢复')
    }
    this.writeSettings({ ...saved, lastSynchronizedVersion: version })
    return this.getSettings()
  }

  private async pollForAccessToken(login: PendingDeviceLogin): Promise<string> {
    let interval = login.intervalMilliseconds
    while (Date.now() < login.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, interval))
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: this.oauthHeaders(),
        body: new URLSearchParams({
          client_id: this.oauthClientId,
          device_code: login.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
      if (!response.ok) throw await this.githubError(response, 'GitHub 网页授权失败')
      const result = (await response.json()) as GitHubAccessTokenResponse
      if (result.access_token) return result.access_token
      if (result.error === 'authorization_pending') continue
      if (result.error === 'slow_down') {
        interval += Math.max(5, result.interval ?? 5) * 1_000
        continue
      }
      if (result.error === 'access_denied') throw new Error('你已取消 GitHub 网页授权')
      if (result.error === 'expired_token') throw new Error('GitHub 网页授权已过期，请重新连接')
      throw new Error(result.error_description ?? 'GitHub 网页授权失败')
    }
    throw new Error('GitHub 网页授权已过期，请重新连接')
  }

  private async getAccountLogin(token: string): Promise<string> {
    const response = await fetch('https://api.github.com/user', { headers: this.apiHeaders(token) })
    if (!response.ok) throw await this.githubError(response, '无法读取 GitHub 账号')
    const user = (await response.json()) as GitHubUserResponse
    if (!user.login) throw new Error('GitHub 未返回账号信息')
    return user.login
  }

  private async resolveGist(token: string, preferredGistId?: string): Promise<RemoteGist | null> {
    if (preferredGistId) {
      const preferred = await this.getGistOrNull(preferredGistId, token)
      if (preferred && this.isSyncGist(preferred.response)) return preferred
    }
    const matches: GitHubGistResponse[] = []
    for (let page = 1; ; page += 1) {
      const response = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
        headers: this.apiHeaders(token)
      })
      if (!response.ok) throw await this.githubError(response, '无法查找见涨用户数据 Gist')
      const result = (await response.json()) as GitHubGistResponse[]
      matches.push(...result.filter((gist) => this.isSyncGist(gist)))
      if (result.length < 100) break
    }
    const gistId = matches.sort((left, right) =>
      (right.updated_at ?? '').localeCompare(left.updated_at ?? '')
    )[0]?.id
    return gistId ? this.getGist(gistId, token) : null
  }

  private isSyncGist(gist: GitHubGistResponse): boolean {
    return (
      gist.public === false &&
      gist.description === GIST_DESCRIPTION &&
      Boolean(gist.files?.[GIST_FILE_NAME])
    )
  }

  private async getGistOrNull(gistId: string, token: string): Promise<RemoteGist | null> {
    const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      headers: this.apiHeaders(token)
    })
    if (response.status === 404) return null
    if (!response.ok) throw await this.githubError(response, '读取 GitHub Gist 失败')
    return this.toRemoteGist((await response.json()) as GitHubGistResponse)
  }

  private async getGist(gistId: string, token: string): Promise<RemoteGist> {
    const gist = await this.getGistOrNull(gistId, token)
    if (!gist || !this.isSyncGist(gist.response)) {
      throw new Error('GitHub Gist 不存在或不再是见涨的加密用户数据')
    }
    return gist
  }

  private async createGist(content: string, token: string): Promise<RemoteGist> {
    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: this.apiHeaders(token),
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: { [GIST_FILE_NAME]: { content } }
      })
    })
    if (!response.ok) throw await this.githubError(response, '创建 GitHub Gist 失败')
    return this.completeMutation((await response.json()) as GitHubGistResponse, token)
  }

  private async updateGist(gistId: string, content: string, token: string): Promise<RemoteGist> {
    const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: this.apiHeaders(token),
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        files: { [GIST_FILE_NAME]: { content } }
      })
    })
    if (!response.ok) throw await this.githubError(response, '更新 GitHub Gist 失败')
    return this.completeMutation((await response.json()) as GitHubGistResponse, token)
  }

  private async completeMutation(response: GitHubGistResponse, token: string): Promise<RemoteGist> {
    if (response.id && response.updated_at && response.history?.[0]?.version) {
      return this.toRemoteGist(response)
    }
    if (!response.id) throw new Error('GitHub 未返回有效的 Gist 信息')
    return this.getGist(response.id, token)
  }

  private toRemoteGist(response: GitHubGistResponse): RemoteGist {
    const id = response.id
    const updatedAt = response.updated_at
    const version = response.history?.[0]?.version
    if (!id || !updatedAt || !version) throw new Error('GitHub 未返回有效的 Gist 版本信息')
    return {
      id,
      url: response.html_url ?? `https://gist.github.com/${id}`,
      updatedAt,
      version,
      response
    }
  }

  private async readGistContent(gist: GitHubGistResponse, token: string): Promise<string> {
    const file = gist.files?.[GIST_FILE_NAME]
    if (!file) throw new Error('GitHub Gist 中没有见涨用户数据文件')
    if (!file.truncated && typeof file.content === 'string') return file.content
    if (!file.raw_url) throw new Error('GitHub Gist 没有返回用户数据下载地址')
    const response = await fetch(file.raw_url, { headers: this.apiHeaders(token) })
    if (!response.ok) throw await this.githubError(response, '下载 GitHub Gist 用户数据失败')
    return response.text()
  }

  private readSettings(): StoredGitHubSyncSettings {
    if (!existsSync(this.settingsPath)) return {}
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as StoredGitHubSyncSettings
      if (saved.syncTarget !== 'gist') return {}
      return saved
    } catch {
      return {}
    }
  }

  private writeSettings(settings: StoredGitHubSyncSettings): void {
    atomicWriteJsonSync(this.settingsPath, settings)
  }

  private requireOAuthClientId(): void {
    if (!this.oauthClientId) {
      throw new Error('当前构建尚未配置 GitHub OAuth App Client ID')
    }
  }

  private readToken(): string | null {
    const settings = this.readSettings()
    if (settings.syncTarget !== 'gist' || !existsSync(this.tokenPath)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全读取 GitHub 授权')
    try {
      return safeStorage.decryptString(readFileSync(this.tokenPath))
    } catch {
      throw new Error('GitHub 授权无法解密，请重新连接')
    }
  }

  private requireToken(): string {
    const token = this.readToken()
    if (!token) throw new Error('请重新通过网页连接 GitHub Gist')
    return token
  }

  private writeToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 GitHub 授权')
    atomicWriteFileSync(this.tokenPath, safeStorage.encryptString(token))
  }

  private normalizePassword(password: string): string {
    const normalized = password.trim()
    if (!normalized) throw new Error('同步密码不能为空')
    return normalized
  }

  private requireSyncPassword(): string {
    const password = this.getSyncPassword()
    if (!password) throw new Error('请先设置并保存 GitHub Gist 同步密码')
    return password
  }

  private writePassword(password: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法保存同步密码')
    atomicWriteFileSync(this.passwordPath, safeStorage.encryptString(password))
  }

  private oauthHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'jianzhang-stock-desktop'
    }
  }

  private apiHeaders(token: string): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'jianzhang-stock-desktop',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  private async githubError(response: Response, fallback: string): Promise<Error> {
    try {
      const body = (await response.json()) as { message?: string }
      return new Error(body.message ? `${fallback}：${body.message}` : fallback)
    } catch {
      return new Error(`${fallback}（HTTP ${response.status}）`)
    }
  }
}
