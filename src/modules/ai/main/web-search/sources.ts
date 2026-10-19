import { createHash } from 'node:crypto'
import type { WebCitation } from '../../shared/types'
import { neutralizeHistoricalCitationMarkers } from '../citations/markers'

export function webPageUrl(value: string): URL {
  const url = new URL(value)
  if (
    value.length > 8192 ||
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error('网页地址必须是有效的 HTTP/HTTPS 链接，且不能包含用户名或密码')
  }
  return url
}

export class WebSearchSources {
  private readonly citationsByUrl = new Map<string, WebCitation>()

  constructor(private readonly turnId: string) {}

  citations(): WebCitation[] {
    return [...this.citationsByUrl.values()]
  }

  record(
    url: URL,
    title: string,
    text: string,
    evidenceType: WebCitation['evidenceType'],
    source?: string | null,
    publishedAt?: string | null
  ): WebCitation {
    const existing = this.citationsByUrl.get(url.href)
    const citation: WebCitation = {
      id: existing?.id ?? `Sweb${this.turnId.slice(0, 8)}-${this.citationsByUrl.size + 1}`,
      kind: 'web',
      sourceRef: `web:${url.href}`,
      title: neutralizeHistoricalCitationMarkers(title || existing?.title || url.hostname).slice(
        0,
        500
      ),
      source: neutralizeHistoricalCitationMarkers(source || existing?.source || url.hostname),
      url: url.href,
      publishedAt: publishedAt ?? existing?.publishedAt ?? null,
      retrievedAt: new Date().toISOString(),
      evidenceType: existing?.evidenceType === 'content' ? 'content' : evidenceType,
      providedExcerpts: [
        ...(existing?.providedExcerpts ?? []),
        ...(evidenceType === 'source'
          ? []
          : [
              {
                hash: createHash('sha256').update(text).digest('hex'),
                start: 0,
                end: text.length,
                length: text.length
              }
            ])
      ]
    }
    this.citationsByUrl.set(url.href, citation)
    return citation
  }
}
