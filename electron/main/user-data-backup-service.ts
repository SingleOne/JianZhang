import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  USER_DATA_BACKUP_DIRECTORIES,
  USER_DATA_BACKUP_SINGLE_FILES,
  createUserDataBackupDocument,
  parseUserDataBackupDocument,
  type JianzhangUserDataBackupDocument,
  type UserDataBackupApiKeys,
  type UserDataBackupFile
} from '../../src/shared/user-data-backup'
import type { AppState, UserDataBackupSummary } from '../../src/shared/types'
import { atomicWriteFileSync, atomicWriteJsonSync } from './file-storage'

interface PreparedUserDataImport {
  id: string
  document: JianzhangUserDataBackupDocument
}

export interface PreparedUserDataImportResult {
  importId: string
  state: AppState
  summary: UserDataBackupSummary
}

interface ApplyUserDataBackupOptions {
  currentState: AppState
  currentApiKeys: UserDataBackupApiKeys
  replaceState: (state: AppState) => AppState
  replaceAiApiKeys: (apiKeys: UserDataBackupApiKeys) => void
}

const LOCAL_SNAPSHOT_PATHS = [
  'settings.json',
  'settings.last-good.json',
  'modules/ai/credentials.bin'
] as const
const RESTORE_SNAPSHOT_LIMIT = 5

export class UserDataBackupService {
  private preparedImport: PreparedUserDataImport | null = null

  constructor(private readonly userDataDirectory: string) {}

  create(
    state: AppState,
    applicationVersion: string,
    aiApiKeys: UserDataBackupApiKeys
  ): JianzhangUserDataBackupDocument {
    const files: UserDataBackupFile[] = []
    for (const relativePath of USER_DATA_BACKUP_SINGLE_FILES) {
      const filePath = this.filePath(relativePath)
      if (existsSync(filePath)) {
        files.push({ path: relativePath, content: readFileSync(filePath, 'utf8') })
      }
    }
    for (const relativeDirectory of USER_DATA_BACKUP_DIRECTORIES) {
      this.collectDirectory(relativeDirectory, files)
    }
    files.sort((left, right) => left.path.localeCompare(right.path))
    return createUserDataBackupDocument(state, applicationVersion, files, aiApiKeys)
  }

  prepare(value: unknown): PreparedUserDataImportResult {
    const document = parseUserDataBackupDocument(value)
    const importId = randomUUID()
    this.preparedImport = { id: importId, document }
    return {
      importId,
      state: document.state,
      summary: {
        applicationVersion: document.applicationVersion,
        exportedAt: document.exportedAt,
        fileCount: document.files.length,
        apiKeyCount: Object.keys(document.aiApiKeys).length
      }
    }
  }

  apply(importId: string, options: ApplyUserDataBackupOptions): AppState {
    if (!this.preparedImport || this.preparedImport.id !== importId) {
      throw new Error('待导入的用户数据已失效，请重新选择备份文件')
    }
    const document = this.preparedImport.document
    const stagingDirectory = join(this.userDataDirectory, '.restore-staging', importId)
    const incomingDirectory = join(stagingDirectory, 'incoming')
    const snapshotDirectory = join(
      this.userDataDirectory,
      'restore-backups',
      `restore-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${importId}`
    )
    rmSync(stagingDirectory, { force: true, recursive: true })
    mkdirSync(incomingDirectory, { recursive: true })

    try {
      for (const file of document.files) {
        const incomingPath = join(incomingDirectory, ...file.path.split('/'))
        atomicWriteFileSync(incomingPath, file.content)
        if (file.path.endsWith('.json')) JSON.parse(readFileSync(incomingPath, 'utf8'))
      }
      this.snapshotCurrentData(snapshotDirectory)
      try {
        this.clearManagedData()
        for (const file of document.files) {
          atomicWriteFileSync(this.filePath(file.path), file.content)
        }
        options.replaceAiApiKeys(document.aiApiKeys)
        const savedState = options.replaceState(document.state)
        atomicWriteJsonSync(join(snapshotDirectory, 'restore-manifest.json'), {
          createdAt: new Date().toISOString(),
          importedApplicationVersion: document.applicationVersion,
          importedFileCount: document.files.length,
          importedApiKeyCount: Object.keys(document.aiApiKeys).length
        })
        this.cleanupRestoreSnapshots()
        this.preparedImport = null
        return savedState
      } catch (reason) {
        this.restoreSnapshot(snapshotDirectory)
        options.replaceState(options.currentState)
        options.replaceAiApiKeys(options.currentApiKeys)
        throw reason
      }
    } finally {
      rmSync(stagingDirectory, { force: true, recursive: true })
    }
  }

