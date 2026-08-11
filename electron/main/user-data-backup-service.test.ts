import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  WATCHLIST_COLUMN_ORDER_VERSION,
  type AppState
} from '../../src/shared/types'
import type { UserDataBackupApiKeys } from '../../src/shared/user-data-backup'
import { UserDataBackupService } from './user-data-backup-service'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jianzhang-user-backup-'))
  directories.push(directory)
  return directory
}

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

function write(directory: string, relativePath: string, content: string): void {
  const filePath = join(directory, ...relativePath.split('/'))
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

describe('UserDataBackupService', () => {
  it('exports user-owned data and excludes network caches and Codex login data', () => {
    const directory = temporaryDirectory()
    write(directory, 'modules/ai/settings.json', '{"providerId":"openai"}')
    write(directory, 'modules/ai/conversations/index.json', '[{"id":"conversation-1"}]')
    write(directory, 'modules/ai/codex-runtime/auth.json', '{"token":"private"}')
    write(directory, 'market-cache/shareholders/1_600519.json', '{"cached":true}')
    write(directory, 'company-reports/summaries.json', '{"report":"summary"}')

    const document = new UserDataBackupService(directory).create(state(), '8.3.0', {
      openai: 'openai-key'
    })

    expect(document.files.map((file) => file.path)).toEqual([
      'company-reports/summaries.json',
      'modules/ai/conversations/index.json',
      'modules/ai/settings.json'
    ])
    expect(document.aiApiKeys).toEqual({ openai: 'openai-key' })
  })

  it('restores managed files and API keys while preserving network and Codex data', () => {
    const source = temporaryDirectory()
    write(source, 'modules/ai/conversations/index.json', '[{"id":"from-backup"}]')
    write(source, 'modules/market-insight/events.json', '[{"id":"event-1"}]')
    const sourceService = new UserDataBackupService(source)
    const document = sourceService.create(state(), '8.3.0', { deepseek: 'deepseek-key' })

    const target = temporaryDirectory()
    write(target, 'modules/ai/conversations/index.json', '[{"id":"local"}]')
    write(target, 'modules/ai/codex-runtime/auth.json', '{"token":"keep"}')
    write(target, 'market-cache/klines/1_600519-daily.json', '{"cached":true}')
    const targetService = new UserDataBackupService(target)
    const prepared = targetService.prepare(document)
    let restoredApiKeys: UserDataBackupApiKeys = {}

    targetService.apply(prepared.importId, (apiKeys) => {
      restoredApiKeys = apiKeys
    })

    expect(readFileSync(join(target, 'modules/ai/conversations/index.json'), 'utf8')).toContain(
      'from-backup'
    )
    expect(readFileSync(join(target, 'modules/ai/codex-runtime/auth.json'), 'utf8')).toContain(
      'keep'
    )
    expect(readFileSync(join(target, 'market-cache/klines/1_600519-daily.json'), 'utf8')).toContain(
      'cached'
    )
    expect(restoredApiKeys).toEqual({ deepseek: 'deepseek-key' })
  })
})
