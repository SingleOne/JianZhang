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

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION
  }
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicBlockAccumulator {
  type: 'text' | 'tool_use'
  text: string
  id: string
  name: string
  input: Record<string, unknown>
  inputJson: string
}

interface AnthropicRoundResult {
  content: string
  responseId?: string
  assistantContent: AnthropicContentBlock[]
  toolCalls: AiProviderToolCall[]
}

function toAnthropicTools(tools: AiProviderTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }))
}

async function requestRound(
  apiKey: string,
  model: string,
  messages: AnthropicMessage[],
  system: string,
  signal: AbortSignal,
  tools: AiProviderTool[] | undefined,
  emit: ((delta: string) => void) | undefined
): Promise<AnthropicRoundResult> {
  const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    signal,
    headers: {
      ...headers(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      ...(system ? { system } : {}),
      messages,
      ...(tools?.length ? { tools: toAnthropicTools(tools) } : {})
    })
  })
  await ensureResponse(response)
  let content = ''
  let responseId: string | undefined
  const blocks = new Map<number, AnthropicBlockAccumulator>()
  await readSse(response, (payload) => {
    const event = JSON.parse(payload) as {
      type?: string
      index?: number
      message?: { id?: string }
      content_block?: {
        type?: 'text' | 'tool_use'
        text?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }
      delta?: { type?: string; text?: string; partial_json?: string }
      error?: { message?: string }
    }
    if (event.type === 'error') throw new Error(event.error?.message ?? 'Anthropic 响应失败')
    if (event.type === 'message_start') responseId = event.message?.id
    if (event.type === 'content_block_start' && event.index !== undefined) {
      const block = event.content_block
      const accumulator: AnthropicBlockAccumulator = {
        type: block?.type === 'tool_use' ? 'tool_use' : 'text',
        text: block?.text ?? '',
        id: block?.id ?? '',
        name: block?.name ?? '',
        input: block?.input ?? {},
        inputJson: ''
      }
      blocks.set(event.index, accumulator)
      if (accumulator.text) {
        content += accumulator.text
        emit?.(accumulator.text)
      }
    }
    if (event.type === 'content_block_delta' && event.index !== undefined) {
      const block = blocks.get(event.index)
      if (!block) return
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        block.text += event.delta.text
        content += event.delta.text
        emit?.(event.delta.text)
      }
      if (event.delta?.type === 'input_json_delta') {
        block.inputJson += event.delta.partial_json ?? ''
      }
    }
  })

  const assistantContent: AnthropicContentBlock[] = []
  const toolCalls: AiProviderToolCall[] = []
  for (const [, block] of [...blocks.entries()].sort(([left], [right]) => left - right)) {
    if (block.type === 'text') {
      assistantContent.push({ type: 'text', text: block.text })
      continue
    }
    const input = block.inputJson
      ? (JSON.parse(block.inputJson) as Record<string, unknown>)
      : block.input
    assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input })
    toolCalls.push({
      id: block.id,
      name: block.name,
      arguments: JSON.stringify(input)
    })
  }
  return { content, responseId, assistantContent, toolCalls }
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const

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
    signal: AbortSignal,
    executeTool?: AiProviderToolExecutor
  ): Promise<AiProviderTurnResult> {
    if (!apiKey) throw new Error('请先在 AI 助手的服务设置中保存 API Key')
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const messages: AnthropicMessage[] = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content
      }))
    if (request.images?.length) {
      const target = [...messages].reverse().find((message) => message.role === 'user')
      if (target) {
        const text = typeof target.content === 'string' ? target.content : ''
        target.content = [
          { type: 'text', text },
          ...request.images.map((image) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: image.mediaType, data: image.data }
          }))
        ]
      }
    }
    if (!request.tools?.length) {
      const result = await requestRound(
        apiKey,
        request.model,
        messages,
        system,
        signal,
        undefined,
        emit
      )
      return completed(result.content, result.responseId)
    }
    if (!executeTool) throw new Error('Anthropic 工具执行器未配置')

    let responseId: string | undefined
    let totalToolCalls = 0
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const selection = await requestRound(
        apiKey,
        request.model,
        messages,
        system,
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
      messages.push({ role: 'assistant', content: selection.assistantContent })
      const outputs = await executeToolCalls(selection.toolCalls, executeTool, signal)
      messages.push({
        role: 'user',
        content: outputs.map(({ call, output }) => ({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          content: output
        }))
      })
    }

    const answer = await requestRound(
      apiKey,
      request.model,
      messages,
      system,
      signal,
      undefined,
      emit
    )
    return completed(answer.content, answer.responseId ?? responseId)
  }
}
