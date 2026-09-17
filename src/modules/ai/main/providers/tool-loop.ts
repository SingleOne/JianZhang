import type { AiProviderToolCall, AiProviderToolExecutor } from '../../shared/types'

export const MAX_TOOL_CALLS_PER_ROUND = 4
export const MAX_TOOL_ROUNDS = 3
export const MAX_TOTAL_TOOL_CALLS = 8

export function countToolCalls(calls: AiProviderToolCall[], currentTotal: number): number {
  if (calls.length > MAX_TOOL_CALLS_PER_ROUND) {
    throw new Error(`模型一次请求了过多工具调用，最多允许 ${MAX_TOOL_CALLS_PER_ROUND} 个`)
  }
  const nextTotal = currentTotal + calls.length
  if (nextTotal > MAX_TOTAL_TOOL_CALLS) {
    throw new Error(`模型累计请求了过多工具调用，最多允许 ${MAX_TOTAL_TOOL_CALLS} 个`)
  }
  for (const call of calls) {
    if (!call.id || !call.name) throw new Error('模型返回的工具调用缺少 id 或 name')
  }
  return nextTotal
}

export async function executeToolCalls(
  calls: AiProviderToolCall[],
  executeTool: AiProviderToolExecutor,
  signal: AbortSignal
): Promise<Array<{ call: AiProviderToolCall; output: string }>> {
  return Promise.all(calls.map(async (call) => ({ call, output: await executeTool(call, signal) })))
}
