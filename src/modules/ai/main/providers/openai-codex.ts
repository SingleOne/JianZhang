import { app, shell } from 'electron'
import type {
  AiCodexAccountStatus,
  AiConnectionResult,
  AiProvider,
  AiProviderRequest,
  AiProviderTurnResult
} from '../../shared/types'
import { normalizeOpenAiCodexModelId } from '../../shared/constants'
import { CodexAppServer } from './codex-app-server'

interface AccountReadResult {
  account: null | {
    type: 'apiKey' | 'chatgpt' | 'amazonBedrock'
    email?: string | null
    planType?: string
  }
}

interface LoginStartResult {
  type: 'chatgpt'
  loginId: string
  authUrl: string
}

interface LoginCompletedNotification {
  loginId: string | null
  success: boolean
  error: string | null
}

interface AgentMessageDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

interface TurnCompletedNotification {
  threadId: string
  turn: {
    id: string
    status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
    error: { message: string } | null
    items: Array<{ type: string; text?: string; phase?: 'commentary' | 'final_answer' | null }>
  }
}

interface ModelListResult {
  data: Array<{
    id: string
    model: string
    displayName: string
    isDefault: boolean
  }>
}

const CODEX_BASE_INSTRUCTIONS = `你是“见涨”股票观察应用内的只读 AI 助手。
只根据当前请求中提供的对话、指标快照和新闻摘要回答，不运行命令，不读取文件，不调用工具，不访问网络。
不得给出个性化买卖方向、价格、数量、仓位或收益承诺；可以解释指标事实、新闻背景、不确定性和应用功能。
直接输出面向用户的最终文本，不描述内部推理或运行过程。`

function accountStatusFromError(runtimeAvailable: boolean, error: unknown): AiCodexAccountStatus {
  return {
    runtimeAvailable,
    loggedIn: false,
    message: error instanceof Error ? error.message : '无法读取 Codex 登录状态'
  }
}

function providerMessagesAsPrompt(request: AiProviderRequest): string {
  const history = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }))
  return [
    '以下 JSON 是应用按时间顺序维护的对话记录。请回答最后一条 user 消息：',
    JSON.stringify(history)
  ].join('\n')
}

export class OpenAiCodexProvider implements AiProvider {
  readonly id = 'openai-codex' as const
  private readonly runtime: CodexAppServer

  constructor(rootDirectory: string) {
    this.runtime = new CodexAppServer(rootDirectory, app.getVersion())
  }

  getCapabilities() {
    return { streaming: true, marketInterpretation: true }
  }

  async getAccountStatus(): Promise<AiCodexAccountStatus> {
    if (!this.runtime.isAvailable()) {
      return { runtimeAvailable: false, loggedIn: false, message: 'Codex 官方运行时未包含在当前构建中' }
    }
    try {
      const result = await this.runtime.request<AccountReadResult>('account/read', { refreshToken: false })
      if (result.account?.type !== 'chatgpt') {
        return { runtimeAvailable: true, loggedIn: false }
      }
      return {
        runtimeAvailable: true,
        loggedIn: true,
        email: result.account.email ?? undefined,
        planType: result.account.planType
      }
    } catch (error) {
      return accountStatusFromError(true, error)
    }
  }

  async login(): Promise<AiCodexAccountStatus> {
    const started = await this.runtime.request<LoginStartResult>('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'codex'
    })
    const completion = this.runtime.waitForNotification<LoginCompletedNotification>(
      'account/login/completed',
      (event) => event.loginId === started.loginId
    )
    let result: LoginCompletedNotification
    try {
      await shell.openExternal(started.authUrl)
      result = await completion
    } catch (error) {
      await this.runtime.request('account/login/cancel', { loginId: started.loginId }).catch(() => undefined)
      throw error
    }
    if (!result.success) throw new Error(result.error || 'Codex 账号登录失败')
    return this.getAccountStatus()
  }

  async logout(): Promise<AiCodexAccountStatus> {
    await this.runtime.request('account/logout')
    return this.getAccountStatus()
  }

  async testConnection(): Promise<AiConnectionResult> {
    const status = await this.getAccountStatus()
    if (!status.runtimeAvailable) return { ok: false, kind: 'provider', message: status.message ?? 'Codex 运行时不可用' }
    if (!status.loggedIn) return { ok: false, kind: 'authentication', message: status.message ?? '请先登录 Codex 账号' }
    const account = [status.email, status.planType].filter(Boolean).join(' · ')
    return { ok: true, kind: 'success', message: account ? `Codex 账号已连接：${account}` : 'Codex 账号已连接' }
  }

  async streamChat(
    _credential: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal
  ): Promise<AiProviderTurnResult> {
    const account = await this.getAccountStatus()
    if (!account.loggedIn) throw new Error(account.message ?? '请先在 AI 助手的服务设置中登录 Codex 账号')
    signal.throwIfAborted()
    const developerInstructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const model = await this.resolveModel(request.model)
    const started = await this.runtime.request<{ thread: { id: string } }>('thread/start', {
      model,
      cwd: this.runtime.workspaceDirectory,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { web_search: 'disabled', mcp_servers: {} },
      baseInstructions: CODEX_BASE_INSTRUCTIONS,
      developerInstructions,
      ephemeral: true
    })
    const threadId = started.thread.id
    let content = ''
    let turnId = ''
    let streamError: unknown
    const abort = () => {
      if (turnId) void this.runtime.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
    }
    const removeNotifications = this.runtime.onNotification((method, params) => {
      if (method !== 'item/agentMessage/delta') return
      const event = params as AgentMessageDeltaNotification
      if (event.threadId !== threadId) return
      content += event.delta
      try {
        emit(event.delta)
      } catch (error) {
        streamError = error
        abort()
      }
    })
    const completed = this.runtime.waitForNotification<TurnCompletedNotification>(
      'turn/completed',
      (event) => event.threadId === threadId
    )
    signal.addEventListener('abort', abort, { once: true })
    try {
      const turn = await this.runtime.request<{ turn: { id: string } }>('turn/start', {
        threadId,
        input: [{ type: 'text', text: providerMessagesAsPrompt(request), text_elements: [] }],
        approvalPolicy: 'never'
      })
      turnId = turn.turn.id
      if (streamError) abort()
      const result = await completed
      if (streamError) throw streamError
      if (signal.aborted || result.turn.status === 'interrupted') throw new DOMException('已停止生成', 'AbortError')
      if (result.turn.status === 'failed') throw new Error(result.turn.error?.message ?? 'Codex 生成失败')
      const finalMessage = [...result.turn.items]
        .reverse()
        .find((item) => item.type === 'agentMessage' && item.phase !== 'commentary')?.text?.trim()
      if (finalMessage && finalMessage.startsWith(content)) emit(finalMessage.slice(content.length))
      return { content: finalMessage || content, responseId: result.turn.id }
    } finally {
      signal.removeEventListener('abort', abort)
      removeNotifications()
    }
  }

  dispose(): void {
    this.runtime.dispose()
  }

  private async resolveModel(requestedModel: string): Promise<string> {
    const result = await this.runtime.request<ModelListResult>('model/list', { includeHidden: false })
    const normalizedRequestedModel = normalizeOpenAiCodexModelId(requestedModel)
    const selected = result.data.find((item) => (
      [item.id, item.model, item.displayName]
        .some((value) => normalizeOpenAiCodexModelId(value) === normalizedRequestedModel)
    )) ?? result.data.find((item) => item.isDefault)
    return selected?.model ?? normalizedRequestedModel
  }
}
