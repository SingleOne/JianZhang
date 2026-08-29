import { normalizeNews } from './normalize'
import type { MarketNewsProvider, NewsQuery } from './types'
import type { MarketNewsItem } from '../../shared/types'

export class MarketNewsRegistry {
  private warning: string | null = null

  constructor(private readonly providers: readonly MarketNewsProvider[]) {}

  get state(): 'unconfigured' | 'ready' {
    return this.providers.length > 0 ? 'ready' : 'unconfigured'
  }

  get lastWarning(): string | null {
    return this.warning
  }

  async fetch(query: NewsQuery): Promise<MarketNewsItem[]> {
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
    const errors = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            `${this.providers[index].id}：${result.reason instanceof Error ? result.reason.message : '未知错误'}`
          ]
        : []
    )
    const successful = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    this.warning = errors.length > 0 ? `部分来源不可用（${errors.join('；')}）` : null
    if (successful.length === 0 && errors.length > 0) throw new Error(errors.join('；'))
    const cutoff = new Date(query.fetchedAt).getTime() - query.newsLookbackDays * 24 * 60 * 60_000
    return normalizeNews(successful.flat()).filter(
      (item) =>
        (item.category === 'announcement' && item.scope === 'stock') ||
        new Date(item.publishedAt).getTime() >= cutoff
    )
  }
}
