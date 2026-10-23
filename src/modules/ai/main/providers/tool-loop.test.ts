import { describe, expect, it, vi } from 'vitest'
import type { AiProviderToolCall } from '../../shared/types'
import { executeToolCalls } from './tool-loop'

function calls(count: number): AiProviderToolCall[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `call-${index + 1}`,
    name: 'read_stock_data',
    arguments: '{}'
  }))
}

describe('tool call budget', () => {
  it('allows more than eight calls across rounds while preserving results', async () => {
    const execute = vi.fn(async (call: AiProviderToolCall) => `data:${call.id}`)
    const signal = new AbortController().signal
    const first = await executeToolCalls(calls(6), execute, signal, 0)
    const second = await executeToolCalls(calls(6), execute, signal, first.totalCalls)

    expect(execute).toHaveBeenCalledTimes(12)
    expect(second.totalCalls).toBe(12)
    expect(second.limitReached).toBe(false)
    expect(second.outputs[5].output).toBe('data:call-6')
  })

  it('returns a result for every requested call when a round exceeds its budget', async () => {
    const requested = calls(10)
    const execute = vi.fn(async () => 'actual data')
    const batch = await executeToolCalls(requested, execute, new AbortController().signal, 0)

    expect(execute).toHaveBeenCalledTimes(8)
    expect(batch.totalCalls).toBe(8)
    expect(batch.limitReached).toBe(true)
    expect(batch.outputs.map(({ call }) => call.id)).toEqual(requested.map((call) => call.id))
    expect(batch.outputs[7].output).toBe('actual data')
    for (const skipped of batch.outputs.slice(8)) {
      expect(JSON.parse(skipped.output)).toMatchObject({
        ok: false,
        error: expect.stringContaining('此调用未执行')
      })
    }
  })

  it('uses only the remaining total budget and closes the tool phase', async () => {
    const execute = vi.fn(async () => 'actual data')
    const batch = await executeToolCalls(calls(4), execute, new AbortController().signal, 30)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(batch.totalCalls).toBe(32)
    expect(batch.limitReached).toBe(true)
    expect(batch.outputs).toHaveLength(4)
    expect(batch.outputs.slice(0, 2).map(({ output }) => output)).toEqual([
      'actual data',
      'actual data'
    ])
    expect(JSON.parse(batch.outputs[2].output).ok).toBe(false)
    expect(JSON.parse(batch.outputs[3].output).ok).toBe(false)
  })

  it('finishes on the exact total boundary and does not share budget across messages', async () => {
    const execute = vi.fn(async () => 'actual data')
    const signal = new AbortController().signal
    const finished = await executeToolCalls(calls(8), execute, signal, 24)
    const nextMessage = await executeToolCalls(calls(8), execute, signal, 0)

    expect(finished.limitReached).toBe(true)
    expect(finished.outputs.every(({ output }) => output === 'actual data')).toBe(true)
    expect(nextMessage.totalCalls).toBe(8)
    expect(nextMessage.limitReached).toBe(false)
  })

  it('preserves cancellation instead of turning it into a budget result', async () => {
    const controller = new AbortController()
    const error = new DOMException('Aborted', 'AbortError')
    controller.abort()
    const execute = vi.fn(async () => {
      throw error
    })

    await expect(executeToolCalls(calls(1), execute, controller.signal, 0)).rejects.toBe(error)
    expect(execute).toHaveBeenCalledWith(calls(1)[0], controller.signal)
  })
})
