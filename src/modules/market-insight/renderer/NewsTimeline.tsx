import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MarketInsightStatus, MarketNewsItem } from '../shared/types'

interface NewsTimelineProps {
  news: readonly MarketNewsItem[]
  status: MarketInsightStatus | null
  includeOlderNews: boolean
  onToggleOlderNews: () => void
  onOpenSource: (url: string) => void
}

export function NewsTimeline({
  news,
  status,
  includeOlderNews,
  onToggleOlderNews,
  onOpenSource
}: NewsTimelineProps) {
  const [activeTab, setActiveTab] = useState<'news' | 'announcement' | 'exchange'>('news')
  const companyAnnouncements = useMemo(
    () => news.filter((item) => item.category === 'announcement' && item.scope === 'stock'),
    [news]
  )
  const exchangeNotices = useMemo(
    () => news.filter((item) => item.category === 'announcement' && item.scope === 'market'),
    [news]
  )
  const headlines = useMemo(() => news.filter((item) => item.category !== 'announcement'), [news])
  const visibleItems =
    activeTab === 'announcement'
      ? companyAnnouncements
      : activeTab === 'exchange'
        ? exchangeNotices
        : headlines

  return (
    <section className="insight-section">
      <div className="insight-section-heading">
        <h3>市场资讯</h3>
        <label className="insight-news-range-toggle">
          <input type="checkbox" checked={includeOlderNews} onChange={onToggleOlderNews} />
          查询近 30 天要闻及交易所通知
          <span>下次查询生效</span>
        </label>
      </div>
      {news.length > 0 && status ? (
        <p className="insight-news-status">{status.newsMessage}</p>
      ) : null}
      <div className="insight-news-tabs" role="tablist" aria-label="要闻、公告与交易所通知分类">
        <button
          className={activeTab === 'news' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'news'}
          onClick={() => setActiveTab('news')}
        >
          要闻 {headlines.length}
        </button>
        <button
          className={activeTab === 'announcement' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'announcement'}
          onClick={() => setActiveTab('announcement')}
        >
          公告 {companyAnnouncements.length}
        </button>
        <button
          className={activeTab === 'exchange' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'exchange'}
          onClick={() => setActiveTab('exchange')}
        >
          交易所通知 {exchangeNotices.length}
        </button>
      </div>
      {visibleItems.length === 0 ? (
        <p className="insight-empty">
          {news.length === 0
            ? (status?.newsMessage ?? '正在读取新闻状态…')
            : activeTab === 'announcement'
              ? '当前没有公司公告。'
              : activeTab === 'exchange'
                ? '当前查询范围内没有交易所通知。'
                : '当前查询范围内没有要闻。'}
        </p>
      ) : (
        <div className="insight-news-list">
          {visibleItems.map((item) => (
            <button
              className="insight-news-item"
              type="button"
              onClick={() => onOpenSource(item.url)}
              key={item.id}
            >
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.source} ·{' '}
                  {new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false })} ·{' '}
                  {item.category}
                </span>
              </div>
              <ExternalLink size={14} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