  private snapshotCurrentData(snapshotDirectory: string): void {
    for (const relativePath of LOCAL_SNAPSHOT_PATHS)
      this.copyIfPresent(relativePath, snapshotDirectory)
    for (const relativePath of USER_DATA_BACKUP_SINGLE_FILES) {
      this.copyIfPresent(relativePath, snapshotDirectory)
    }
    for (const relativeDirectory of USER_DATA_BACKUP_DIRECTORIES) {
      this.copyDirectory(relativeDirectory, snapshotDirectory)
    }
  }

  private restoreSnapshot(snapshotDirectory: string): void {
    this.clearManagedData()
    for (const relativePath of LOCAL_SNAPSHOT_PATHS) {
      rmSync(this.filePath(relativePath), { force: true })
    }
    this.copyDirectoryFromSnapshot(snapshotDirectory, '')
    rmSync(join(this.userDataDirectory, 'restore-manifest.json'), { force: true })
  }

  private clearManagedData(): void {
    for (const relativePath of USER_DATA_BACKUP_SINGLE_FILES) {
      rmSync(this.filePath(relativePath), { force: true })
    }
    for (const relativeDirectory of USER_DATA_BACKUP_DIRECTORIES) {
      rmSync(this.filePath(relativeDirectory), { force: true, recursive: true })
    }
  }

  private copyIfPresent(relativePath: string, targetRoot: string): void {
    const source = this.filePath(relativePath)
    if (!existsSync(source)) return
    const target = join(targetRoot, ...relativePath.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }

  private copyDirectory(relativeDirectory: string, targetRoot: string): void {
    const sourceDirectory = this.filePath(relativeDirectory)
    if (!existsSync(sourceDirectory)) return
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) this.copyDirectory(relativePath, targetRoot)
      else if (entry.isFile()) this.copyIfPresent(relativePath, targetRoot)
    }
  }

  private copyDirectoryFromSnapshot(snapshotRoot: string, relativeDirectory: string): void {
    const sourceDirectory = relativeDirectory
      ? join(snapshotRoot, ...relativeDirectory.split('/'))
      : snapshotRoot
    if (!existsSync(sourceDirectory)) return
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!relativeDirectory && entry.name === 'restore-manifest.json') continue
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) this.copyDirectoryFromSnapshot(snapshotRoot, relativePath)
      else if (entry.isFile()) {
        const target = this.filePath(relativePath)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(snapshotRoot, ...relativePath.split('/')), target)
      }
    }
  }

  private collectDirectory(relativeDirectory: string, files: UserDataBackupFile[]): void {
    const directory = this.filePath(relativeDirectory)
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`
      if (entry.isDirectory()) this.collectDirectory(relativePath, files)
      else if (entry.isFile()) {
        files.push({
          path: relativePath,
          content: readFileSync(this.filePath(relativePath), 'utf8')
        })
      }
    }
  }

  private cleanupRestoreSnapshots(): void {
    const root = join(this.userDataDirectory, 'restore-backups')
    if (!existsSync(root)) return
    const snapshots = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('restore-'))
      .map((entry) => entry.name)
      .sort()
    for (const name of snapshots.slice(0, -RESTORE_SNAPSHOT_LIMIT)) {
      rmSync(join(root, name), { force: true, recursive: true })
    }
  }

  private filePath(relativePath: string): string {
    return join(this.userDataDirectory, ...relativePath.split('/'))
  }
}
