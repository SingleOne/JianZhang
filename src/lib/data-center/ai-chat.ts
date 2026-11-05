import { dataCenter } from '../api'
import type { AiApi, AiChatDeltaEvent, AiMessage } from '../../modules/ai/shared/types'

const transport = window.aiApi
let flushChatDeltas: (() => void) | undefined
export const conversationListResource = (query = '') =>
  transport
    ? dataCenter.details.resource(
        JSON.stringify(['ai:conversations', query]),
        () => transport.listConversations(query),
        { quoteId: '', category: 'ai-conversations', maxAge: 0 }
      )
    : undefined
export const conversationResource = (id: string) =>
  transport
    ? dataCenter.details.resource(
        JSON.stringify(['ai:conversation', id]),
        () => transport.getConversation(id),
        { quoteId: '', category: 'ai-messages', maxAge: 0 }
      )
    : undefined

function mergeMessages(id: string, incoming: AiMessage[], onlyMissing = false) {
  const resource = conversationResource(id)!
  const current = resource.getSnapshot().data
  if (!current) {
    resource.invalidate()
    return
  }
  const messages = [...current.messages]
  for (const [incomingIndex, message] of incoming.entries()) {
    const index = messages.findIndex((item) => item.id === message.id)
    if (index < 0) {
      const following = incoming
        .slice(incomingIndex + 1)
        .find((item) => messages.some((saved) => saved.id === item.id))
      const insertAt = following
        ? messages.findIndex((item) => item.id === following.id)
        : messages.length
      messages.splice(insertAt, 0, message)
    } else if (!onlyMissing) messages[index] = message
  }
  resource.update({ ...current, messages })
}

const invalidateLists = () => dataCenter.details.invalidate(undefined, ['ai-conversations'])
export const aiChatApi: AiApi | undefined = transport
  ? {
      ...transport,
      listConversations: (query) => conversationListResource(query)!.request(),
      getConversation: (id) => conversationResource(id)!.request(),
      async createConversation(input) {
        const conversation = await transport.createConversation(input)
        conversationResource(conversation.id)!.update({ conversation, messages: [] })
        invalidateLists()
        return conversation
      },
      async renameConversation(id, title) {
        const conversation = await transport.renameConversation(id, title)
        const resource = conversationResource(id)!
        const current = resource.getSnapshot().data
        if (current) resource.update({ ...current, conversation })
        invalidateLists()
        return conversation
      },
      async deleteConversation(id) {
        await transport.deleteConversation(id)
        conversationResource(id)!.update(null)
        invalidateLists()
      },
      async clearConversations() {
        await transport.clearConversations()
        dataCenter.details.invalidate(undefined, ['ai-conversations', 'ai-messages'])
      },
      async sendChat(input) {
        const result = await transport.sendChat(input)
        // A completion event can beat the IPC response; never replace it with its initial placeholder.
        mergeMessages(input.conversationId, [result.userMessage, result.assistantMessage], true)
        flushChatDeltas?.()
        invalidateLists()
        return result
      },
      async retryChat(id, messageId) {
        const result = await transport.retryChat(id, messageId)
        mergeMessages(id, [result.userMessage, result.assistantMessage], true)
        flushChatDeltas?.()
        invalidateLists()
        return result
      }
    }
  : undefined

let consumers = 0
let stop: (() => void) | undefined
export function retainChatUpdates() {
  if (!transport) return () => undefined
  consumers += 1
  if (consumers === 1) {
    const deltas = new Map<string, AiChatDeltaEvent>()
    let frame: number | undefined
    const flush = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      frame = undefined
      const updates = [...deltas.values()]
      const ids = new Set(updates.map((event) => event.conversationId))
      for (const id of ids) {
        const resource = conversationResource(id)!
        const current = resource.getSnapshot().data
        if (!current) continue
        const messages = current.messages.map((message) => {
          const update = updates.find(
            (event) => event.conversationId === id && event.messageId === message.id
          )
          if (update) deltas.delete(message.id)
          return update
            ? {
                ...message,
                content: update.replace ? update.delta : `${message.content}${update.delta}`,
                status: 'streaming' as const,
                activity: update.activity ?? ('thinking' as const)
              }
            : message
        })
        resource.update({ ...current, messages })
      }
    }
    flushChatDeltas = flush
    const complete = ({ message }: { message: AiMessage }) => {
      deltas.delete(message.id)
      mergeMessages(message.conversationId, [message])
      invalidateLists()
    }
    const subscriptions = [
      transport.onChatDelta((event) => {
        const previous = deltas.get(event.messageId)
        deltas.set(event.messageId, {
          ...event,
          delta: event.replace ? event.delta : `${previous?.delta ?? ''}${event.delta}`,
          replace: event.replace || previous?.replace,
          activity: event.activity ?? previous?.activity
        })
        if (frame === undefined) frame = window.requestAnimationFrame(flush)
      }),
      transport.onChatCompleted(complete),
      transport.onChatError(complete)
    ]
    stop = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      flush()
      deltas.clear()
      flushChatDeltas = undefined
      for (const unsubscribe of subscriptions) unsubscribe()
    }
  }
  return () => {
    consumers -= 1
    if (!consumers) {
      stop?.()
      stop = undefined
    }
  }
}
