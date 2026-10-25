import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { AppButton } from '../../../components/AppButton'
import { emitCompletionNotification } from '../../../lib/completion-notifications'
import { newsSummaryKey } from '../shared/news-summary'
import type { MarketInsightStatus, MarketNewsItem, MarketNewsSummary } from '../shared/types'
import { marketInsightApi } from './api'

interface NewsTimelineProps {
  quoteId: string
  news: readonly MarketNewsItem[]
  status: MarketInsightStatus | null
  includeOlderNews: boolean
  onToggleOlderNews: () => void
  onOpenSource: (url: string) => void
}

function NewsRow({
  item,
  quoteId,
  onOpenSource
}: {
  item: MarketNewsItem
  quoteId: string
  onOpenSource: (url: string) => void
}) {
  const [generatedSummary, setGeneratedSummary] = useState<MarketNewsSummary | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const summary =
    generatedSummary && (!item.summary || generatedSummary.generatedAt >= item.summary.generatedAt)
      ? generatedSummary
      : item.summary

  const summarize = async () => {
    if (pending.current) return
    pending.current = true
    setGenerating(true)
    setError('')
    try {
      const result = await marketInsightApi.generateNewsSummary(item)
      setGeneratedSummary(result)
      emitCompletionNotification({
        quoteId,
        target: 'insight',
        message: `${item.title} AI 总结已生成`
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 资讯总结生成失败')
    } finally {
      pending.current = false
      setGenerating(false)
    }
  }

  return (
    <div className="insight-news-item">
      <div className="insight-news-copy">
        <AppButton
          variant="plain"
          className="insight-news-source"
          onClick={() => onOpenSource(item.url)}
          title={`打开原文：${item.title}`}
        >
          <strong>{item.title}</strong>
          <ExternalLink size={14} />
        </AppButton>
        <span>
          {item.source} · {new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
        {summary ? (
          <div className="insight-news-summary" aria-live="polite">
            <strong>AI 总结</strong>
            <p>{summary.content}</p>
            <small>
              {summary.model} ·{' '}
              {new Date(summary.generatedAt).toLocaleString('zh-CN', { hour12: false })}
            </small>
          </div>
        ) : null}
        {error ? (
          <p className="insight-news-summary-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <AppButton
        variant="plain"
        className="insight-news-summary-action"
        onClick={() => void summarize()}
        disabled={generating}
        aria-label={`${generating ? '正在总结' : summary ? '重新总结' : 'AI 总结'}：${item.title}`}
        title="读取官方资讯原文，使用当前 AI 模型生成总结并保存到本地"
      >
        {generating ? <RefreshCw size={14} className="is-spinning" /> : <Sparkles size={14} />}
        {generating ? '总结中' : summary ? '重新总结' : 'AI 总结'}
      </AppButton>
    </div>
  )
}

export function NewsTimeline({
  quoteId,
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
            <NewsRow
              item={item}
              quoteId={quoteId}
              onOpenSource={onOpenSource}
              key={newsSummaryKey(item)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
