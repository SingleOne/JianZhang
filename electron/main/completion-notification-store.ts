import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppCompletionNotification } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

const MAX_NOTIFICATIONS = 100
const STOCK_TARGETS: readonly string[] = [
  'reports',
  'corporate-actions',
  'ai-short-term',
  'ai-long-term',
  't-advice'
]

function normalize(
  notifications: readonly AppCompletionNotification[]
): AppCompletionNotification[] {
  return notifications
    .filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.message === 'string' &&
        typeof item.createdAt === 'string' &&
        (item.target === 'corporate-action-center'
          ? item.quoteId === undefined
          : typeof item.quoteId === 'string' && STOCK_TARGETS.includes(item.target))
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_NOTIFICATIONS)
}

export class CompletionNotificationStore {
  private readonly filePath: string

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, 'completion-notifications.json')
  }

  load(): AppCompletionNotification[] {
    if (!existsSync(this.filePath)) return []
    try {
      const saved = JSON.parse(readFileSync(this.filePath, 'utf8')) as AppCompletionNotification[]
      return Array.isArray(saved) ? normalize(saved) : []
    } catch {
      return []
    }
  }

  save(notifications: readonly AppCompletionNotification[]): AppCompletionNotification[] {
    const saved = normalize(notifications)
    atomicWriteJsonSync(this.filePath, saved)
    return saved
  }
}
