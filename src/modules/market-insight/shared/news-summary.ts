import type { MarketNewsItem, MarketNewsSummary } from './types'

export function newsSummaryKey(item: MarketNewsItem): string {
  return JSON.stringify([item.id, item.url, item.title, item.source, item.publishedAt])
}

export function attachNewsSummaries(
  items: readonly MarketNewsItem[],
  summaries: Readonly<Record<string, MarketNewsSummary>>
): MarketNewsItem[] {
  return items.map((item) => {
    const summary = summaries[item.id]
    const matches =
      summary &&
      summary.url === item.url &&
      summary.title === item.title &&
      summary.source === item.source &&
      summary.publishedAt === item.publishedAt
    return { ...item, summary: matches ? summary : undefined }
  })
}

export function parseNewsSummary(content: string): string {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('AI 没有返回符合要求的资讯总结格式')
  }
  const summary =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).content
      : undefined
  if (typeof summary !== 'string' || !summary.trim())
    throw new Error('AI 资讯总结内容为空或格式无效')
  return summary.trim().slice(0, 1_600)
}
