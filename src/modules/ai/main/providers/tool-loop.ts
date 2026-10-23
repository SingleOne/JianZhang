import type { AiProviderToolCall, AiProviderToolExecutor } from '../../shared/types'

export const MAX_TOOL_CALLS_PER_ROUND = 8
export const MAX_TOOL_ROUNDS = 8
export const MAX_TOTAL_TOOL_CALLS = 32

export const TOOL_COMPLETION_INSTRUCTION =
  '本条消息的资料读取阶段已结束。请停止调用工具，仅根据已经取得的资料直接完成回答，保留来源引用。未执行的调用不代表已取得数据，不得编造；仅在影响结论时简要说明尚未核实的内容，无需解释内部调用次数或额度。'

export async function executeToolCalls(
  calls: AiProviderToolCall[],
  executeTool: AiProviderToolExecutor,
  signal: AbortSignal,
  currentTotal: number
): Promise<{
  outputs: Array<{ call: AiProviderToolCall; output: string }>
  totalCalls: number
  limitReached: boolean
}> {
  for (const call of calls) {
    if (!call.id || !call.name) throw new Error('模型返回的工具调用缺少 id 或 name')
  }
  const allowedCalls = Math.min(
    calls.length,
    MAX_TOOL_CALLS_PER_ROUND,
    Math.max(0, MAX_TOTAL_TOOL_CALLS - currentTotal)
  )
  // Every requested call needs a matching result, including calls outside the remaining budget.
  const outputs = await Promise.all(
    calls.map(async (call, index) => ({
      call,
      output:
        index < allowedCalls
          ? await executeTool(call, signal)
          : JSON.stringify({
              ok: false,
              error: `此调用未执行。${TOOL_COMPLETION_INSTRUCTION}`
            })
    }))
  )
  const totalCalls = currentTotal + allowedCalls
  return {
    outputs,
    totalCalls,
    limitReached: allowedCalls < calls.length || totalCalls >= MAX_TOTAL_TOOL_CALLS
  }
}
