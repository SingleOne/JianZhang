import { describe, expect, it } from 'vitest'
import { attachNewsSummaries, parseNewsSummary } from './news-summary'
import type { MarketNewsItem, MarketNewsSummary } from './types'

const item: MarketNewsItem = {
  id: 'sse:123456',
  title: '交易所通知',
  url: 'https://www.sse.com.cn/a.shtml',
  source: '上海证券交易所',
  category: 'announcement',
  scope: 'market',
  publishedAt: '2026-10-23T00:00:00.000Z',
  fetchedAt: '2026-10-25T00:00:00.000Z',
  relatedQuoteIds: []
}
const summary: MarketNewsSummary = {
  newsId: item.id,
  title: item.title,
  source: item.source,
  url: item.url,
  publishedAt: item.publishedAt,
  content: '总结内容',
  generatedAt: item.fetchedAt,
  providerId: 'deepseek',
  model: 'test-model'
}

describe('news summary binding', () => {
  it('shares a market article summary across stocks without binding it to one stock', () => {
    expect(
      attachNewsSummaries([{ ...item, relatedQuoteIds: ['0.000876'] }], { [item.id]: summary })[0]
        .summary
    ).toEqual(summary)
  })

  it.each([
    { title: '修订后的通知' },
    { url: 'https://www.sse.com.cn/other.shtml' },
    { publishedAt: '2026-10-24T00:00:00.000Z' }
  ])('removes a stale cached summary when the original article changes: %j', (change) => {
    expect(
      attachNewsSummaries([{ ...item, ...change, summary }], { [item.id]: summary })[0].summary
    ).toBeUndefined()
  })

  it('parses fenced JSON and rejects blank or non-object summaries', () => {
    expect(parseNewsSummary('```json\n{"content":" 正文摘要 "}\n```')).toBe('正文摘要')
    for (const invalid of ['not JSON', '[]', 'null', '{"content":" "}']) {
      expect(() => parseNewsSummary(invalid)).toThrow()
    }
  })
})
