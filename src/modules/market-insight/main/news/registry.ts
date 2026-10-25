import { normalizeNews } from './normalize'
import type { MarketNewsProvider, NewsFetchResult, NewsQuery, NewsSourceFailure } from './types'
import type { MarketNewsItem } from '../../shared/types'

export function newsErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '未知错误'
  const detail = `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`
  if (error.name === 'TimeoutError' || /timeout|timed out/i.test(detail)) return '请求超时'
  if (/redirect count exceeded/i.test(detail)) return '来源重定向异常'
  if (/fetch failed|ERR_|network/i.test(error.message)) return '网络连接失败'
  return error.message
}

export function summarizeNewsFailures(failures: readonly NewsSourceFailure[]): string {
  const groups = new Map<string, Set<string>>()
  for (const { source, message } of failures) {
    const sources = groups.get(message) ?? new Set<string>()
    sources.add(source)
    groups.set(message, sources)
  }
  return [...groups]
    .map(([message, sources]) => `${[...sources].join('、')}：${message}`)
    .join('；')
}

export class MarketNewsRegistry {
  constructor(private readonly providers: readonly MarketNewsProvider[]) {}

  get state(): 'unconfigured' | 'ready' {
    return this.providers.length > 0 ? 'ready' : 'unconfigured'
  }

  async fetch(query: NewsQuery): Promise<MarketNewsItem[]> {
    const result = await this.fetchResult(query)
    if (!result.refreshed && result.failures.length > 0)
      throw new Error(summarizeNewsFailures(result.failures))
    return result.items
  }

  async fetchResult(
    query: NewsQuery,
    cached: readonly MarketNewsItem[] = []
  ): Promise<NewsFetchResult> {
    const results = await Promise.allSettled(
      this.providers.map(async (provider) => {
        const [stock, sector, market] = await Promise.all([
          provider.fetchStockNews(query),
          provider.fetchSectorNews(query),
          provider.fetchMarketNews(query)
        ])
        return [...stock, ...sector, ...market]
      })
    )
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              source: this.providers[index].name,
              message: newsErrorMessage(result.reason)
            }
          ]
        : []
    )
    const successful = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    if (successful.length === 0) return { items: [...cached], failures, refreshed: false }
    const failedSources = new Set(failures.map((failure) => failure.source))
    const retained = cached.filter((item) => failedSources.has(item.source))
    const cutoff = new Date(query.fetchedAt).getTime() - query.newsLookbackDays * 24 * 60 * 60_000
    const items = normalizeNews([...successful.flat(), ...retained]).filter(
      (item) =>
        (item.category === 'announcement' && item.scope === 'stock') ||
        new Date(item.publishedAt).getTime() >= cutoff
    )
    return { items, failures, refreshed: true }
  }
}
