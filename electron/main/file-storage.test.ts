import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteFileSync, readJsonLinesSync } from './file-storage'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('file storage', () => {
  it('keeps the original file when the temporary write cannot be created', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-file-storage-'))
    directories.push(directory)
    const path = join(directory, 'settings.json')
    writeFileSync(path, 'original', 'utf8')
    mkdirSync(`${path}.tmp`)

    expect(() => atomicWriteFileSync(path, 'replacement')).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('original')
  })

  it('reports and skips damaged JSONL lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-file-storage-'))
    directories.push(directory)
    const path = join(directory, 'history.jsonl')
    writeFileSync(path, '{"id":1}\n{broken\n{"id":2}\n', 'utf8')

    expect(readJsonLinesSync<{ id: number }>(path)).toEqual({
      records: [{ id: 1 }, { id: 2 }],
      invalidLineCount: 1
    })
  })
})
