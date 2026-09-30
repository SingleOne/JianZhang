import { createHash } from 'node:crypto'
import type { MemorySearchResult, MemorySourceDetail } from '../../shared/memory-types'
import type {
  AiSourceCitation,
  ChatCitation,
  CitationExcerpt,
  DocumentCitation,
  FactCitation,
  HistoryCitation,
  StockCitation
} from '../../shared/types'
import { neutralizeHistoricalCitationMarkers } from './markers'

export interface MemoryCitationIdentity {
  profileId: string
  serviceId: string
  userId: string
  sessionId: string
}

export interface PreparedMemoryTurn {
  profileText: string
  summaryText: string
  sources: MemorySearchResult[]
  identity: MemoryCitationIdentity
  unavailable: boolean
}

type MemorySource = MemorySearchResult | MemorySourceDetail

const MEMORY_CONTEXT_LIMIT = 12_000
const MEMORY_TOOL_LIMIT = 10_000

function textEvidence(text: string): CitationExcerpt {
  return {
    hash: createHash('sha256').update(text).digest('hex'),
    start: 0,
    end: text.length,
    length: text.length
  }
}

function sourceKind(source: MemorySource): 'document' | 'history' | 'fact' {
  return source.kind === 'message' ? 'history' : source.kind
}

function sourceTitle(source: MemorySource): string {
  if (source.kind === 'document') {
    const location = source.locator || (source.pageNumber ? `第 ${source.pageNumber} 页` : '')
    return `${source.fileName ?? '资料文件'}${location ? `（${location}）` : ''}`
  }
  if (source.kind === 'message')
    return `${source.title ?? '先前对话'}${source.occurredAt ? ` / ${source.occurredAt}` : ''}`
  return source.key ?? '用户信息'
}

function appendWithin(current: string, next: string, limit: number): string {
  const separator = current ? '\n\n' : ''
  const remaining = limit - current.length - separator.length
  if (remaining <= 0) return current
  return `${current}${separator}${next.slice(0, remaining)}`
}

function fitSerializedText(text: string, fits: (candidate: string) => boolean): string | null {
  if (!fits('')) return null
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(text.slice(0, middle))) low = middle
    else high = middle - 1
  }
  return text.slice(0, low)
}

export class TurnSourceRegistry {
  private readonly citationsByRef = new Map<string, ChatCitation>()
  private readonly counters = { document: 0, history: 0, fact: 0 }

  registered(): ChatCitation[] {
    return [...this.citationsByRef.values()]
  }

  registerStock(citations: readonly AiSourceCitation[]): void {
    for (const citation of citations) {
      const sourceRef = citation.sourceRef ?? `stock:${citation.stockRef}:${citation.url}`
      if (this.citationsByRef.has(sourceRef)) continue
      const evidence = JSON.stringify({
        title: citation.title,
        source: citation.source,
        publishedAt: citation.publishedAt,
        url: citation.url,
        category: citation.category
      })
      const normalized: StockCitation = {
        ...citation,
        kind: 'stock',
        sourceRef,
        providedExcerpts: citation.providedExcerpts?.length
          ? citation.providedExcerpts
          : [textEvidence(evidence)]
      }
      this.citationsByRef.set(sourceRef, normalized)
    }
  }

  markerForMemory(source: MemorySource, identity: MemoryCitationIdentity): string | null {
    const sourceRef = this.memorySourceRef(source, identity)
    if (!sourceRef) return null
    const existing = this.citationsByRef.get(sourceRef)
    if (existing) return existing.id
    const kind = sourceKind(source)
    return `${kind === 'document' ? '资料' : kind === 'history' ? '历史' : '事实'}${this.counters[kind] + 1}`
  }

  registerMemory(
    source: MemorySource,
    identity: MemoryCitationIdentity,
    providedText: string
  ): ChatCitation | null {
    const sourceRef = this.memorySourceRef(source, identity)
    if (!sourceRef || !providedText) return null
    const evidence = textEvidence(providedText)
    const existing = this.citationsByRef.get(sourceRef)
    if (existing) {
      if (!existing.providedExcerpts?.some((item) => item.hash === evidence.hash)) {
        existing.providedExcerpts = [...(existing.providedExcerpts ?? []), evidence]
      }
      return existing
    }
    const kind = sourceKind(source)
    this.counters[kind] += 1
    const id = `${kind === 'document' ? '资料' : kind === 'history' ? '历史' : '事实'}${this.counters[kind]}`
    const base = {
      id,
      sourceRef,
      serviceProfileId: identity.profileId,
      serviceId: identity.serviceId,
      userId: identity.userId,
      sessionId: identity.sessionId,
      providedExcerpts: [evidence]
    }
    let citation: DocumentCitation | HistoryCitation | FactCitation
    if (
      source.kind === 'document' &&
      source.documentId &&
      source.versionId &&
      source.generationId &&
      source.textHash &&
      source.fileName &&
      source.versionNo !== undefined
    ) {
      citation = {
        ...base,
        kind: 'document',
        documentId: source.documentId,
        versionId: source.versionId,
        generationId: source.generationId,
        chunkId: source.sourceId,
        textHash: source.textHash,
        fileName: source.fileName,
        versionNo: source.versionNo,
        locator: source.locator,
        heading: source.heading,
        pageNumber: source.pageNumber,
        sourceType: source.sourceType,
        coverage: source.coverage,
        failedPages: source.failedPages
      }
    } else if (
      source.kind === 'message' &&
      source.sessionId &&
      source.revision !== undefined &&
      source.textHash
    ) {
      citation = {
        ...base,
        kind: 'history',
        sourceSessionId: source.sessionId,
        messageId: source.sourceId,
        revision: source.revision,
        textHash: source.textHash,
        title: source.title,
        role: source.role,
        occurredAt: source.occurredAt
      }
    } else if (
      source.kind === 'fact' &&
      source.revision !== undefined &&
      source.textHash &&
      source.key
    ) {
      citation = {
        ...base,
        kind: 'fact',
        factId: source.sourceId,
        revision: source.revision,
        textHash: source.textHash,
        key: source.key
      }
    } else {
      this.counters[kind] -= 1
      return null
    }
    this.citationsByRef.set(sourceRef, citation)
    return citation
  }

