import type { AppCompletionNotification, CompletionNotificationTarget } from '../shared/types'

export type { AppCompletionNotification, CompletionNotificationTarget } from '../shared/types'

export const APP_COMPLETION_NOTIFICATION_EVENT = 'app:completion-notification'

export interface StockDetailNavigationRequest {
  id: string
  quoteId: string
  target: CompletionNotificationTarget
}

let notificationSequence = 0

export function emitCompletionNotification(
  notification: Pick<AppCompletionNotification, 'quoteId' | 'target' | 'message'>
): void {
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
