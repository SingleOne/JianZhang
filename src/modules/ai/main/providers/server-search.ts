import { BROWSER_USER_AGENT } from '../../../../../electron/main/http-user-agent'
import type {
  AiProviderRequest,
  AiProviderToolCall,
  AiProviderToolExecutor,
  AiProviderTurnResult
} from '../../shared/types'
import { supportsImageUnderstanding } from '../../shared/model-capabilities'
import { OpenAiCompatibleProvider } from './openai-compatible'
import { completed, ensureResponse, readSse } from './provider'
import { executeToolCalls, MAX_TOOL_ROUNDS, TOOL_COMPLETION_INSTRUCTION } from './tool-loop'

interface UrlCitation {
  type: string
  url: string
  title?: string
  start_index: number
  end_index: number
}

interface ResponseOutputItem {
  type: string
  id?: string
  status?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type: string; text?: string; annotations?: UrlCitation[] }>
  action?: { type?: string; sources?: Array<{ url: string; title?: string }> }
}

interface ResponseRound {
  responseId: string
  content: string
  output: ResponseOutputItem[]
  toolCalls: AiProviderToolCall[]
}

interface ServerSearchConfig {
  id: 'kimi' | 'grok'
  label: string
  apiBase: string
  modelsUrl?: string
  filterModel?: (model: { id: string }) => boolean
}

// Kimi is stateless: replay every output item, including opaque reasoning, without rewriting it.
// Grok continues tool rounds with previous_response_id instead.
export class ServerSearchProvider extends OpenAiCompatibleProvider {
  constructor(private readonly searchConfig: ServerSearchConfig) {
    super(searchConfig)
  }

