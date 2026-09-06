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
import {
  completed,
  connectionResultFromError,
  ensureResponse,
  fetchModelOptions,
  readSse
} from './provider'

const DEEPSEEK_API_BASE = 'https://api.deepseek.com'
const MAX_TOOL_CALLS = 3

interface DeepSeekToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

type DeepSeekMessage =
  | AiProviderRequestMessage
  | {
      role: 'assistant'
      content: string | null
      tool_calls: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

interface DeepSeekRoundResult {
  content: string
  responseId?: string
  toolCalls: AiProviderToolCall[]
}

function toDeepSeekTools(tools: AiProviderTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }))
}

async function requestRound(
  apiKey: string,
  model: string,
  messages: DeepSeekMessage[],
  signal: AbortSignal,
  tools: AiProviderTool[] | undefined,
  emit: ((delta: string) => void) | undefined,
  toolChoice: 'auto' | 'none' = 'auto'
): Promise<DeepSeekRoundResult> {
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools?.length ? { tools: toDeepSeekTools(tools), tool_choice: toolChoice } : {})
    })
  })
  await ensureResponse(response)
  let content = ''
  let responseId: string | undefined
  const toolCalls = new Map<number, DeepSeekToolCallAccumulator>()
  await readSse(response, (payload) => {
    if (payload === '[DONE]') return
    const chunk = JSON.parse(payload) as {
      id?: string
      choices?: Array<{
        delta?: {
          content?: string | null
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    responseId = chunk.id ?? responseId
    const delta = chunk.choices?.[0]?.delta
    const contentDelta = delta?.content ?? ''
    if (contentDelta) {
      content += contentDelta
      emit?.(contentDelta)
    }
    for (const toolCallDelta of delta?.tool_calls ?? []) {
      const current = toolCalls.get(toolCallDelta.index) ?? { id: '', name: '', arguments: '' }
      current.id = toolCallDelta.id ?? current.id
      current.name += toolCallDelta.function?.name ?? ''
      current.arguments += toolCallDelta.function?.arguments ?? ''
      toolCalls.set(toolCallDelta.index, current)
    }
  })
  return {
    content,
    responseId,
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
  }
}

export class DeepSeekProvider implements AiProvider {
  readonly id = 'deepseek' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true, stockDataTools: true }
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
        message: `DeepSeek API Key 已连接，可用模型 ${models.length} 个`
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
    const messages: DeepSeekMessage[] = [...request.messages]
    if (!request.tools?.length) {
      const result = await requestRound(apiKey, request.model, messages, signal, undefined, emit)
      return completed(result.content, result.responseId)
    }
    if (!executeTool) throw new Error('DeepSeek 股票数据工具执行器未配置')

    // 第一轮只让模型根据数据目录选择数据；内容先缓冲，避免工具调用前的草稿泄漏到界面。
    const selection = await requestRound(
      apiKey,
      request.model,
      messages,
      signal,
      request.tools,
      undefined
    )
    if (selection.toolCalls.length === 0) {
      if (selection.content) emit(selection.content)
      return completed(selection.content, selection.responseId)
    }
    if (selection.toolCalls.length > MAX_TOOL_CALLS) {
      throw new Error(`模型一次请求了过多工具调用，最多允许 ${MAX_TOOL_CALLS} 个`)
    }
    for (const call of selection.toolCalls) {
      if (!call.id || !call.name) throw new Error('模型返回的工具调用缺少 id 或 name')
    }

    messages.push({
      role: 'assistant',
      content: selection.content || null,
      tool_calls: selection.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    })
    const toolResults = await Promise.all(
      selection.toolCalls.map(async (call) => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: await executeTool(call, signal)
      }))
    )
    messages.push(...toolResults)

    // 这次只实现一次“清单 -> 选取 -> 明细”的 DeepSeek 链路，第二轮直接生成最终答复。
    const answer = await requestRound(
      apiKey,
      request.model,
      messages,
      signal,
      request.tools,
      emit,
      'none'
    )
    return completed(answer.content, answer.responseId ?? selection.responseId)
  }
}
