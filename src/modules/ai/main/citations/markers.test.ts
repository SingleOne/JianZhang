import { describe, expect, it } from 'vitest'
import type { ChatCitation } from '../../shared/types'
import {
  CitationStreamFilter,
  neutralizeHistoricalCitationMarkers,
  validateCitationMarkers
} from './markers'

const citation: ChatCitation = {
  id: '资料1',
  kind: 'document',
  sourceRef: 'profile:document:chunk',
  serviceProfileId: 'profile',
  serviceId: 'service',
  userId: 'user',
  sessionId: 'session',
  providedExcerpts: [{ hash: 'hash', start: 0, end: 4, length: 4 }],
  documentId: 'document',
  versionId: 'version',
  generationId: 'generation',
  chunkId: 'chunk',
  textHash: 'text-hash',
  fileName: '资料.pdf',
  versionNo: 1
}

describe('citation markers', () => {
  it('keeps registered markers in appearance order and removes forged markers', () => {
    const value = validateCitationMarkers('结论[资料1]，伪造[历史9]，再次[资料1]。', [citation])
    expect(value.content).toBe('结论[资料1]，伪造，再次[资料1]。')
    expect(value.citations).toEqual([citation])
  })

  it('does not reinterpret code or markdown links as citations', () => {
    const content = '`[资料1]` [资料1](https://example.com)\n```text\n[资料1]\n```'
    expect(validateCitationMarkers(content, []).content).toBe(content)
  })

  it('buffers a marker split across stream chunks', () => {
    const stream = new CitationStreamFilter(() => [citation])
    expect(stream.push('结论[资')).toBe('结论')
    expect(stream.push('料1]')).toBe('')
    expect(stream.push('。')).toBe('[资料1]。')
  })

  it('buffers multi-digit and stock marker prefixes across chunks', () => {
    const document12 = { ...citation, id: '资料12', sourceRef: 'profile:document:chunk-12' }
    const stock = {
      id: 'Sabc-123',
      kind: 'stock' as const,
      sourceRef: 'stock:abc:url',
      providedExcerpts: [{ hash: 'stock-hash', start: 0, end: 4, length: 4 }],
      stockRef: 'abc',
      title: '公告',
      source: '交易所',
      publishedAt: '2026-09-30',
      url: 'https://example.com',
      category: 'announcement' as const
    }
    const stream = new CitationStreamFilter(() => [document12, stock])
    expect(stream.push('资料[资料1')).toBe('资料')
    expect(stream.push('2] 股票[Sabc')).toBe('[资料12] 股票')
    expect(stream.push('-123]')).toBe('')
    expect(stream.push('。')).toBe('[Sabc-123]。')
  })

  it('keeps emitted deltas append-only when the registry changes', () => {
    let registered: ChatCitation[] = []
    const stream = new CitationStreamFilter(() => registered)
    expect(stream.push('前文。')).toBe('前文。')
    registered = [citation]
    expect(stream.push('[资料1]。')).toBe('。')
    expect(stream.content()).toBe('前文。。')
  })

  it('drops an unfinished marker when a stopped stream is finalized', () => {
    const stream = new CitationStreamFilter(() => [citation])
    expect(stream.push('结论[资')).toBe('结论')
    expect(stream.finish()).toBe('')
    expect(stream.rawContent()).toBe('结论')
  })

  it('keeps unfinished marker-like text inside code', () => {
    const stream = new CitationStreamFilter(() => [citation])
    expect(stream.push('`[资料')).toBe('`[资料')
    expect(stream.finish()).toBe('')
    expect(stream.rawContent()).toBe('`[资料')
  })

  it('neutralizes prior-turn markers outside code', () => {
    expect(neutralizeHistoricalCitationMarkers('旧答[资料1]，代码`[资料1]`')).toBe(
      '旧答资料1（旧轮来源），代码`[资料1]`'
    )
  })
})
