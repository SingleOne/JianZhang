import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderRequest,
  AiProviderTurnResult
} from '../../shared/types'
import {
  completed,
  connectionResultFromError,
  ensureResponse,
  fetchModelOptions,
  readSse
} from './provider'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION
  }
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true, stockDataTools: false }
  }

  async listModels(apiKey?: string): Promise<AiModelOption[]> {
    if (!apiKey) throw new Error('请先保存 API Key')
    const models = await fetchModelOptions(
      `${ANTHROPIC_API_BASE}/models?limit=1000`,
      headers(apiKey)
    )
    if (models.length === 0) throw new Error('Anthropic 未返回可用模型')
    return models
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const models = await this.listModels(apiKey)
      return {
        ok: true,
        kind: 'success',
        message: `Anthropic API Key 已连接，可用模型 ${models.length} 个`
      }
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
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: 'POST',
      signal,
      headers: {
        ...headers(apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 8192,
        stream: true,
        ...(system ? { system } : {}),
        messages: request.messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({ role: message.role, content: message.content }))
      })
    })
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    await readSse(response, (payload) => {
      const event = JSON.parse(payload) as {
        type?: string
        message?: { id?: string }
        delta?: { type?: string; text?: string }
        error?: { message?: string }
      }
      if (event.type === 'error') throw new Error(event.error?.message ?? 'Anthropic 响应失败')
      if (event.type === 'message_start') responseId = event.message?.id
      const delta = event.type === 'content_block_delta' ? (event.delta?.text ?? '') : ''
      if (!delta) return
      content += delta
      emit(delta)
    })
    return completed(content, responseId)
  }
}
