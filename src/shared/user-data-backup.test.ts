import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState
} from './types'
import {
  JIANZHANG_USER_DATA_BACKUP_FORMAT,
  createUserDataBackupDocument,
  parseUserDataBackupDocument
} from './user-data-backup'

function state(): AppState {
  return {
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
    stockTradingBooks: {},
    corporateActionApplications: {}
  }
}

describe('user data backup document', () => {
  it('round trips user files and AI API keys', () => {
    const document = createUserDataBackupDocument(
      state(),
      '8.3.0',
      [
        { path: 'modules/ai/settings.json', content: '{"enabled":true}' },
        { path: 'modules/ai/conversations/index.json', content: '[]' }
      ],
      {
        openai: 'openai-key',
        deepseek: 'deepseek-key',
        gemini: 'gemini-key',
        anthropic: 'anthropic-key'
      }
    )

    expect(parseUserDataBackupDocument(document)).toMatchObject({
      format: JIANZHANG_USER_DATA_BACKUP_FORMAT,
      applicationVersion: '8.3.0',
      files: document.files,
      aiApiKeys: {
        openai: 'openai-key',
        deepseek: 'deepseek-key',
        gemini: 'gemini-key',
        anthropic: 'anthropic-key'
      }
    })
  })

  it('rejects files outside the managed user data paths', () => {
    const document = createUserDataBackupDocument(
      state(),
      '8.3.0',
      [{ path: 'modules/ai/conversations/../credentials.bin', content: 'secret' }],
      {}
    )

    expect(() => parseUserDataBackupDocument(document)).toThrow('备份中的文件信息无效')
  })

  it.each([1, 2])('reads format v%s backups while skipping excluded legacy data', (version) => {
    const retained = [
      { path: 'modules/ai/settings.json', content: '{"enabled":true}' },
      { path: 'modules/ai/conversations/index.json', content: '[]' },
      { path: 'modules/ai/snapshots/snapshot-1.json', content: '{}' }
    ]
    const document = createUserDataBackupDocument(
      state(),
      '19.0.1',
      [
        ...retained,
        { path: 'modules/ai/cache/interpretations.json', content: '{}' },
        { path: 'modules/ai/cache/latest-interpretations.json', content: '{}' },
        { path: 'modules/ai-t-advice/advice-history.jsonl', content: '{}\n' },
        { path: 'modules/market-insight/events.json', content: '[]' },
        { path: 'modules/market-insight/news-summaries.json', content: '{}' },
        { path: 'completion-notifications.json', content: '[]' }
      ],
      { openai: 'openai-key' }
    )

    expect(parseUserDataBackupDocument({ ...document, formatVersion: version })).toMatchObject({
      files: retained,
      aiApiKeys: { openai: 'openai-key' }
    })
  })

  it('rejects traversal paths in legacy cache entries', () => {
    const document = createUserDataBackupDocument(
      state(),
      '19.0.1',
      [{ path: 'modules/ai/cache/../credentials.bin', content: 'secret' }],
      {}
    )

    expect(() => parseUserDataBackupDocument(document)).toThrow('备份中的文件信息无效')
  })
})
