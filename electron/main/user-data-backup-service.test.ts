import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
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
import { STATE_MANIFEST_FILE_NAME, StateStore } from './state-store'
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
    tTradingAccounts: {},
    corporateActionRecords: {}
  }
}

function write(directory: string, relativePath: string, content: string): void {
  const filePath = join(directory, ...relativePath.split('/'))
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

describe('UserDataBackupService', () => {
  it('reports the latest modification time from local data included in backups', () => {
    const directory = temporaryDirectory()
    write(directory, 'modules/ai/conversations/conversation.json', '{}')
    write(directory, 'market-cache/shareholders/1_600519.json', '{}')
    utimesSync(
      join(directory, 'modules/ai/conversations/conversation.json'),
      new Date(2_000),
      new Date(2_000)
    )
    utimesSync(
      join(directory, 'market-cache/shareholders/1_600519.json'),
      new Date(3_000),
      new Date(3_000)
    )

    expect(
      new UserDataBackupService(directory).getLocalDataUpdatedAt('1970-01-01T00:00:01.000Z')
    ).toBe('1970-01-01T00:00:02.000Z')
  })

  it('exports user-owned data and excludes network and transient provider caches', () => {
    const directory = temporaryDirectory()
    write(directory, 'modules/ai/settings.json', '{"providerId":"openai"}')
    write(directory, 'modules/ai/conversations/index.json', '[{"id":"conversation-1"}]')
    write(directory, 'modules/ai/transient-provider-cache/session.json', '{"token":"private"}')
    write(directory, 'market-cache/shareholders/1_600519.json', '{"cached":true}')
    write(directory, 'company-reports/summaries.json', '{"report":"summary"}')
    write(directory, 'corporate-actions/summaries.json', '{"action":"summary"}')
    write(directory, 'completion-notifications.json', '[{"id":"notification-1"}]')

    const document = new UserDataBackupService(directory).create(state(), '8.3.0', {
      openai: 'openai-key'
    })

    expect(document.files.map((file) => file.path)).toEqual([
      'company-reports/summaries.json',
      'completion-notifications.json',
      'corporate-actions/summaries.json',
      'modules/ai/conversations/index.json',
      'modules/ai/settings.json'
    ])
    expect(document.aiApiKeys).toEqual({ openai: 'openai-key' })
  })

  it('binds a prepared GitHub import to the downloaded remote version', () => {
    const directory = temporaryDirectory()
    const service = new UserDataBackupService(directory)
    const document = service.create(state(), '14.0.0', {})
    const prepared = service.prepare(document, 'version-1')
    let localDataTouched = false

    expect(() =>
      service.apply(prepared.importId, {
        currentApiKeys: {},
        replaceState: (nextState) => nextState,
        createStateRecoveryPoint: () => {
          localDataTouched = true
        },
        restoreStateRecoveryPoint: () => state(),
        replaceAiApiKeys: () => undefined,
        sourceVersion: 'version-2'
      })
    ).toThrow('与下载版本不一致')
    expect(localDataTouched).toBe(false)
  })

  it('restores managed files and API keys while preserving unmanaged cache data', () => {
    const source = temporaryDirectory()
    write(source, 'modules/ai/conversations/index.json', '[{"id":"from-backup"}]')
    write(source, 'modules/market-insight/events.json', '[{"id":"event-1"}]')
    const sourceService = new UserDataBackupService(source)
    const document = sourceService.create(state(), '8.3.0', { deepseek: 'deepseek-key' })

    const target = temporaryDirectory()
    write(target, 'modules/ai/conversations/index.json', '[{"id":"local"}]')
    write(target, 'modules/ai/transient-provider-cache/session.json', '{"token":"keep"}')
    write(target, 'market-cache/klines/1_600519-daily.json', '{"cached":true}')
    const targetStateStore = new StateStore(target, state())
    targetStateStore.load()
    const targetService = new UserDataBackupService(target)
    const prepared = targetService.prepare(document)
    let restoredApiKeys: UserDataBackupApiKeys = {}

    targetService.apply(prepared.importId, {
      currentApiKeys: {},
      replaceState: (nextState) => targetStateStore.saveImported(nextState),
      createStateRecoveryPoint: (targetDirectory) =>
        targetStateStore.createRecoveryPoint(targetDirectory),
      restoreStateRecoveryPoint: (sourceDirectory) =>
        targetStateStore.restoreRecoveryPoint(sourceDirectory),
      replaceAiApiKeys: (apiKeys) => {
        restoredApiKeys = apiKeys
      }
    })

    expect(readFileSync(join(target, 'modules/ai/conversations/index.json'), 'utf8')).toContain(
      'from-backup'
    )
    expect(
      readFileSync(join(target, 'modules/ai/transient-provider-cache/session.json'), 'utf8')
    ).toContain('keep')
    expect(readFileSync(join(target, 'market-cache/klines/1_600519-daily.json'), 'utf8')).toContain(
      'cached'
    )
    expect(restoredApiKeys).toEqual({ deepseek: 'deepseek-key' })
    const restoreBackups = readdirSync(join(target, 'restore-backups'))
    expect(restoreBackups).toHaveLength(1)
    expect(
      readFileSync(
        join(target, 'restore-backups', restoreBackups[0], 'modules/ai/conversations/index.json'),
        'utf8'
      )
    ).toContain('local')
    expect(
      readFileSync(
        join(target, 'restore-backups', restoreBackups[0], 'core-state', STATE_MANIFEST_FILE_NAME),
        'utf8'
      )
    ).toContain('jianzhang-state-manifest')
  })

  it('rolls back files, state and API keys when the post-apply commit fails', () => {
    const source = temporaryDirectory()
    write(source, 'modules/market-insight/events.json', '[{"id":"from-backup"}]')
    const importedState = state()
    importedState.settings.startWithWindows = true
    const document = new UserDataBackupService(source).create(importedState, '10.0.0', {
      openai: 'new-key'
    })

    const target = temporaryDirectory()
    write(target, 'modules/market-insight/events.json', '[{"id":"local"}]')
    const targetStateStore = new StateStore(target, state())
    targetStateStore.load()
    const targetService = new UserDataBackupService(target)
    const prepared = targetService.prepare(document)
    let replaceStateCallCount = 0
    let recoveryPointRestored = false
    let restoredApiKeys: UserDataBackupApiKeys = {}

    expect(() =>
      targetService.apply(prepared.importId, {
        currentApiKeys: { deepseek: 'old-key' },
        replaceState: (nextState) => {
          replaceStateCallCount += 1
          return targetStateStore.saveImported(nextState)
        },
        createStateRecoveryPoint: (targetDirectory) =>
          targetStateStore.createRecoveryPoint(targetDirectory),
        restoreStateRecoveryPoint: (sourceDirectory) => {
          recoveryPointRestored = true
          return targetStateStore.restoreRecoveryPoint(sourceDirectory)
        },
        replaceAiApiKeys: (apiKeys) => {
          restoredApiKeys = apiKeys
        },
        afterApply: () => {
          throw new Error('baseline save failed')
        }
      })
    ).toThrow('baseline save failed')

    expect(readFileSync(join(target, 'modules/market-insight/events.json'), 'utf8')).toContain(
      'local'
    )
    expect(targetStateStore.exportCommittedState().settings.startWithWindows).toBe(false)
    expect(restoredApiKeys).toEqual({ deepseek: 'old-key' })
    expect(replaceStateCallCount).toBe(1)
    expect(recoveryPointRestored).toBe(true)
  })
})
