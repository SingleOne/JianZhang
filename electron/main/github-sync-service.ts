import { randomUUID } from 'node:crypto'
import { clipboard, shell, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  GitHubDeviceAuthorization,
  GitHubLoginResult,
  GitHubRepositoryOption,
  GitHubSyncSettings,
  GitHubSyncUploadResult
} from '../../src/shared/types'

interface StoredGitHubSyncSettings {
  accountLogin?: string
  repositoryFullName?: string
  repositoryDefaultBranch?: string
  lastUploadedAt?: string
  lastDownloadedAt?: string
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

interface GitHubRepositoryResponse {
  id?: number
  full_name?: string
  private?: boolean
  default_branch?: string
  permissions?: { push?: boolean }
}

interface GitHubContentResponse {
  type?: string
  sha?: string
  content?: string
  encoding?: string
}

interface GitHubCommitResponse {
  commit?: { sha?: string }
  content?: { path?: string }
}

interface RemoteFile {
  sha: string
  content: string
}

const SYNC_FILE_PATH = '.jianzhang-sync/user-data.json'
const OAUTH_SCOPE = 'repo'

export class GitHubSyncService {
  private readonly directory: string
  private readonly settingsPath: string
  private readonly tokenPath: string
  private readonly pendingLogins = new Map<string, PendingDeviceLogin>()

  constructor(
    userDataDirectory: string,
    private readonly oauthClientId: string
  ) {
    this.directory = join(userDataDirectory, 'github-sync')
    this.settingsPath = join(this.directory, 'settings.json')
    this.tokenPath = join(this.directory, 'token.bin')
    mkdirSync(this.directory, { recursive: true })
  }

  getSettings(): GitHubSyncSettings {
    const saved = this.readSettings()
    return {
      oauthAvailable: Boolean(this.oauthClientId),
      connected: existsSync(this.tokenPath),
      ...saved
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
      return { settings: this.getSettings() }
    } finally {
      this.pendingLogins.delete(loginId)
    }
  }

  async listRepositories(): Promise<GitHubRepositoryOption[]> {
    const token = this.requireToken()
    const current = this.readSettings()
    if (!current.accountLogin) {
      this.writeSettings({ ...current, accountLogin: await this.getAccountLogin(token) })
    }
    return this.listRepositoriesWithToken(token)
  }

  async selectRepository(fullName: string): Promise<GitHubSyncSettings> {
    const repository = (await this.listRepositories()).find((item) => item.fullName === fullName)
    if (!repository) throw new Error('未找到可写入的 GitHub 私有仓库')
    const current = this.readSettings()
    this.writeSettings({
      ...current,
      repositoryFullName: repository.fullName,
      repositoryDefaultBranch: repository.defaultBranch
    })
    return this.getSettings()
  }

  disconnect(): GitHubSyncSettings {
    rmSync(this.tokenPath, { force: true })
    const current = this.readSettings()
    this.writeSettings({
      ...(current.lastUploadedAt ? { lastUploadedAt: current.lastUploadedAt } : {}),
      ...(current.lastDownloadedAt ? { lastDownloadedAt: current.lastDownloadedAt } : {})
    })
    return this.getSettings()
  }

