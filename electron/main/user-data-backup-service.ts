import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

interface PreparedUserDataImport {
  id: string
  document: JianzhangUserDataBackupDocument
}

export interface PreparedUserDataImportResult {
  importId: string
  state: AppState
  summary: UserDataBackupSummary
}

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

  apply(importId: string, replaceAiApiKeys: (apiKeys: UserDataBackupApiKeys) => void): void {
    if (!this.preparedImport || this.preparedImport.id !== importId) {
      throw new Error('待导入的用户数据已失效，请重新选择备份文件')
    }
    const document = this.preparedImport.document
    for (const relativePath of USER_DATA_BACKUP_SINGLE_FILES) {
      rmSync(this.filePath(relativePath), { force: true })
    }
    for (const relativeDirectory of USER_DATA_BACKUP_DIRECTORIES) {
      rmSync(this.filePath(relativeDirectory), { force: true, recursive: true })
    }
    for (const file of document.files) {
      const filePath = this.filePath(file.path)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, file.content, 'utf8')
    }
    replaceAiApiKeys(document.aiApiKeys)
    this.preparedImport = null
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

  private filePath(relativePath: string): string {
    return join(this.userDataDirectory, ...relativePath.split('/'))
  }
}
