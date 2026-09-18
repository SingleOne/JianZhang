import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderRequest,
  AiProviderRequestMessage,
  AiProviderTool,
  AiProviderToolCall,
  AiProviderToolExecutor,
  AiProviderTurnResult
} from '../../shared/types'
import { completed, connectionResultFromError, ensureResponse, readSse } from './provider'
import { countToolCalls, executeToolCalls, MAX_TOOL_ROUNDS } from './tool-loop'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiModel {
  name?: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> }
  functionResponse?: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
  thoughtSignature?: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiToolCall extends AiProviderToolCall {
  responseId?: string
}

interface GeminiRoundResult {
  content: string
  responseId?: string
  modelContent: GeminiContent
  toolCalls: GeminiToolCall[]
}

function toGeminiContents(
  messages: AiProviderRequestMessage[],
  images: AiProviderRequest['images']
): GeminiContent[] {
  const contents: GeminiContent[] = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }))
  if (images?.length) {
    const target = [...contents].reverse().find((content) => content.role === 'user')
    target?.parts.push(
      ...images.map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.data } }))
    )
  }
  return contents
}

function toGeminiTools(tools: AiProviderTool[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }))
    }
  ]
}

async function requestRound(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
  systemText: string,
  signal: AbortSignal,
  tools: AiProviderTool[] | undefined,
  emit: ((delta: string) => void) | undefined
): Promise<GeminiRoundResult> {
  const response = await fetch(
    `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      signal,
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents,
        ...(systemText
          ? { systemInstruction: { role: 'system', parts: [{ text: systemText }] } }
          : {}),
        ...(tools?.length ? { tools: toGeminiTools(tools) } : {})
      })
    }
  )
  await ensureResponse(response)
  let content = ''
  let responseId: string | undefined
  const parts: GeminiPart[] = []
  const toolCalls: GeminiToolCall[] = []
  await readSse(response, (payload) => {
    const chunk = JSON.parse(payload) as {
      responseId?: string
      error?: { message?: string }
      candidates?: Array<{ content?: GeminiContent }>
    }
    if (chunk.error) throw new Error(chunk.error.message ?? 'Gemini 响应失败')
    responseId = chunk.responseId ?? responseId
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      parts.push(part)
      if (part.text) {
        content += part.text
        emit?.(part.text)
      }
      if (part.functionCall?.name) {
        const index = toolCalls.length
        toolCalls.push({
          id: part.functionCall.id ?? `gemini-call-${index + 1}`,
          responseId: part.functionCall.id,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {})
        })
      }
    }
  })
  return {
    content,
    responseId,
    modelContent: { role: 'model', parts },
    toolCalls
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const

  getCapabilities() {
    return {
      streaming: true,
      marketInterpretation: true,
      stockDataTools: true,
      imageInput: true
    }
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
        const description = model.description?.trim()
        return id
          ? [
              description
                ? { id, label: model.displayName?.trim() || id, description }
                : { id, label: model.displayName?.trim() || id }
            ]
          : []
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
    signal: AbortSignal,
    executeTool?: AiProviderToolExecutor
  ): Promise<AiProviderTurnResult> {
    if (!apiKey) throw new Error('请先在 AI 助手的服务设置中保存 API Key')
    const systemText = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const contents: GeminiContent[] = toGeminiContents(request.messages, request.images)
    if (!request.tools?.length) {
      const result = await requestRound(
        apiKey,
        request.model,
        contents,
        systemText,
        signal,
        undefined,
        emit
      )
      return completed(result.content, result.responseId)
    }
    if (!executeTool) throw new Error('Gemini 工具执行器未配置')

    let responseId: string | undefined
    let totalToolCalls = 0
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const selection = await requestRound(
        apiKey,
        request.model,
        contents,
        systemText,
        signal,
        request.tools,
        undefined
      )
      responseId = selection.responseId ?? responseId
      if (selection.toolCalls.length === 0) {
        if (selection.content) emit(selection.content)
        return completed(selection.content, responseId)
      }
      totalToolCalls = countToolCalls(selection.toolCalls, totalToolCalls)
      contents.push(selection.modelContent)
      const outputs = await executeToolCalls(selection.toolCalls, executeTool, signal)
      contents.push({
        role: 'user',
        parts: outputs.map(({ call, output }) => {
          const geminiCall = call as GeminiToolCall
          return {
            functionResponse: {
              ...(geminiCall.responseId ? { id: geminiCall.responseId } : {}),
              name: call.name,
              response: { output }
            }
          }
        })
      })
    }

    const answer = await requestRound(
      apiKey,
      request.model,
      contents,
      systemText,
      signal,
      undefined,
      emit
    )
    return completed(answer.content, answer.responseId ?? responseId)
  }
}
