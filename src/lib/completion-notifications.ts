import type { AppCompletionNotification, StockDetailNavigationTarget } from '../shared/types'

export type { AppCompletionNotification, CompletionNotificationTarget } from '../shared/types'

export const APP_COMPLETION_NOTIFICATION_EVENT = 'app:completion-notification'

export interface StockDetailNavigationRequest {
  id: string
  quoteId: string
  target: StockDetailNavigationTarget
  scrollAlignment?: 'sticky-top'
}

let notificationSequence = 0

type CompletionNotificationInput =
  | Pick<
      Extract<AppCompletionNotification, { target: 'corporate-action-center' }>,
      'target' | 'message'
    >
  | Pick<
      Exclude<AppCompletionNotification, { target: 'corporate-action-center' }>,
      'quoteId' | 'target' | 'message'
    >

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
