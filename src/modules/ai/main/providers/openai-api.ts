import type {
  AiConnectionResult,
  AiProvider,
  AiProviderRequest,
  AiProviderTurnResult
} from '../../shared/types'
import { completed, connectionResultFromError, ensureResponse, readSse } from './provider'

const OPENAI_API_BASE = 'https://api.openai.com/v1'

export class OpenAiApiProvider implements AiProvider {
  readonly id = 'openai' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true }
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const response = await fetch(`${OPENAI_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      await ensureResponse(response)
      return { ok: true, kind: 'success', message: 'OpenAI API Key 已连接' }
    } catch (error) {
      return connectionResultFromError(error)
    }
  }

  async streamChat(
    apiKey: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal
  ): Promise<AiProviderTurnResult> {
    if (!apiKey) throw new Error('请先在 AI 助手的服务设置中保存 API Key')
    const response = await fetch(`${OPENAI_API_BASE}/responses`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        input: request.messages.map((message) => ({
          role: message.role === 'system' ? 'developer' : message.role,
          content: message.content
        })),
        stream: true
      })
    })
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    await readSse(response, (payload) => {
      const event = JSON.parse(payload) as {
        type?: string
        delta?: string
        response?: { id?: string }
        error?: { message?: string }
      }
      if (event.type === 'response.output_text.delta' && event.delta) {
        content += event.delta
        emit(event.delta)
      }
      if (event.type === 'response.completed') responseId = event.response?.id
      if (event.type === 'error') throw new Error(event.error?.message ?? 'OpenAI 响应失败')
    })
    return completed(content, responseId)
  }
}
