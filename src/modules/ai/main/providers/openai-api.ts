import type {
  AiConnectionResult,
  AiModelOption,
  AiProvider,
  AiProviderRequest,
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
import { countToolCalls, executeToolCalls, MAX_TOOL_ROUNDS } from './tool-loop'

const OPENAI_API_BASE = 'https://api.openai.com/v1'

type OpenAiResponseInput =
  | { role: 'developer' | 'user' | 'assistant'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }

interface OpenAiResponseRoundResult {
  content: string
  responseId?: string
  toolCalls: AiProviderToolCall[]
}

function toOpenAiResponseTools(tools: AiProviderTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false
  }))
}

async function requestRound(
  apiKey: string,
  model: string,
  input: OpenAiResponseInput[],
  signal: AbortSignal,
  tools: AiProviderTool[] | undefined,
  emit: ((delta: string) => void) | undefined,
  previousResponseId?: string,
  toolChoice: 'auto' | 'none' = 'auto'
): Promise<OpenAiResponseRoundResult> {
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input,
      stream: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(tools?.length ? { tools: toOpenAiResponseTools(tools), tool_choice: toolChoice } : {})
    })
  })
  await ensureResponse(response)
  let content = ''
  let responseId: string | undefined
  const toolCalls = new Map<string, AiProviderToolCall>()
  await readSse(response, (payload) => {
    if (payload === '[DONE]') return
    const event = JSON.parse(payload) as {
      type?: string
      delta?: string
      call_id?: string
      name?: string
      arguments?: string
      response?: { id?: string }
      item?: {
        type?: string
        call_id?: string
        name?: string
        arguments?: string
      }
      error?: { message?: string }
    }
    if (event.type === 'response.output_text.delta' && event.delta) {
      content += event.delta
      emit?.(event.delta)
    }
    if (event.type === 'response.function_call_arguments.done' && event.call_id) {
      toolCalls.set(event.call_id, {
        id: event.call_id,
        name: event.name ?? '',
        arguments: event.arguments ?? ''
      })
    }
    if (
      event.type === 'response.output_item.done' &&
      event.item?.type === 'function_call' &&
      event.item.call_id
    ) {
      toolCalls.set(event.item.call_id, {
        id: event.item.call_id,
        name: event.item.name ?? '',
        arguments: event.item.arguments ?? ''
      })
    }
    if (event.type === 'response.completed') responseId = event.response?.id
    if (event.type === 'error') throw new Error(event.error?.message ?? 'OpenAI 响应失败')
  })
  return { content, responseId, toolCalls: [...toolCalls.values()] }
}

export class OpenAiApiProvider implements AiProvider {
  readonly id = 'openai' as const

  getCapabilities() {
    return { streaming: true, marketInterpretation: true, stockDataTools: true }
  }

  async listModels(apiKey?: string): Promise<AiModelOption[]> {
    if (!apiKey) throw new Error('请先保存 API Key')
    const models = await fetchModelOptions(`${OPENAI_API_BASE}/models`, {
      Authorization: `Bearer ${apiKey}`
    })
    const available = models.filter(
      (model) =>
        /^(?:gpt-|o\d|chatgpt-)/i.test(model.id) &&
        !/(?:audio|image|realtime|search|transcribe|tts|embedding|moderation)/i.test(model.id)
    )
    if (available.length === 0) throw new Error('OpenAI 未返回可用的文本模型')
    return available
  }

  async testConnection(apiKey?: string): Promise<AiConnectionResult> {
    if (!apiKey) return { ok: false, kind: 'authentication', message: '请先保存 API Key' }
    try {
      const models = await this.listModels(apiKey)
      return {
        ok: true,
        kind: 'success',
        message: `OpenAI API Key 已连接，可用模型 ${models.length} 个`
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
    let input: OpenAiResponseInput[] = request.messages.map((message) => ({
      role: message.role === 'system' ? 'developer' : message.role,
      content: message.content
    }))
    if (!request.tools?.length) {
      const result = await requestRound(apiKey, request.model, input, signal, undefined, emit)
      return completed(result.content, result.responseId)
    }
    if (!executeTool) throw new Error('OpenAI 工具执行器未配置')

    let responseId: string | undefined
    let totalToolCalls = 0
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const selection = await requestRound(
        apiKey,
        request.model,
        input,
        signal,
        request.tools,
        undefined,
        responseId
      )
      if (selection.toolCalls.length === 0) {
        if (selection.content) emit(selection.content)
        return completed(selection.content, selection.responseId ?? responseId)
      }
      if (!selection.responseId) throw new Error('OpenAI 工具调用响应缺少 response id')
      responseId = selection.responseId
      totalToolCalls = countToolCalls(selection.toolCalls, totalToolCalls)
      const outputs = await executeToolCalls(selection.toolCalls, executeTool, signal)
      input = outputs.map(({ call, output }) => ({
        type: 'function_call_output' as const,
        call_id: call.id,
        output
      }))
    }

    const answer = await requestRound(
      apiKey,
      request.model,
      input,
      signal,
      request.tools,
      emit,
      responseId,
      'none'
    )
    return completed(answer.content, answer.responseId ?? responseId)
  }
}
