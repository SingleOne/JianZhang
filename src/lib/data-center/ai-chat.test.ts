import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiApi,
  AiChatDeltaEvent,
  AiChatStartResult,
  AiConversation,
  AiMessage
} from '../../modules/ai/shared/types'

vi.mock('../api', async () => {
  const { createResourceCache } = await import('./resource')
  const cache = createResourceCache()
  return {
    dataCenter: {
      details: { resource: cache.get, invalidate: cache.invalidate, dispose: cache.dispose }
    }
  }
})

function message(id: string, role: AiMessage['role'], content: string): AiMessage {
  return {
    id,
    conversationId: 'A',
    role,
    content,
    status: 'completed',
    createdAt: '2026-11-05T00:00:00Z'
  }
}
async function setup() {
  let delta: (event: AiChatDeltaEvent) => void = () => undefined
  let complete: (event: { message: AiMessage }) => void = () => undefined
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  const unsubscribe = vi.fn()
  let resolveSend!: (value: AiChatStartResult) => void
  const sent = new Promise<AiChatStartResult>((done) => {
    resolveSend = done
  })
  const api = {
    onChatDelta: vi.fn((listener: typeof delta) => {
      delta = listener
      return unsubscribe
    }),
    onChatCompleted: vi.fn((listener: typeof complete) => {
      complete = listener
      return unsubscribe
    }),
    onChatError: vi.fn(() => unsubscribe),
    sendChat: vi.fn(() => sent),
    getConversation: vi.fn(async (id: string) => ({
      conversation: { id } as AiConversation,
      messages: []
    })),
    listConversations: vi.fn().mockResolvedValue([])
  }
  vi.stubGlobal('window', {
    aiApi: api as unknown as AiApi,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback)
      return sequence
    },
    cancelAnimationFrame: (id: number) => frames.delete(id)
  })
  const center = await import('./ai-chat')
  await center.conversationResource('A')!.request()
  await center.conversationResource('B')!.request()
  return {
    ...center,
    api,
    frames,
    delta: (event: AiChatDeltaEvent) => delta(event),
    complete: (value: AiMessage) => complete({ message: value }),
    resolveSend,
    unsubscribe
  }
}

beforeEach(() => vi.resetModules())
afterEach(async () => {
  const { dataCenter } = await import('../api')
  dataCenter.details.dispose()
  vi.unstubAllGlobals()
})

describe('shared AI conversations', () => {
  it('preserves an early completed answer and inserts the late user message before it', async () => {
    const center = await setup()
    const release = center.retainChatUpdates()
    const pending = center.aiChatApi!.sendChat({ conversationId: 'A', content: 'question' })
    const user = message('user', 'user', 'question')
    const answer = message('answer', 'assistant', 'finished')
    center.complete(answer)
    center.resolveSend({
      userMessage: user,
      assistantMessage: { ...answer, content: '', status: 'pending' }
    })
    await pending
    expect(center.conversationResource('A')!.getSnapshot().data?.messages).toEqual([user, answer])
    expect(center.conversationResource('B')!.getSnapshot().data?.messages).toEqual([])
    release()
  })

  it('buffers early deltas until the send response provides its message and shares one listener set', async () => {
    const center = await setup()
    const releaseA = center.retainChatUpdates()
    const releaseB = center.retainChatUpdates()
    expect(center.api.onChatDelta).toHaveBeenCalledTimes(1)
    const pending = center.aiChatApi!.sendChat({ conversationId: 'A', content: 'question' })
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'partial' })
    for (const frame of [...center.frames.values()]) frame(0)
    center.resolveSend({
      userMessage: message('user', 'user', 'question'),
      assistantMessage: { ...message('answer', 'assistant', ''), status: 'pending' }
    })
    await pending
    expect(center.conversationResource('A')!.getSnapshot().data?.messages[1].content).toBe(
      'partial'
    )
    releaseA()
    expect(center.unsubscribe).not.toHaveBeenCalled()
    releaseB()
    expect(center.unsubscribe).toHaveBeenCalledTimes(3)
    expect(center.frames.size).toBe(0)
  })
})
