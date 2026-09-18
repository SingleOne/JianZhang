import type {
  AiProviderRequest,
  AiProviderRequestMessage,
  AiProviderTool,
  AiProviderToolCall,
  AiProviderToolExecutor,
  AiProviderTurnResult
} from '../../shared/types'
import { completed, ensureResponse, readSse } from './provider'
import { countToolCalls, executeToolCalls, MAX_TOOL_ROUNDS } from './tool-loop'

interface OpenAiToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

type OpenAiChatMessage =
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

interface OpenAiChatRoundResult {
  content: string
  responseId?: string
  toolCalls: AiProviderToolCall[]
}

interface OpenAiChatOptions {
  apiBase: string
  apiKey: string
  label: string
  request: AiProviderRequest
  emit: (delta: string) => void
  signal: AbortSignal
  executeTool?: AiProviderToolExecutor
  includeUsage?: boolean
}

function toOpenAiTools(tools: AiProviderTool[]) {
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
  options: OpenAiChatOptions,
  messages: OpenAiChatMessage[],
  tools: AiProviderTool[] | undefined,
  emit: ((delta: string) => void) | undefined,
  toolChoice: 'auto' | 'none' = 'auto'
): Promise<OpenAiChatRoundResult> {
  const response = await fetch(`${options.apiBase}/chat/completions`, {
    method: 'POST',
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.request.model,
      messages,
      stream: true,
      ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...(tools?.length ? { tools: toOpenAiTools(tools), tool_choice: toolChoice } : {})
    })
  })
  await ensureResponse(response)
  let content = ''
  let responseId: string | undefined
  const toolCalls = new Map<number, OpenAiToolCallAccumulator>()
  await readSse(response, (payload) => {
    if (payload === '[DONE]') return
    const chunk = JSON.parse(payload) as {
      id?: string
      error?: { message?: string }
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
    if (chunk.error) throw new Error(chunk.error.message ?? `${options.label} 响应失败`)
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

export async function streamOpenAiChatCompletions(
  options: OpenAiChatOptions
): Promise<AiProviderTurnResult> {
  if (options.request.images?.length) {
    throw new Error(`${options.label} 当前未启用图片输入，请切换到支持图片的 Provider`)
  }
  const messages: OpenAiChatMessage[] = [...options.request.messages]
  if (!options.request.tools?.length) {
    const result = await requestRound(options, messages, undefined, options.emit)
    return completed(result.content, result.responseId)
  }
  if (!options.executeTool) throw new Error(`${options.label} 工具执行器未配置`)

  let responseId: string | undefined
  let totalToolCalls = 0
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const selection = await requestRound(options, messages, options.request.tools, undefined)
    responseId = selection.responseId ?? responseId
    if (selection.toolCalls.length === 0) {
      if (selection.content) options.emit(selection.content)
      return completed(selection.content, responseId)
    }
    totalToolCalls = countToolCalls(selection.toolCalls, totalToolCalls)
    messages.push({
      role: 'assistant',
      content: selection.content || null,
      tool_calls: selection.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    })
    const outputs = await executeToolCalls(selection.toolCalls, options.executeTool, options.signal)
    messages.push(
      ...outputs.map(({ call, output }) => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: output
      }))
    )
  }

  const answer = await requestRound(options, messages, options.request.tools, options.emit, 'none')
  return completed(answer.content, answer.responseId ?? responseId)
}
