import { net } from 'electron'
import type { MarketNewsItem } from '../../../shared/types'

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, text/html, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export async function requestText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await net.fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...init.headers
    },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) throw new Error(`请求 ${new URL(url).hostname} 失败：HTTP ${response.status}`)
  return response.text()
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await net.fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...init.headers
    },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) throw new Error(`请求 ${new URL(url).hostname} 失败：HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
      return named[entity.toLowerCase()] ?? `&${entity};`
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function absoluteUrl(value: string, baseUrl: string): string {
  if (value.startsWith('//')) return `https:${value}`
  return new URL(value, baseUrl).toString()
}

export function chinaDateTimeToIso(value: string): string {
  const normalized = value.trim().replace(/\//g, '-')
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T00:00:00+08:00`
    : `${normalized.replace(' ', 'T')}+08:00`
  const date = new Date(withTime)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function sourceId(prefix: string, url: string): string {
  const id = url.match(/(?:\/|=)(\d{6,})(?:\.|\/|$)/)?.[1]
  return `${prefix}:${id ?? url}`
}

export function emptyNews(): Promise<MarketNewsItem[]> {
  return Promise.resolve([])
}
