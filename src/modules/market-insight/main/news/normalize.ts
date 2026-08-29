import type { MarketNewsItem } from '../../shared/types'

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key)
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim().replace(/\/$/, '')
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase()
}

function timeWindow(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  date.setMinutes(0, 0, 0)
  return date.toISOString()
}

export function newsFingerprint(item: MarketNewsItem): string {
  return (
    item.id ||
    normalizeUrl(item.url) ||
    `${item.source}:${normalizeTitle(item.title)}:${timeWindow(item.publishedAt)}`
  )
}

export function normalizeNews(items: readonly MarketNewsItem[]): MarketNewsItem[] {
  const found = new Set<string>()
  const valid: MarketNewsItem[] = []
  for (const item of items) {
    if (!item.title.trim() || !item.source.trim() || !item.url.trim() || !item.publishedAt.trim())
      continue
    const normalized = { ...item, url: normalizeUrl(item.url) }
    const fingerprint = newsFingerprint(normalized)
    if (found.has(fingerprint)) continue
    found.add(fingerprint)
    valid.push(normalized)
  }
  return valid.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
}
