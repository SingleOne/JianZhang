import type { ChatCitation } from '../../shared/types'

const MARKER_PATTERN = /^\[(S[0-9A-Za-z-]+|资料\d+|历史\d+|事实\d+)\]/

function transformInline(
  line: string,
  lineOffset: number,
  inlineTicks: number | null,
  transform: (id: string, offset: number) => string
): { value: string; inlineTicks: number | null } {
  let value = ''
  let index = 0
  while (index < line.length) {
    if (line[index] === '`') {
      let end = index + 1
      while (line[end] === '`') end += 1
      const count = end - index
      value += line.slice(index, end)
      inlineTicks = inlineTicks === null ? count : inlineTicks === count ? null : inlineTicks
      index = end
      continue
    }
    if (inlineTicks === null && line[index] === '[') {
      const match = MARKER_PATTERN.exec(line.slice(index))
      if (match) {
        const next = index + match[0].length
        if (line[index - 1] === '!' || line[next] === '(') {
          value += match[0]
          index = next
          continue
        }
        value += transform(match[1], lineOffset + index)
        index = next
        continue
      }
    }
    value += line[index]
    index += 1
  }
  return { value, inlineTicks }
}

function transformCitationMarkers(
  content: string,
  transform: (id: string, offset: number) => string
): string {
  const lines = content.split('\n')
  let fence: { character: string; length: number } | null = null
  let inlineTicks: number | null = null
  let lineOffset = 0
  return lines
    .map((line) => {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence.character &&
          fenceMatch[1].length >= fence.length
        ) {
          fence = null
        }
        lineOffset += line.length + 1
        return line
      }
      if (inlineTicks === null && fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
        lineOffset += line.length + 1
        return line
      }
      const transformed = transformInline(line, lineOffset, inlineTicks, transform)
      inlineTicks = transformed.inlineTicks
      lineOffset += line.length + 1
      return transformed.value
    })
    .join('\n')
}

export function validateCitationMarkers(
  content: string,
  registered: readonly ChatCitation[]
): { content: string; citations: ChatCitation[] } {
  const allowed = new Map(registered.map((citation) => [citation.id, citation]))
  const cited = new Map<string, ChatCitation>()
  const validated = transformCitationMarkers(content, (id) => {
    const citation = allowed.get(id)
    if (!citation) return ''
    if (!cited.has(id)) cited.set(id, citation)
    return `[${id}]`
  })
  return { content: validated, citations: [...cited.values()] }
}

export function neutralizeHistoricalCitationMarkers(content: string): string {
  return transformCitationMarkers(content, (id) => `${id}（旧轮来源）`)
}

function incompleteMarkerStart(content: string): number {
  const index = content.lastIndexOf('[')
  if (index === -1) return content.length
  const suffix = content.slice(index)
  if (
    suffix !== '[' &&
    !/^\[(?:S[0-9A-Za-z-]*|资(?:料\d*)?|历(?:史\d*)?|事(?:实\d*)?)\]?$/.test(suffix)
  )
    return content.length
  const examples = ['[S1]', '[资料1]', '[历史1]', '[事实1]']
  const completion =
    (MARKER_PATTERN.exec(suffix)?.[0].length === suffix.length
      ? ''
      : examples.find((example) => example.startsWith(suffix))?.slice(suffix.length)) ??
    (/^\[S[0-9A-Za-z-]+$/.test(suffix) || /^\[(?:资料|历史|事实)\d+$/.test(suffix) ? ']' : null)
  if (completion === null) return content.length
  let active = false
  transformCitationMarkers(`${content}${completion}`, (id, offset) => {
    if (offset === index) active = true
    return `[${id}]`
  })
  return active ? index : content.length
}

export class CitationStreamFilter {
  private raw = ''
  private emitted = ''
  private lockedCitations: readonly ChatCitation[] | null = null

  constructor(private readonly registered: () => readonly ChatCitation[]) {}

  push(delta: string): string {
    this.raw += delta
    const safe = this.raw.slice(0, incompleteMarkerStart(this.raw))
    return this.next(validateCitationMarkers(safe, this.citations()).content)
  }

  finish(): string {
    return this.next(validateCitationMarkers(this.finalInput(), this.citations()).content)
  }

  content(): string {
    return this.emitted
  }

  rawContent(): string {
    return this.finalInput()
  }

  private next(value: string): string {
    const delta = value.slice(this.emitted.length)
    this.emitted = value
    return delta
  }

  private citations(): readonly ChatCitation[] {
    if (!this.lockedCitations) this.lockedCitations = [...this.registered()]
    return this.lockedCitations
  }

  private finalInput(): string {
    const markerStart = incompleteMarkerStart(this.raw)
    if (markerStart === this.raw.length || this.raw.endsWith(']')) return this.raw
    return this.raw.slice(0, markerStart)
  }
}
