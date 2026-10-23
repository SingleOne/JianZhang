import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProviderToolCall } from '../../shared/types'
import { streamOpenAiChatCompletions } from './openai-chat-completions'

function response(delta: object): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
}

function toolResponse(round: number, count: number): Response {
  return response({
    reasoning_content: `reasoning-${round}`,
    tool_calls: Array.from({ length: count }, (_, index) => ({
      index,
      id: `round-${round}-call-${index}`,
      function: { name: 'read_stock_data', arguments: '{}' }
    }))
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('Chat Completions tool completion', () => {
  it.each([
    { label: 'total call limit', rounds: 4, callsPerRound: 8, executed: 32 },
    { label: 'round limit', rounds: 8, callsPerRound: 1, executed: 8 },
    { label: 'oversized batch', rounds: 1, callsPerRound: 10, executed: 8 }
  ])('answers from collected data at the $label', async ({ rounds, callsPerRound, executed }) => {
    const fetchMock = vi.fn<typeof fetch>()
    for (let round = 0; round < rounds; round++) {
      fetchMock.mockResolvedValueOnce(toolResponse(round, callsPerRound))
    }
    fetchMock.mockResolvedValueOnce(response({ content: '根据已有资料给出的回答。[资料1]' }))
    vi.stubGlobal('fetch', fetchMock)
    const executeTool = vi.fn(async (call: AiProviderToolCall) => `actual:${call.id}`)
    const emit = vi.fn()

    const result = await streamOpenAiChatCompletions({
      apiBase: 'https://provider.example',
      apiKey: 'test-key',
      label: 'Test',
      request: {
        model: 'test-model',
        messages: [{ role: 'user', content: '比较股票资料' }],
        tools: [{ name: 'read_stock_data', description: '读取资料', inputSchema: {} }]
      },
      signal: new AbortController().signal,
      emit,
      executeTool
    })

    expect(executeTool).toHaveBeenCalledTimes(executed)
    expect(fetchMock).toHaveBeenCalledTimes(rounds + 1)
    expect(result.content).toBe('根据已有资料给出的回答。[资料1]')
    expect(emit).toHaveBeenCalledWith(result.content)

    const finalBody = JSON.parse(String(fetchMock.mock.calls[rounds][1]?.body)) as {
      tool_choice: string
      messages: Array<{
        role: string
        content: string
        reasoning_content?: string
        tool_call_id?: string
        tool_calls?: Array<{ id: string }>
      }>
    }
    expect(finalBody.tool_choice).toBe('none')
    expect(finalBody.messages.at(-1)?.content).toContain('仅根据已经取得的资料直接完成回答')
    const assistantMessages = finalBody.messages.filter((message) => message.tool_calls)
    expect(assistantMessages[0].reasoning_content).toBe('reasoning-0')
    const requestedIds = assistantMessages.flatMap(
      (message) => message.tool_calls?.map((call) => call.id) ?? []
    )
    const toolResults = finalBody.messages.filter((message) => message.role === 'tool')
    expect(toolResults.map((message) => message.tool_call_id)).toEqual(requestedIds)
    if (requestedIds.length > executed) {
      expect(JSON.parse(toolResults.at(-1)!.content).ok).toBe(false)
    }
  })
})
