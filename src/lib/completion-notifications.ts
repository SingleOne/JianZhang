import type { AppCompletionNotification, StockDetailNavigationTarget } from '../shared/types'

export type { AppCompletionNotification, CompletionNotificationTarget } from '../shared/types'

export const APP_COMPLETION_NOTIFICATION_EVENT = 'app:completion-notification'

export function subscribeCompletionNotifications(
  receive: (notification: AppCompletionNotification) => void
): () => void {
  const listener = (event: Event) => {
    const notification = (event as CustomEvent<AppCompletionNotification>).detail
    if (notification) receive(notification)
  }
  window.addEventListener(APP_COMPLETION_NOTIFICATION_EVENT, listener)
  return () => window.removeEventListener(APP_COMPLETION_NOTIFICATION_EVENT, listener)
}

export interface StockDetailNavigationRequest {
  id: string
  quoteId: string
  target: StockDetailNavigationTarget
  scrollAlignment?: 'sticky-top'
}

let notificationSequence = 0

type CompletionNotificationInput = Pick<AppCompletionNotification, 'quoteId' | 'target' | 'message'>

export function emitCompletionNotification(notification: CompletionNotificationInput): void {
  notificationSequence += 1
  const createdAt = new Date().toISOString()
  window.dispatchEvent(
    new CustomEvent<AppCompletionNotification>(APP_COMPLETION_NOTIFICATION_EVENT, {
      detail: {
        ...notification,
        id: `${createdAt}-${notificationSequence}`,
        createdAt
      }
    })
  )
}