  buildMemoryContext(prepared: PreparedMemoryTurn): string {
    let context = ''
    const sourceSections = new Set<string>()
    if (prepared.profileText)
      context = appendWithin(
        context,
        `用户信息：\n${neutralizeHistoricalCitationMarkers(prepared.profileText)}`,
        MEMORY_CONTEXT_LIMIT
      )
    if (prepared.summaryText)
      context = appendWithin(
        context,
        `当前会话较早内容概要：\n${neutralizeHistoricalCitationMarkers(prepared.summaryText)}`,
        MEMORY_CONTEXT_LIMIT
      )
    for (const source of prepared.sources) {
      const marker = this.markerForMemory(source, prepared.identity)
      const prefix = `- ${marker ? `[${marker}] ` : ''}${sourceTitle(source)}：`
      const heading = source.kind === 'document' ? '资料文件内容：' : '先前交流内容：'
      const sectionPrefix = sourceSections.has(heading) ? '' : `${heading}\n`
      const separator = context ? '\n\n' : ''
      const remaining =
        MEMORY_CONTEXT_LIMIT -
        context.length -
        separator.length -
        sectionPrefix.length -
        prefix.length
      if (remaining <= 0) break
      const providedText = neutralizeHistoricalCitationMarkers(source.text).slice(0, remaining)
      if (!providedText) continue
      context = `${context}${separator}${sectionPrefix}${prefix}${providedText}`
      sourceSections.add(heading)
      if (marker) this.registerMemory(source, prepared.identity, providedText)
    }
    return context
  }

  prepareToolResults(
    sources: readonly MemorySearchResult[],
    identity: MemoryCitationIdentity
  ): Array<MemorySearchResult & { citationId?: string }> {
    const results: Array<MemorySearchResult & { citationId?: string }> = []
    for (const source of sources) {
      const marker = this.markerForMemory(source, identity)
      const sanitized = neutralizeHistoricalCitationMarkers(source.text)
      const text = fitSerializedText(
        sanitized,
        (candidate) =>
          JSON.stringify([
            ...results,
            { ...source, text: candidate, ...(marker ? { citationId: marker } : {}) }
          ]).length <= MEMORY_TOOL_LIMIT
      )
      if (text === null) break
      const citation = marker ? this.registerMemory(source, identity, text) : null
      results.push({ ...source, text, ...(citation ? { citationId: citation.id } : {}) })
    }
    return results
  }

  prepareToolSource(
    source: MemorySourceDetail,
    identity: MemoryCitationIdentity
  ): MemorySourceDetail & { citationId?: string } {
    const marker = this.markerForMemory(source, identity)
    const sanitized = neutralizeHistoricalCitationMarkers(source.text)
    const text =
      fitSerializedText(
        sanitized,
        (candidate) =>
          JSON.stringify({
            ...source,
            text: candidate,
            ...(marker ? { citationId: marker } : {})
          }).length <= MEMORY_TOOL_LIMIT
      ) ?? ''
    const citation = marker && text ? this.registerMemory(source, identity, text) : null
    return { ...source, text, ...(citation ? { citationId: citation.id } : {}) }
  }

  private memorySourceRef(source: MemorySource, identity: MemoryCitationIdentity): string | null {
    if (!source.sourceId) return null
    if (source.kind === 'document') {
      if (
        !source.documentId ||
        !source.versionId ||
        !source.generationId ||
        !source.textHash ||
        !source.fileName ||
        source.versionNo === undefined
      )
        return null
      return `${identity.profileId}:document:${source.sourceId}`
    }
    if (source.kind === 'message') {
      if (!source.sessionId || source.revision === undefined || !source.textHash) return null
      return `${identity.profileId}:message:${source.sourceId}:${source.revision}:${source.textHash}`
    }
    if (source.revision === undefined || !source.textHash || !source.key) return null
    return `${identity.profileId}:fact:${source.sourceId}:${source.revision}:${source.textHash}`
  }
}
