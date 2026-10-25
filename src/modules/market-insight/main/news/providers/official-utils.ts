import { net } from 'electron'
import { BROWSER_USER_AGENT } from '../../../../../../electron/main/http-user-agent'
import type { MarketNewsItem } from '../../../shared/types'

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, text/html, */*',
  'User-Agent': BROWSER_USER_AGENT
}

class NewsHttpError extends Error {}

export async function requestBytes(
  url: string,
  init: RequestInit = {},
  timeoutMilliseconds = 12_000
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const headers = new Headers(DEFAULT_HEADERS)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  const options = {
    ...init,
    headers,
    // An empty POST still needs a zero-length body on some official endpoints.
    body: init.body ?? (init.method?.toUpperCase() === 'POST' ? '' : undefined)
  }
  const signal = () =>
    init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMilliseconds)])
      : AbortSignal.timeout(timeoutMilliseconds)
  const read = async (response: Response) => {
    if (!response.ok)
      throw new NewsHttpError(`请求 ${new URL(url).hostname} 失败：HTTP ${response.status}`)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? ''
    }
  }
  try {
    return await read(await net.fetch(url, { ...options, signal: signal() }))
  } catch (error) {
    if (error instanceof NewsHttpError || init.signal?.aborted) throw error
    // Chromium follows system PAC/WPAD settings. Node provides a separate route
    // when proxy resolution or the Chromium connection stalls.
    return read(await fetch(url, { ...options, signal: signal() }))
  }
}

export async function requestText(url: string, init: RequestInit = {}): Promise<string> {
  const { bytes, contentType } = await requestBytes(url, init)
  const encoding = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await requestText(url, init)) as T
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
