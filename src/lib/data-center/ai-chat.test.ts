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
  let error: (event: { message: AiMessage }) => void = () => undefined
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
    onChatError: vi.fn((listener: typeof error) => {
      error = listener
      return unsubscribe
    }),
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
    advanceFrame: (timestamp: number) => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(timestamp))
    },
    delta: (event: AiChatDeltaEvent) => delta(event),
    complete: (value: AiMessage) => complete({ message: value }),
    error: (value: AiMessage) => error({ message: value }),
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

  it('gradually displays a burst between arrivals while preserving Unicode and history identity', async () => {
    const center = await setup()
    const resource = center.conversationResource('A')!
    const history = message('history', 'assistant', 'earlier answer')
    resource.update({
      conversation: { id: 'A' } as AiConversation,
      messages: [history, { ...message('answer', 'assistant', ''), status: 'pending' }]
    })
    const release = center.retainChatUpdates()
    const text = '股票🙂ABCDE'.repeat(4)
    center.delta({ conversationId: 'A', messageId: 'answer', delta: text })
    center.advanceFrame(0)
    const first = resource.getSnapshot().data!.messages[1].content
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(text.length)
    expect(Array.from(first).some((character) => /^[\uD800-\uDFFF]$/.test(character))).toBe(false)
    center.advanceFrame(16)
    expect(resource.getSnapshot().data!.messages[1].content).toBe(first)
    center.advanceFrame(40)
    expect(resource.getSnapshot().data!.messages[1].content.length).toBeGreaterThan(first.length)
    for (let time = 80; time <= 1000 && center.frames.size; time += 40) {
      center.advanceFrame(time)
    }
    expect(resource.getSnapshot().data!.messages[1].content).toBe(text)
    expect(resource.getSnapshot().data!.messages[0]).toBe(history)
    expect(center.frames.size).toBe(0)
    release()
  })

  it('replaces a previous tool round and discards its buffered tail before completion', async () => {
    const center = await setup()
    const resource = center.conversationResource('A')!
    resource.update({
      conversation: { id: 'A' } as AiConversation,
      messages: [{ ...message('answer', 'assistant', ''), status: 'pending' }]
    })
    const release = center.retainChatUpdates()
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'old round '.repeat(20) })
    center.advanceFrame(0)
    center.delta({ conversationId: 'A', messageId: 'answer', delta: '', replace: true })
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'new round' })
    center.advanceFrame(40)
    expect(resource.getSnapshot().data!.messages[0].content).toBe('new')
    const answer = message('answer', 'assistant', 'new round with final citations')
    center.complete(answer)
    for (let time = 80; time <= 200 && center.frames.size; time += 40) {
      center.advanceFrame(time)
    }
    expect(resource.getSnapshot().data!.messages).toEqual([answer])
    release()
  })

  it('limits render frequency across small consecutive chunks after the buffer drains', async () => {
    const center = await setup()
    const resource = center.conversationResource('A')!
    resource.update({
      conversation: { id: 'A' } as AiConversation,
      messages: [{ ...message('answer', 'assistant', ''), status: 'pending' }]
    })
    const release = center.retainChatUpdates()
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'A' })
    center.advanceFrame(0)
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'B' })
    center.advanceFrame(16)
    expect(resource.getSnapshot().data!.messages[0].content).toBe('A')
    center.delta({ conversationId: 'A', messageId: 'answer', delta: 'C' })
    center.advanceFrame(40)
    expect(resource.getSnapshot().data!.messages[0].content).toBe('AB')
    center.advanceFrame(80)
    expect(resource.getSnapshot().data!.messages[0].content).toBe('ABC')
    release()
  })

  it.each(['stopped', 'error'] as const)(
    'uses the authoritative %s message over queued text',
    async (status) => {
      const center = await setup()
      const resource = center.conversationResource('A')!
      resource.update({
        conversation: { id: 'A' } as AiConversation,
        messages: [{ ...message('answer', 'assistant', ''), status: 'pending' }]
      })
      const release = center.retainChatUpdates()
      center.delta({ conversationId: 'A', messageId: 'answer', delta: 'buffered '.repeat(30) })
      center.advanceFrame(0)
      const answer = { ...message('answer', 'assistant', 'actual partial answer'), status }
      center.error(answer)
      center.advanceFrame(40)
      expect(resource.getSnapshot().data!.messages).toEqual([answer])
      release()
    }
  )
})
