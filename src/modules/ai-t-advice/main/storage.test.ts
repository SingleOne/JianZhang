import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiTAdvice } from '../shared/types'
import { AiTAdviceStorage } from './storage'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function advice(id: string): AiTAdvice {
  return {
    id,
    quoteId: '1.600519',
    quoteName: '贵州茅台',
    action: 'hold',
    rationale: ['测试'],
    risks: [],
    confidence: 'medium',
    sourceSnapshotId: `snapshot-${id}`,
    snapshotGeneratedAt: `2026-08-13T00:${id.padStart(2, '0')}:00.000Z`,
    generatedAt: `2026-08-13T00:${id.padStart(2, '0')}:00.000Z`,
    providerId: 'openai',
    model: 'test',
    status: 'active'
  }
}

describe('AiTAdviceStorage', () => {
  it('skips damaged JSONL lines and compacts history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-ai-t-storage-'))
    directories.push(directory)
    const storage = new AiTAdviceStorage(directory)
    storage.saveAdvice(advice('1'))
    appendFileSync(join(directory, 'advice-history.jsonl'), '{broken\n', 'utf8')
    const recoveredStorage = new AiTAdviceStorage(directory)
    for (let index = 2; index <= 302; index += 1) recoveredStorage.saveAdvice(advice(String(index)))

    expect(recoveredStorage.listHistory()).toHaveLength(100)
    expect(readFileSync(join(directory, 'advice-history.jsonl'), 'utf8')).not.toContain('{broken')
  })
})
