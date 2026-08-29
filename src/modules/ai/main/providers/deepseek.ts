import type {
  AiConnectionResult,
  AiProvider,
  AiProviderRequest,
  AiProviderTurnResult
} from '../../shared/types'
import { completed, connectionResultFromError, ensureResponse, readSse } from './provider'

const DEEPSEEK_API_BASE = 'https://api.deepseek.com'

export class DeepSeekProvider implements AiProvider {
  readonly id = 'deepseek' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true }
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const response = await fetch(`${DEEPSEEK_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      await ensureResponse(response)
      return { ok: true, kind: 'success', message: 'DeepSeek API Key 已连接' }
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
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true }
      })
    })
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    await readSse(response, (payload) => {
      if (payload === '[DONE]') return
      const chunk = JSON.parse(payload) as {
        id?: string
        choices?: Array<{ delta?: { content?: string | null } }>
      }
      responseId = chunk.id ?? responseId
      const delta = chunk.choices?.[0]?.delta?.content ?? ''
      if (!delta) return
      content += delta
      emit(delta)
    })
    return completed(content, responseId)
  }
}
