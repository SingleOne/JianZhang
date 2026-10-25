import { describe, expect, it, vi } from 'vitest'
import type { MarketNewsItem } from '../../shared/types'
import { MarketNewsRegistry, newsErrorMessage, summarizeNewsFailures } from './registry'
import type { MarketNewsProvider, NewsQuery } from './types'

const query: NewsQuery = {
  quoteId: '0.000876',
  code: '000876',
  fetchedAt: '2026-10-23T08:00:00.000Z',
  newsLookbackDays: 7
}

function item(id: string, source: string): MarketNewsItem {
  return {
    id,
    source,
    title: id,
    publishedAt: '2026-10-22T08:00:00.000Z',
    url: `https://example.com/${id}`,
    category: 'announcement',
    scope: 'stock',
    relatedQuoteIds: [query.quoteId],
    fetchedAt: query.fetchedAt
  }
}

function provider(name: string, load: MarketNewsProvider['fetchStockNews']): MarketNewsProvider {
  return {
    id: name,
    name,
    fetchStockNews: load,
    fetchSectorNews: async () => [],
    fetchMarketNews: async () => []
  }
}

describe('MarketNewsRegistry', () => {
  it('retains cached items from a failed source while replacing successful sources', async () => {
    const oldAnnouncement = item('old-announcement', '巨潮资讯')
    const oldPolicy = item('old-policy', '中国证监会')
    const newPolicy = item('new-policy', '中国证监会')
    const registry = new MarketNewsRegistry([
      provider('巨潮资讯', async () => {
        throw new DOMException('timeout', 'TimeoutError')
      }),
      provider('中国证监会', async () => [newPolicy])
    ])

    const result = await registry.fetchResult(query, [oldAnnouncement, oldPolicy])

    expect(result.items.map((news) => news.id).sort()).toEqual(['new-policy', 'old-announcement'])
    expect(result.failures).toEqual([{ source: '巨潮资讯', message: '请求超时' }])
    expect(result.refreshed).toBe(true)
  })

  it('leaves all cached data intact when every source fails', async () => {
    const cached = [item('cached', '巨潮资讯')]
    const registry = new MarketNewsRegistry([
      provider('巨潮资讯', async () => {
        throw new DOMException('timeout', 'TimeoutError')
      })
    ])

    expect(await registry.fetchResult(query, cached)).toMatchObject({
      items: cached,
      refreshed: false
    })
    await expect(registry.fetch(query)).rejects.toThrow('巨潮资讯：请求超时')
  })

  it('does not preserve obsolete items for a source that successfully returned an empty list', async () => {
    const registry = new MarketNewsRegistry([provider('巨潮资讯', async () => [])])
    expect(await registry.fetchResult(query, [item('cached', '巨潮资讯')])).toEqual({
      items: [],
      failures: [],
      refreshed: true
    })
  })

  it('keeps failure details local to each concurrent query', async () => {
    const registry = new MarketNewsRegistry([
      provider(
        '巨潮资讯',
        vi.fn(async (input) => {
          if (input.code === query.code) throw new Error('network connection failed')
          return []
        })
      )
    ])
    const [failed, succeeded] = await Promise.all([
      registry.fetchResult(query),
      registry.fetchResult({ ...query, code: '600000' })
    ])
    expect(failed.failures).toEqual([{ source: '巨潮资讯', message: '网络连接失败' }])
    expect(succeeded.failures).toEqual([])
  })

  it('groups identical errors and lists each source only once', () => {
    const failures = ['巨潮资讯', '中国证监会', '上海证券交易所'].map((source) => ({
      source,
      message: '请求超时'
    }))
    expect(summarizeNewsFailures([...failures, ...failures])).toBe(
      '巨潮资讯、中国证监会、上海证券交易所：请求超时'
    )
  })

  it('explains Node connection failures using their underlying cause', () => {
    expect(
      newsErrorMessage(
        new TypeError('fetch failed', {
          cause: new Error('redirect count exceeded')
        })
      )
    ).toBe('来源重定向异常')
    expect(
      newsErrorMessage(
        new TypeError('fetch failed', {
          cause: new Error('Connect Timeout Error')
        })
      )
    ).toBe('请求超时')
  })
})