  override async streamChat(
    apiKey: string | undefined,
    request: AiProviderRequest,
    emit: (delta: string) => void,
    signal: AbortSignal,
    executeTool?: AiProviderToolExecutor
  ): Promise<AiProviderTurnResult> {
    if (this.id === 'kimi' && !request.webSearch)
      return super.streamChat(apiKey, request, emit, signal, executeTool)
    if (!apiKey) throw new Error('请先在 AI 助手的服务设置中保存 API Key')
    if (request.images?.length && !supportsImageUnderstanding(this.id, request.model))
      throw new Error(`当前模型 ${request.model} 不支持图片理解，请切换支持的模型`)

    const instructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const messages = request.messages.filter((message) => message.role !== 'system')
    const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
    let input: object[] = messages.map((message, index) => ({
      role: message.role,
      content:
        index === lastUserIndex && request.images?.length
          ? [
              { type: 'input_text', text: message.content },
              ...request.images.map((image) => ({
                type: 'input_image',
                image_url: `data:${image.mediaType};base64,${image.data}`
              }))
            ]
          : message.content
    }))
    let responseId: string | undefined
    let totalCalls = 0
    let toolsFinished = false
    const sources = new Map<string, { url: string; title?: string }>()
    request.webSearch?.onActivity('thinking')
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const allowTools = round < MAX_TOOL_ROUNDS && !toolsFinished
      const streaming = !request.webSearch && (!request.tools?.length || !allowTools)
      const result = await this.requestRound(
        apiKey,
        request,
        allowTools ? instructions : `${instructions}\n\n${TOOL_COMPLETION_INSTRUCTION}`,
        input,
        signal,
        allowTools,
        streaming ? emit : undefined,
        responseId
      )
      responseId = result.responseId
      for (const item of result.output) {
        for (const source of item.action?.sources ?? []) sources.set(source.url, source)
        for (const part of item.content ?? []) {
          for (const annotation of part.annotations ?? []) {
            if (annotation.type === 'url_citation')
              sources.set(annotation.url, {
                url: annotation.url,
                title: /^\d+$/.test(annotation.title ?? '') ? undefined : annotation.title
              })
          }
        }
      }
      if (!result.toolCalls.length) {
        const content = request.webSearch
          ? this.withSearchCitations(result, request.webSearch, sources)
          : result.content
        if (!streaming && content) emit(content)
        return completed(content, responseId)
      }
      if (!allowTools)
        throw new Error(`${this.searchConfig.label} 在工具调用结束后仍返回了工具请求`)
      if (!executeTool) throw new Error(`${this.searchConfig.label} 工具执行器未配置`)
      const batch = await executeToolCalls(result.toolCalls, executeTool, signal, totalCalls)
      totalCalls = batch.totalCalls
      toolsFinished = batch.limitReached
      const toolOutputs = batch.outputs.map(({ call, output }) => ({
        type: 'function_call_output',
        call_id: call.id,
        output
      }))
      input = this.id === 'kimi' ? [...input, ...result.output, ...toolOutputs] : toolOutputs
    }
    throw new Error('工具调用未能结束')
  }

  private async requestRound(
    apiKey: string,
    request: AiProviderRequest,
    instructions: string,
    input: object[],
    signal: AbortSignal,
    allowTools: boolean,
    emit?: (delta: string) => void,
    previousResponseId?: string
  ): Promise<ResponseRound> {
    const tools = allowTools
      ? [
          ...(request.tools ?? []).map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false
          })),
          ...(request.webSearch ? [{ type: 'web_search' }] : [])
        ]
      : []
    const response = await fetch(`${this.searchConfig.apiBase}/responses`, {
      method: 'POST',
      signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        instructions,
        input,
        stream: true,
        tools,
        ...(this.id === 'grok' && previousResponseId
          ? { previous_response_id: previousResponseId }
          : {}),
        ...(tools.length ? { tool_choice: 'auto' } : {}),
        ...(this.id === 'kimi' && request.webSearch && allowTools
          ? { include: ['web_search_call.action.sources'] }
          : {})
      })
    })
    await ensureResponse(response)
    let content = ''
    let responseId: string | undefined
    let finished = false
    let output: ResponseOutputItem[] = []
    await readSse(response, (payload) => {
      if (payload === '[DONE]') return
      const event = JSON.parse(payload) as {
        type?: string
        delta?: string
        message?: string
        item?: ResponseOutputItem
        error?: { message?: string }
        response?: {
          id?: string
          status?: string
          output?: ResponseOutputItem[]
          error?: { message?: string }
          incomplete_details?: { reason?: string }
        }
      }
      if (
        event.type === 'error' ||
        event.type === 'response.failed' ||
        event.type === 'response.incomplete'
      )
        throw new Error(
          event.error?.message ??
            event.response?.error?.message ??
            event.message ??
            `${this.searchConfig.label} 响应未完成${event.response?.incomplete_details?.reason ? `：${event.response.incomplete_details.reason}` : ''}`
        )
      if (event.type?.startsWith('response.web_search_call.'))
        request.webSearch?.onActivity(event.type.endsWith('.completed') ? 'thinking' : 'searching')
      if (event.item?.type === 'web_search_call')
        request.webSearch?.onActivity(
          event.item.status === 'completed'
            ? 'thinking'
            : event.item.action?.type === 'open_page'
              ? 'fetching'
              : 'searching'
        )
      if (event.type === 'response.output_text.delta' && event.delta) {
        content += event.delta
        emit?.(event.delta)
      }
      if (event.type === 'response.output_item.done' && event.item) output.push(event.item)
      if (event.type === 'response.completed') {
        if (
          event.response?.error ||
          (event.response?.status && event.response.status !== 'completed')
        )
          throw new Error(event.response.error?.message ?? `${this.searchConfig.label} 响应未完成`)
        finished = true
        responseId = event.response?.id
        output = event.response?.output ?? output
      }
    })
    if (!finished || !responseId) throw new Error(`${this.searchConfig.label} 响应中断，请重试`)
    const outputText = output
      .flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []))
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('')
    if (!content && outputText) emit?.(outputText)
    return {
      content: content || outputText,
      responseId,
      output,
      toolCalls: output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({
          id: item.call_id ?? '',
          name: item.name ?? '',
          arguments: item.arguments ?? ''
        }))
    }
  }

  private withSearchCitations(
    result: ResponseRound,
    search: NonNullable<AiProviderRequest['webSearch']>,
    sources: Map<string, { url: string; title?: string }>
  ): string {
    let hasInlineCitations = false
    const blocks = result.output
      .flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []))
      .filter((part) => part.type === 'output_text')
    const content = blocks.length
      ? blocks
          .map((block) => {
            let characters = [...(block.text ?? '')]
            for (const annotation of [...(block.annotations ?? [])].sort(
              (a, b) => b.end_index - a.end_index
            )) {
              if (annotation.type !== 'url_citation') continue
              const id = search.registerSource({
                url: annotation.url,
                title: /^\d+$/.test(annotation.title ?? '') ? undefined : annotation.title
              })
              if (
                !id ||
                !Number.isInteger(annotation.start_index) ||
                !Number.isInteger(annotation.end_index) ||
                annotation.start_index < 0 ||
                annotation.end_index < annotation.start_index ||
                annotation.end_index > characters.length
              )
                continue
              const span = characters.slice(annotation.start_index, annotation.end_index).join('')
              const start = /^\[\[\d+\]\]\(/.test(span)
                ? annotation.start_index
                : annotation.end_index
              characters = [
                ...characters.slice(0, start),
                ...`[${id}]`,
                ...characters.slice(annotation.end_index)
              ]
              hasInlineCitations = true
            }
            return characters.join('')
          })
          .join('')
      : result.content
    if (hasInlineCitations) return content
    const ids = [...sources.values()]
      .map((source) => search.registerSource(source))
      .filter((id) => id !== undefined)
    return ids.length
      ? `${content}\n\n搜索来源：${[...new Set(ids)].map((id) => `[${id}]`).join(' ')}`
      : content
  }
}
