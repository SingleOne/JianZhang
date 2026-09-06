import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderRequest,
  AiProviderRequestMessage,
  AiProviderTurnResult
} from '../../shared/types'
import { completed, connectionResultFromError, ensureResponse, readSse } from './provider'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiModel {
  name?: string
  displayName?: string
  supportedGenerationMethods?: string[]
}

function toGeminiContents(messages: AiProviderRequestMessage[]) {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }))
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true, stockDataTools: false }
  }

  async listModels(apiKey?: string): Promise<AiModelOption[]> {
    if (!apiKey) throw new Error('请先保存 API Key')
    const response = await fetch(`${GEMINI_API_BASE}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey }
    })
    await ensureResponse(response)
    const body = (await response.json()) as { models?: GeminiModel[] }
    const models = (body.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .flatMap((model) => {
        const id = model.name?.replace(/^models\//, '').trim()
        return id ? [{ id, label: model.displayName?.trim() || id }] : []
      })
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
      )
    if (models.length === 0) throw new Error('Gemini 未返回可用的生成模型')
    return models
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const models = await this.listModels(apiKey)
      return {
        ok: true,
        kind: 'success',
        message: `Gemini API Key 已连接，可用模型 ${models.length} 个`
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
    const systemText = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        signal,
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: toGeminiContents(request.messages),
          ...(systemText
            ? { systemInstruction: { role: 'system', parts: [{ text: systemText }] } }
            : {})
        })
      }
    )
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    await readSse(response, (payload) => {
      const chunk = JSON.parse(payload) as {
        responseId?: string
        error?: { message?: string }
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      if (chunk.error) throw new Error(chunk.error.message ?? 'Gemini 响应失败')
      responseId = chunk.responseId ?? responseId
      const delta = (chunk.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
      if (!delta) return
      content += delta
      emit(delta)
    })
    return completed(content, responseId)
  }
}
