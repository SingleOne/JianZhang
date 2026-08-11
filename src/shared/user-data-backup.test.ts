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
    tTradingAccounts: {}
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
      { openai: 'openai-key', deepseek: 'deepseek-key' }
    )

    expect(parseUserDataBackupDocument(document)).toMatchObject({
      format: JIANZHANG_USER_DATA_BACKUP_FORMAT,
      applicationVersion: '8.3.0',
      files: document.files,
      aiApiKeys: { openai: 'openai-key', deepseek: 'deepseek-key' }
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
})
