import { ExternalLink } from 'lucide-react'
import type { MarketInsightStatus, MarketNewsItem } from '../shared/types'

interface NewsTimelineProps {
  news: readonly MarketNewsItem[]
  status: MarketInsightStatus | null
  onOpenSource: (url: string) => void
}

export function NewsTimeline({ news, status, onOpenSource }: NewsTimelineProps) {
  return (
    <section className="insight-section">
      <h3>要闻与公告</h3>
      {news.length > 0 && status ? <p className="insight-news-status">{status.newsMessage}</p> : null}
      {news.length === 0 ? <p className="insight-empty">{status?.newsMessage ?? '正在读取新闻状态…'}</p> : (
        <div className="insight-news-list">
          {news.map((item) => (
            <button className="insight-news-item" type="button" onClick={() => onOpenSource(item.url)} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.source} · {new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false })} · {item.category}</span>
              </div>
              <ExternalLink size={14} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
