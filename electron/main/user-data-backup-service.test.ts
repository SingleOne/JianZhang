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
import { afterEach, describe, expect, it, vi } from 'vitest'
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
const EXCLUDED_BACKUP_PATHS = [
  'modules/ai/cache/interpretations.json',
  'modules/ai/cache/latest-interpretations.json',
  'modules/ai-t-advice/advice-history.jsonl',
  'modules/market-insight/events.json',
  'modules/market-insight/news-summaries.json',
  'completion-notifications.json'
]

afterEach(() => {
  vi.useRealTimers()
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
    stockTradingBooks: {},
    corporateActionApplications: {}
  }
}

function write(directory: string, relativePath: string, content: string): void {
  const filePath = join(directory, ...relativePath.split('/'))
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

describe('UserDataBackupService', () => {
  it('keeps archive identity across reads and restarts until the data changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-16T04:00:00.000Z')
    const directory = temporaryDirectory()
    const first = new UserDataBackupService(directory).createArchive(state(), '18.0.6', {
      openai: 'first-key'
    })

    vi.setSystemTime('2026-10-16T05:00:00.000Z')
    const restarted = new UserDataBackupService(directory)
    const sameData = restarted.createArchive(state(), '18.0.7', { openai: 'first-key' })
    expect(sameData.metadata).toEqual(first.metadata)
    expect(sameData.document.exportedAt).toBe(first.document.exportedAt)

    const changedData = restarted.createArchive(state(), '18.0.7', { openai: 'changed-key' })
    expect(changedData.metadata.version).not.toBe(first.metadata.version)
    expect(changedData.metadata.generatedAt).toBe('2026-10-16T05:00:00.000Z')
  })

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
    for (const path of EXCLUDED_BACKUP_PATHS) {
      write(directory, path, '{}')
      utimesSync(join(directory, path), new Date(4_000), new Date(4_000))
    }

    expect(
      new UserDataBackupService(directory).getLocalDataUpdatedAt('1970-01-01T00:00:01.000Z')
    ).toBe('1970-01-01T00:00:02.000Z')
  })

  it('exports retained user data without analysis caches, advice history, insight events or notifications', () => {
    const directory = temporaryDirectory()
    write(directory, 'modules/ai/settings.json', '{"providerId":"openai"}')
    write(directory, 'modules/ai/conversations/index.json', '[{"id":"conversation-1"}]')
    write(directory, 'modules/ai/snapshots/snapshot-1.json', '{}')
    write(directory, 'modules/ai-t-advice/settings.json', '{"enabled":true}')
    write(directory, 'modules/market-insight/settings.json', '{}')
    write(directory, 'tracking-archives/index.json', '{}')
    write(directory, 'modules/ai/transient-provider-cache/session.json', '{"token":"private"}')
    write(directory, 'market-cache/shareholders/1_600519.json', '{"cached":true}')
    write(directory, 'company-reports/summaries.json', '{"report":"summary"}')
    write(directory, 'corporate-actions/summaries.json', '{"action":"summary"}')
    for (const path of EXCLUDED_BACKUP_PATHS) write(directory, path, '{}')

    const document = new UserDataBackupService(directory).create(state(), '8.3.0', {
      openai: 'openai-key'
    })

    expect(document.files.map((file) => file.path).sort()).toEqual(
      [
        'company-reports/summaries.json',
        'corporate-actions/summaries.json',
        'modules/ai-t-advice/settings.json',
        'modules/ai/conversations/index.json',
        'modules/ai/settings.json',
        'modules/ai/snapshots/snapshot-1.json',
        'modules/market-insight/settings.json',
        'tracking-archives/index.json'
      ].sort()
    )
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

  it.each([false, true])(
    'restores retained data and preserves local excluded data (legacy: %s)',
    (legacy) => {
      const source = temporaryDirectory()
      write(source, 'modules/ai/conversations/index.json', '[{"id":"from-backup"}]')
      const sourceService = new UserDataBackupService(source)
      const document = sourceService.create(state(), '8.3.0', { deepseek: 'deepseek-key' })
      if (legacy) {
        document.files.push(
          ...EXCLUDED_BACKUP_PATHS.map((path) => ({ path, content: '{"source":"backup"}' }))
        )
      }

      const target = temporaryDirectory()
      write(target, 'modules/ai/conversations/index.json', '[{"id":"local"}]')
      write(target, 'modules/ai/transient-provider-cache/session.json', '{"token":"keep"}')
      write(target, 'market-cache/klines/1_600519-daily.json', '{"cached":true}')
      for (const path of EXCLUDED_BACKUP_PATHS) write(target, path, '{"source":"local"}')
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
      for (const path of EXCLUDED_BACKUP_PATHS) {
        expect(readFileSync(join(target, path), 'utf8')).toBe('{"source":"local"}')
      }
      expect(
        readFileSync(join(target, 'modules/ai/transient-provider-cache/session.json'), 'utf8')
      ).toContain('keep')
      expect(
        readFileSync(join(target, 'market-cache/klines/1_600519-daily.json'), 'utf8')
      ).toContain('cached')
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
          join(
            target,
            'restore-backups',
            restoreBackups[0],
            'core-state',
            STATE_MANIFEST_FILE_NAME
          ),
          'utf8'
        )
      ).toContain('jianzhang-state-manifest')
    }
  )

  it('rolls back files, state and API keys when the post-apply commit fails', () => {
    const source = temporaryDirectory()
    write(source, 'modules/ai/settings.json', '{"model":"from-backup"}')
    const importedState = state()
    importedState.settings.startWithWindows = true
    const document = new UserDataBackupService(source).create(importedState, '10.0.0', {
      openai: 'new-key'
    })

    const target = temporaryDirectory()
    write(target, 'modules/ai/settings.json', '{"model":"local"}')
    for (const path of EXCLUDED_BACKUP_PATHS) write(target, path, '{"source":"local"}')
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

    expect(readFileSync(join(target, 'modules/ai/settings.json'), 'utf8')).toContain('local')
    for (const path of EXCLUDED_BACKUP_PATHS) {
      expect(readFileSync(join(target, path), 'utf8')).toBe('{"source":"local"}')
    }
    expect(targetStateStore.exportCommittedState().settings.startWithWindows).toBe(false)
    expect(restoredApiKeys).toEqual({ deepseek: 'old-key' })
    expect(replaceStateCallCount).toBe(1)
    expect(recoveryPointRestored).toBe(true)
  })
})
