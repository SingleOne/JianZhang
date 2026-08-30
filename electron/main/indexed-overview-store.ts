import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { dirname } from 'node:path'
import { atomicWriteJsonSync } from './file-storage'

const INDEXED_OVERVIEW_SCHEMA_VERSION = 1

interface IndexedOverviewEntry {
  offset: number
  length: number
}

export interface IndexedOverviewManifest<Metadata> {
  schemaVersion: typeof INDEXED_OVERVIEW_SCHEMA_VERSION
  sourceSize: number
  sourceModifiedAt: number
  recordsSize: number
  metadata: Metadata
  entries: Record<string, IndexedOverviewEntry>
}

export class IndexedOverviewStore<Metadata, RecordValue> {
  constructor(
    private readonly manifestPath: string,
    private readonly recordsPath: string,
    private readonly recordCode: (record: RecordValue) => string
  ) {}

  load(sourcePath: string): IndexedOverviewManifest<Metadata> | null {
    if (
      !existsSync(sourcePath) ||
      !existsSync(this.manifestPath) ||
      !existsSync(this.recordsPath)
    ) {
      return null
    }
    try {
      const source = statSync(sourcePath)
      const records = statSync(this.recordsPath)
      const manifest = JSON.parse(
        readFileSync(this.manifestPath, 'utf8')
      ) as IndexedOverviewManifest<Metadata>
      const entriesObjectValid = typeof manifest.entries === 'object' && manifest.entries !== null
      const entries = entriesObjectValid ? Object.values(manifest.entries) : []
      if (
        manifest.schemaVersion !== INDEXED_OVERVIEW_SCHEMA_VERSION ||
        manifest.sourceSize !== source.size ||
        manifest.sourceModifiedAt !== source.mtimeMs ||
        manifest.recordsSize !== records.size ||
        !entriesObjectValid ||
        entries.some(
          (entry) =>
            !Number.isSafeInteger(entry.offset) ||
            !Number.isSafeInteger(entry.length) ||
            entry.offset < 0 ||
            entry.length <= 0 ||
            entry.offset + entry.length > records.size
        )
      ) {
        return null
      }
      return manifest
    } catch {
      return null
    }
  }

  read(manifest: IndexedOverviewManifest<Metadata>, codes: readonly string[]): RecordValue[] {
    const requestedCodes = [...new Set(codes)]
    if (requestedCodes.length === 0) return []
    const descriptor = openSync(this.recordsPath, 'r')
    try {
      return requestedCodes.flatMap((code) => {
        const entry = manifest.entries[code]
        if (!entry || entry.offset < 0 || entry.length <= 0) return []
        const buffer = Buffer.allocUnsafe(entry.length)
        const bytesRead = readSync(descriptor, buffer, 0, entry.length, entry.offset)
        if (bytesRead !== entry.length) throw new Error(`轻量概览记录 ${code} 不完整`)
        const record = JSON.parse(buffer.toString('utf8')) as RecordValue
        if (this.recordCode(record) !== code) throw new Error(`轻量概览记录 ${code} 不匹配`)
        return [record]
      })
    } finally {
      closeSync(descriptor)
    }
  }

  write(
    sourcePath: string,
    metadata: Metadata,
    records: readonly RecordValue[]
  ): IndexedOverviewManifest<Metadata> {
    mkdirSync(dirname(this.recordsPath), { recursive: true })
    const temporaryRecordsPath = `${this.recordsPath}.tmp`
    const descriptor = openSync(temporaryRecordsPath, 'w')
    const entries: Record<string, IndexedOverviewEntry> = {}
    let offset = 0
    try {
      for (const record of records) {
        const line = Buffer.from(JSON.stringify(record), 'utf8')
        writeSync(descriptor, line)
        writeSync(descriptor, '\n')
        entries[this.recordCode(record)] = { offset, length: line.byteLength }
        offset += line.byteLength + 1
      }
    } finally {
      closeSync(descriptor)
    }

    try {
      renameSync(temporaryRecordsPath, this.recordsPath)
    } finally {
      rmSync(temporaryRecordsPath, { force: true })
    }
    const source = statSync(sourcePath)
    const recordsFile = statSync(this.recordsPath)
    const manifest: IndexedOverviewManifest<Metadata> = {
      schemaVersion: INDEXED_OVERVIEW_SCHEMA_VERSION,
      sourceSize: source.size,
      sourceModifiedAt: source.mtimeMs,
      recordsSize: recordsFile.size,
      metadata,
      entries
    }
    atomicWriteJsonSync(this.manifestPath, manifest, false)
    return manifest
  }
}
