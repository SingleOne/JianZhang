import { describe, expect, it } from 'vitest'
import type { MemorySearchResult } from '../../shared/memory-types'
import { TurnSourceRegistry, type MemoryCitationIdentity } from './registry'

const identity: MemoryCitationIdentity = {
  profileId: 'profile',
  serviceId: 'service',
  userId: 'user',
  sessionId: 'current-session'
}

const documentSource: MemorySearchResult = {
  kind: 'document',
  sourceId: 'chunk',
  text: '资料正文',
  score: 10,
  documentId: 'document',
  versionId: 'version',
  generationId: 'generation',
  textHash: 'text-hash',
  fileName: '资料.pdf',
  versionNo: 2,
  locator: '第 3 页',
  pageNumber: 3,
  sourceType: 'native'
}

describe('turn source registry', () => {
  it('numbers each memory source kind independently', () => {
    const registry = new TurnSourceRegistry()
    const history: MemorySearchResult = {
      kind: 'message',
      sourceId: 'message',
      text: '历史正文',
      score: 8,
      sessionId: 'source-session',
      revision: 1,
      textHash: 'history-hash'
    }
    expect(registry.registerMemory(documentSource, identity, documentSource.text)?.id).toBe('资料1')
    expect(registry.registerMemory(history, identity, history.text)?.id).toBe('历史1')
  })

  it('registers only reliable sources and records transmitted excerpts', () => {
    const registry = new TurnSourceRegistry()
    const incomplete = { ...documentSource, generationId: undefined }
    expect(registry.registerMemory(incomplete, identity, incomplete.text)).toBeNull()
    const citation = registry.registerMemory(documentSource, identity, '资料')
    registry.registerMemory(documentSource, identity, '资料正文')
    expect(citation?.providedExcerpts).toHaveLength(2)
  })

  it('keeps different fact revisions as separate citation sources', () => {
    const registry = new TurnSourceRegistry()
    const fact: MemorySearchResult = {
      kind: 'fact',
      sourceId: 'fact',
      text: '旧值',
      score: 6,
      revision: 1,
      textHash: 'old-hash',
      key: '偏好'
    }
    expect(registry.registerMemory(fact, identity, fact.text)?.id).toBe('事实1')
    expect(
      registry.registerMemory(
        { ...fact, text: '新值', revision: 2, textHash: 'new-hash' },
        identity,
        '新值'
      )?.id
    ).toBe('事实2')
  })

  it('adds labels only to sources that enter the final background budget', () => {
    const registry = new TurnSourceRegistry()
    const context = registry.buildMemoryContext({
      profileText: 'x'.repeat(12_000),
      summaryText: '',
      sources: [documentSource],
      identity,
      unavailable: false
    })
    expect(context).not.toContain('[资料1]')
    expect(registry.registered()).toEqual([])
  })

  it('caps tool output after JSON escaping and records the emitted text', () => {
    const registry = new TurnSourceRegistry()
    const [result] = registry.prepareToolResults(
      [{ ...documentSource, text: '"\n'.repeat(8_000) }],
      identity
    )
    expect(JSON.stringify([result]).length).toBeLessThanOrEqual(10_000)
    expect(registry.registered()[0]?.providedExcerpts[0]?.length).toBe(result.text.length)
  })
})