  async upload(content: string, apiKeyCount: number): Promise<GitHubSyncUploadResult> {
    const token = this.requireToken()
    const settings = await this.requirePrivateRepository(this.requireRepository(), token)
    const remote = await this.getRemoteFile(settings, token)
    const response = await fetch(this.contentUrl(settings), {
      method: 'PUT',
      headers: this.apiHeaders(token),
      body: JSON.stringify({
        message: `sync: 更新见涨用户数据 ${new Date().toISOString()}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: settings.repositoryDefaultBranch,
        ...(remote ? { sha: remote.sha } : {})
      })
    })
    if (!response.ok) throw await this.githubError(response, '上传 GitHub 失败')
    const result = (await response.json()) as GitHubCommitResponse
    const commitSha = result.commit?.sha
    if (!commitSha) throw new Error('GitHub 未返回提交信息')
    const uploadedAt = new Date().toISOString()
    this.writeSettings({ ...settings, lastUploadedAt: uploadedAt })
    return {
      commitSha,
      uploadedAt,
      filePath: result.content?.path ?? SYNC_FILE_PATH,
      apiKeyCount
    }
  }

  async download(): Promise<string> {
    const token = this.requireToken()
    const settings = await this.requirePrivateRepository(this.requireRepository(), token)
    const remote = await this.getRemoteFile(settings, token)
    if (!remote) throw new Error('所选 GitHub 仓库中还没有见涨用户数据备份')
    this.writeSettings({ ...settings, lastDownloadedAt: new Date().toISOString() })
    return remote.content
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

  private async listRepositoriesWithToken(token: string): Promise<GitHubRepositoryOption[]> {
    const repositories: GitHubRepositoryOption[] = []
    for (let page = 1; ; page += 1) {
      const response = await fetch(
        `https://api.github.com/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
        { headers: this.apiHeaders(token) }
      )
      if (!response.ok) throw await this.githubError(response, '无法读取 GitHub 私有仓库')
      const result = (await response.json()) as GitHubRepositoryResponse[]
      repositories.push(
        ...result.flatMap((repository) =>
          repository.private === true &&
          repository.permissions?.push === true &&
          repository.id &&
          repository.full_name &&
          repository.default_branch
            ? [
                {
                  id: repository.id,
                  fullName: repository.full_name,
                  defaultBranch: repository.default_branch
                }
              ]
            : []
        )
      )
      if (result.length < 100) break
    }
    return repositories
  }

  private readSettings(): StoredGitHubSyncSettings {
    if (!existsSync(this.settingsPath)) return {}
    try {
      const saved = JSON.parse(
        readFileSync(this.settingsPath, 'utf8')
      ) as StoredGitHubSyncSettings & {
        owner?: string
        repository?: string
        branch?: string
      }
      return {
        accountLogin: saved.accountLogin,
        repositoryFullName:
          saved.repositoryFullName ??
          (saved.owner && saved.repository ? `${saved.owner}/${saved.repository}` : undefined),
        repositoryDefaultBranch: saved.repositoryDefaultBranch ?? saved.branch,
        lastUploadedAt: saved.lastUploadedAt,
        lastDownloadedAt: saved.lastDownloadedAt
      }
    } catch {
      return {}
    }
  }

  private writeSettings(settings: StoredGitHubSyncSettings): void {
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }

  private requireOAuthClientId(): void {
    if (!this.oauthClientId) {
      throw new Error('当前构建尚未配置 GitHub OAuth App Client ID')
    }
  }

  private readToken(): string | null {
    if (!existsSync(this.tokenPath)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全读取 GitHub 授权')
    try {
      return safeStorage.decryptString(readFileSync(this.tokenPath))
    } catch {
      throw new Error('GitHub 授权无法解密，请重新连接')
    }
  }

  private requireToken(): string {
    const token = this.readToken()
    if (!token) throw new Error('请先通过网页连接 GitHub')
    return token
  }

  private writeToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 GitHub 授权')
    writeFileSync(this.tokenPath, safeStorage.encryptString(token))
  }

  private requireRepository(): StoredGitHubSyncSettings & {
    repositoryFullName: string
    repositoryDefaultBranch: string
  } {
    const settings = this.readSettings()
    if (!settings.repositoryFullName || !settings.repositoryDefaultBranch) {
      throw new Error('请先选择用于同步的 GitHub 私有仓库')
    }
    return {
      ...settings,
      repositoryFullName: settings.repositoryFullName,
      repositoryDefaultBranch: settings.repositoryDefaultBranch
    }
  }

  private contentUrl(settings: { repositoryFullName: string }): string {
    const repository = settings.repositoryFullName.split('/').map(encodeURIComponent).join('/')
    return `https://api.github.com/repos/${repository}/contents/${SYNC_FILE_PATH}`
  }

  private oauthHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'jianzhang-stock-desktop'
    }
  }

  private async requirePrivateRepository(
    settings: StoredGitHubSyncSettings & {
      repositoryFullName: string
      repositoryDefaultBranch: string
    },
    token: string
  ): Promise<
    StoredGitHubSyncSettings & {
      repositoryFullName: string
      repositoryDefaultBranch: string
    }
  > {
    const repositoryPath = settings.repositoryFullName.split('/').map(encodeURIComponent).join('/')
    const response = await fetch(`https://api.github.com/repos/${repositoryPath}`, {
      headers: this.apiHeaders(token)
    })
    if (!response.ok) throw await this.githubError(response, '无法访问所选 GitHub 仓库')
    const repository = (await response.json()) as GitHubRepositoryResponse
    if (repository.private !== true) {
      throw new Error('用户数据包含明文 AI API Key，只允许同步到 GitHub 私有仓库')
    }
    if (!repository.full_name || !repository.default_branch) {
      throw new Error('GitHub 未返回有效的仓库信息')
    }
    const current = {
      ...settings,
      repositoryFullName: repository.full_name,
      repositoryDefaultBranch: repository.default_branch
    }
    this.writeSettings(current)
    return current
  }

  private apiHeaders(
    token: string,
    accept = 'application/vnd.github+json'
  ): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'jianzhang-stock-desktop',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  private async getRemoteFile(
    settings: { repositoryFullName: string; repositoryDefaultBranch: string },
    token: string
  ): Promise<RemoteFile | null> {
    const url = `${this.contentUrl(settings)}?ref=${encodeURIComponent(settings.repositoryDefaultBranch)}`
    const response = await fetch(url, {
      headers: this.apiHeaders(token, 'application/vnd.github.object+json')
    })
    if (response.status === 404) return null
    if (!response.ok) throw await this.githubError(response, '读取 GitHub 备份失败')
    const result = (await response.json()) as GitHubContentResponse
    if (result.type !== 'file' || !result.sha) throw new Error('GitHub 同步路径不是文件')
    if (result.encoding === 'base64' && result.content) {
      return {
        sha: result.sha,
        content: Buffer.from(result.content.replaceAll('\n', ''), 'base64').toString('utf8')
      }
    }
    const rawResponse = await fetch(url, {
      headers: this.apiHeaders(token, 'application/vnd.github.raw+json')
    })
    if (!rawResponse.ok) throw await this.githubError(rawResponse, '下载 GitHub 备份失败')
    return { sha: result.sha, content: await rawResponse.text() }
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
