import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompletionNotificationStore } from './completion-notification-store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('CompletionNotificationStore', () => {
  it('persists, orders and restores completion notifications', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-notifications-'))
    directories.push(directory)
    const store = new CompletionNotificationStore(directory)
    store.save([
      {
        id: 'older',
        quoteId: '1.600519',
        target: 'reports',
        message: '旧通知',
        createdAt: '2026-08-12T00:00:00.000Z'
      },
      {
        id: 'newer',
        quoteId: '0.300750',
        target: 'ai-long-term',
        message: '新通知',
        createdAt: '2026-08-13T00:00:00.000Z'
      }
    ])

    expect(new CompletionNotificationStore(directory).load().map((item) => item.id)).toEqual([
      'newer',
      'older'
    ])
    expect(readFileSync(join(directory, 'completion-notifications.json'), 'utf8')).toContain(
      '新通知'
    )
  })

  it('returns an empty list for damaged data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-notifications-'))
    directories.push(directory)
    writeFileSync(join(directory, 'completion-notifications.json'), '{broken', 'utf8')

    expect(new CompletionNotificationStore(directory).load()).toEqual([])
  })
})
