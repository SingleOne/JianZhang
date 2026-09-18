import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderRequest,
  AiProviderToolExecutor,
  AiProviderTurnResult
} from '../../shared/types'
import { connectionResultFromError, fetchModelOptions } from './provider'
import { streamOpenAiChatCompletions } from './openai-chat-completions'

const DEEPSEEK_API_BASE = 'https://api.deepseek.com'

export class DeepSeekProvider implements AiProvider {
  readonly id = 'deepseek' as const

  getCapabilities() {
    return {
      streaming: true,
      marketInterpretation: true,
      stockDataTools: true,
      imageInput: false
    }
  }

  async listModels(apiKey?: string): Promise<AiModelOption[]> {
    if (!apiKey) throw new Error('请先保存 API Key')
    const models = await fetchModelOptions(`${DEEPSEEK_API_BASE}/models`, {
      Authorization: `Bearer ${apiKey}`
    })
    if (models.length === 0) throw new Error('DeepSeek 未返回可用模型')
    return models
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const models = await this.listModels(apiKey)
      return {
        ok: true,
        kind: 'success',
        message: `DeepSeek 已连接，可用模型 ${models.length} 个`
      }
    } catch (error) {
      return connectionResultFromError(error)
    }
  }

  async streamChat(
    apiKey: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal,
    executeTool?: AiProviderToolExecutor
  ): Promise<AiProviderTurnResult> {
    if (!apiKey) throw new Error('请先在 AI 助手的服务设置中保存 API Key')
    return streamOpenAiChatCompletions({
      apiBase: DEEPSEEK_API_BASE,
      apiKey,
      label: 'DeepSeek',
      request,
      emit,
      signal,
      executeTool,
      includeUsage: true
    })
  }
}
