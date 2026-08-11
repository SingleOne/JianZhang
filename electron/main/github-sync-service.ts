import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  GitHubSyncSettings,
  GitHubSyncSettingsInput,
  GitHubSyncUploadResult
} from '../../src/shared/types'

interface StoredGitHubSyncSettings {
  owner: string
  repository: string
  branch: string
  filePath: string
  lastUploadedAt?: string
  lastDownloadedAt?: string
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

interface GitHubRepositoryResponse {
  private?: boolean
}

interface RemoteFile {
  sha: string
  content: string
}

type GitHubSyncSettingsSource = GitHubSyncSettingsInput & {
  lastUploadedAt?: string
  lastDownloadedAt?: string
}

const DEFAULT_SETTINGS: StoredGitHubSyncSettings = {
  owner: '',
  repository: '',
  branch: 'main',
  filePath: '.jianzhang-sync/user-data.json'
}

export class GitHubSyncService {
  private readonly directory: string
  private readonly settingsPath: string
  private readonly tokenPath: string

  constructor(userDataDirectory: string) {
    this.directory = join(userDataDirectory, 'github-sync')
    this.settingsPath = join(this.directory, 'settings.json')
    this.tokenPath = join(this.directory, 'token.bin')
    mkdirSync(this.directory, { recursive: true })
  }

  getSettings(): GitHubSyncSettings {
    const saved = this.readSettings()
    const token = this.readToken()
    return {
      ...saved,
      tokenConfigured: Boolean(token),
      tokenMaskedSuffix: token ? token.slice(-4) : undefined
    }
  }

  saveSettings(input: GitHubSyncSettingsInput): GitHubSyncSettings {
    const current = this.readSettings()
    const settings = {
      ...this.normalizeSettings(input),
      ...(current.lastUploadedAt ? { lastUploadedAt: current.lastUploadedAt } : {}),
      ...(current.lastDownloadedAt ? { lastDownloadedAt: current.lastDownloadedAt } : {})
    }
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    const token = input.token?.trim()
    if (token) this.writeToken(token)
    return this.getSettings()
  }

  async upload(content: string, apiKeyCount: number): Promise<GitHubSyncUploadResult> {
    const settings = this.requireConnection()
    const token = this.requireToken()
    await this.requirePrivateRepository(settings, token)
    const remote = await this.getRemoteFile(settings, token)
    const response = await fetch(this.contentUrl(settings), {
      method: 'PUT',
      headers: this.headers(token),
      body: JSON.stringify({
        message: `sync: 更新见涨用户数据 ${new Date().toISOString()}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: settings.branch,
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
      filePath: result.content?.path ?? settings.filePath,
      apiKeyCount
    }
  }

  async download(): Promise<string> {
    const settings = this.requireConnection()
    const token = this.requireToken()
    await this.requirePrivateRepository(settings, token)
    const remote = await this.getRemoteFile(settings, token)
    if (!remote) throw new Error('GitHub 仓库中还没有见涨用户数据备份')
    this.writeSettings({ ...settings, lastDownloadedAt: new Date().toISOString() })
    return remote.content
  }

  private readSettings(): StoredGitHubSyncSettings {
    if (!existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS }
    try {
      return this.normalizeSettings(
        JSON.parse(readFileSync(this.settingsPath, 'utf8')) as GitHubSyncSettingsSource
      )
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private writeSettings(settings: StoredGitHubSyncSettings): void {
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }

  private normalizeSettings(input: GitHubSyncSettingsSource): StoredGitHubSyncSettings {
    const owner = input.owner.trim()
    const repository = input.repository.trim()
    const branch = input.branch.trim() || DEFAULT_SETTINGS.branch
    const filePath = input.filePath.trim().replaceAll('\\', '/') || DEFAULT_SETTINGS.filePath
    if (
      filePath.startsWith('/') ||
      filePath.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error('GitHub 同步文件路径无效')
    }
    return {
      owner,
      repository,
      branch,
      filePath,
      ...(typeof input.lastUploadedAt === 'string' ? { lastUploadedAt: input.lastUploadedAt } : {}),
      ...(typeof input.lastDownloadedAt === 'string'
        ? { lastDownloadedAt: input.lastDownloadedAt }
        : {})
    }
  }

  private requireConnection(): StoredGitHubSyncSettings {
    const settings = this.readSettings()
    if (!settings.owner || !settings.repository) throw new Error('请先配置 GitHub 仓库')
    return settings
  }

  private readToken(): string | null {
    if (!existsSync(this.tokenPath)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全读取 GitHub Token')
    try {
      return safeStorage.decryptString(readFileSync(this.tokenPath))
    } catch {
      throw new Error('GitHub Token 无法解密，请重新配置')
    }
  }

  private requireToken(): string {
    const token = this.readToken()
    if (!token) throw new Error('请先配置 GitHub Personal Access Token')
    return token
  }

  private writeToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 GitHub Token')
    writeFileSync(this.tokenPath, safeStorage.encryptString(token))
  }

  private contentUrl(settings: StoredGitHubSyncSettings): string {
    const owner = encodeURIComponent(settings.owner)
    const repository = encodeURIComponent(settings.repository)
    const filePath = settings.filePath.split('/').map(encodeURIComponent).join('/')
    return `https://api.github.com/repos/${owner}/${repository}/contents/${filePath}`
  }

  private repositoryUrl(settings: StoredGitHubSyncSettings): string {
    return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}`
  }

  private headers(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'jianzhang-stock-desktop',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  private async getRemoteFile(
    settings: StoredGitHubSyncSettings,
    token: string
  ): Promise<RemoteFile | null> {
    const url = `${this.contentUrl(settings)}?ref=${encodeURIComponent(settings.branch)}`
    const response = await fetch(url, {
      headers: this.headers(token, 'application/vnd.github.object+json')
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
      headers: this.headers(token, 'application/vnd.github.raw+json')
    })
    if (!rawResponse.ok) throw await this.githubError(rawResponse, '下载 GitHub 备份失败')
    return { sha: result.sha, content: await rawResponse.text() }
  }

  private async requirePrivateRepository(
    settings: StoredGitHubSyncSettings,
    token: string
  ): Promise<void> {
    const response = await fetch(this.repositoryUrl(settings), { headers: this.headers(token) })
    if (!response.ok) throw await this.githubError(response, '无法访问 GitHub 仓库')
    const repository = (await response.json()) as GitHubRepositoryResponse
    if (repository.private !== true) {
      throw new Error('用户数据包含明文 AI API Key，只允许同步到 GitHub 私有仓库')
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
