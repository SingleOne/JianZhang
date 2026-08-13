import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function atomicWriteFileSync(filePath: string, content: string | Uint8Array): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  try {
    if (typeof content === 'string') writeFileSync(temporaryPath, content, 'utf8')
    else writeFileSync(temporaryPath, content)
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function atomicWriteJsonSync(filePath: string, value: unknown, pretty = true): void {
  atomicWriteFileSync(filePath, JSON.stringify(value, null, pretty ? 2 : undefined))
}

export interface JsonLinesReadResult<T> {
  records: T[]
  invalidLineCount: number
}

export function readJsonLinesSync<T>(filePath: string): JsonLinesReadResult<T> {
  const records: T[] = []
  let invalidLineCount = 0
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as T)
    } catch {
      invalidLineCount += 1
    }
  }
  return { records, invalidLineCount }
}

export function atomicWriteJsonLinesSync(filePath: string, records: readonly unknown[]): void {
  atomicWriteFileSync(
    filePath,
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
  )
}
