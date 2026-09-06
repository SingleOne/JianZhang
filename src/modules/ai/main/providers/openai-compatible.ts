import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderId,
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

interface OpenAiCompatibleProviderConfig {
  id: AiProviderId
  label: string
  apiBase: string
  modelsUrl?: string
  filterModel?: (model: AiModelOption) => boolean
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: AiProviderId

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {
    this.id = config.id
  }

  getCapabilities() {
    return { streaming: true, marketInterpretation: true, stockDataTools: false }
  }

  async listModels(apiKey?: string): Promise<AiModelOption[]> {
    if (!apiKey) throw new Error('请先保存 API Key')
    const models = await fetchModelOptions(
      this.config.modelsUrl ?? `${this.config.apiBase}/models`,
      {
        Authorization: `Bearer ${apiKey}`
      }
    )
    const available = this.config.filterModel ? models.filter(this.config.filterModel) : models
    if (available.length === 0) throw new Error(`${this.config.label} 未返回可用的文本模型`)
    return available
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const models = await this.listModels(apiKey)
      return {
        ok: true,
        kind: 'success',
        message: `${this.config.label} API Key 已连接，可用模型 ${models.length} 个`
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
    const response = await fetch(`${this.config.apiBase}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true
      })
    })
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    await readSse(response, (payload) => {
      if (payload === '[DONE]') return
      const chunk = JSON.parse(payload) as {
        id?: string
        error?: { message?: string }
        choices?: Array<{ delta?: { content?: string | null } }>
      }
      if (chunk.error) throw new Error(chunk.error.message ?? `${this.config.label} 响应失败`)
      responseId = chunk.id ?? responseId
      const delta = chunk.choices?.[0]?.delta?.content ?? ''
      if (!delta) return
      content += delta
      emit(delta)
    })
    return completed(content, responseId)
  }
}
