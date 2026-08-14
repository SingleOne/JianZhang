import { Binoculars, Eye, Search, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { STOCK_TRACKING_SOURCE_LABELS } from '../lib/stock-tracking'
import { calculateStockTrackingPerformance } from '../lib/stock-tracking-performance'
import { formatPercent } from '../lib/format'
import type {
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  StockTrackingProfiles,
  StockTrackingSourceType,
  WatchStock
} from '../shared/types'
import { StockTrackingEditor } from './StockTrackingEditor'
import { useStockTrackingMarketData } from './useStockTrackingMarketData'

type StatusFilter = 'all' | 'tracking' | 'stopped'
type SourceFilter = 'all' | StockTrackingSourceType

interface StockTrackingDialogProps {
  open: boolean
  profiles: StockTrackingProfiles
  watchlist: WatchStock[]
  quotes: StockQuote[]
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
  onViewStock: (quoteId: string) => void
  onClose: () => void
}

function valueClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function StockTrackingDialog({
  open,
  profiles,
  watchlist,
  quotes,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking,
  onViewStock,
  onClose
}: StockTrackingDialogProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  const quoteMap = useMemo(() => new Map(quotes.map((quote) => [quote.quoteId, quote])), [quotes])
  const watchlistQuoteIds = useMemo(
    () => new Set(watchlist.map((stock) => stock.quoteId)),
    [watchlist]
  )
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredProfiles = useMemo(
    () =>
      Object.values(profiles)
        .filter((profile) => statusFilter === 'all' || profile.status === statusFilter)
        .filter(
          (profile) =>
            sourceFilter === 'all' || profile.sources.some((source) => source.type === sourceFilter)
        )
        .filter((profile) => {
          if (!normalizedQuery) return true
          const sourceLabels = profile.sources
            .map((source) => STOCK_TRACKING_SOURCE_LABELS[source.type])
            .join(' ')
          return [
            profile.name,
            profile.code,
            profile.marketLabel,
            profile.thesis,
            ...profile.tags,
            sourceLabels
          ]
            .join(' ')
            .toLocaleLowerCase('zh-CN')
            .includes(normalizedQuery)
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [normalizedQuery, profiles, sourceFilter, statusFilter]
  )
  const selectedProfile =
    profiles[selectedQuoteId] &&
    filteredProfiles.some((profile) => profile.quoteId === selectedQuoteId)
      ? profiles[selectedQuoteId]
      : filteredProfiles[0]
  const marketData = useStockTrackingMarketData(open ? selectedProfile?.quoteId : undefined)
  const selectedPerformance = useMemo(
    () =>
      selectedProfile
        ? calculateStockTrackingPerformance(
            selectedProfile,
            quoteMap.get(selectedProfile.quoteId),
            marketData.dailyBars
          )
        : undefined,
    [marketData.dailyBars, quoteMap, selectedProfile]
  )

  if (!open) return null

  return createPortal(
    <div className="stock-tracking-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="stock-tracking-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-tracking-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="stock-tracking-dialog-header">
          <div>
            <span>
              <Binoculars size={20} />
            </span>
            <div>
              <strong id="stock-tracking-dialog-title">追踪复盘</strong>
              <small>
                {Object.values(profiles).filter((profile) => profile.status === 'tracking').length}{' '}
                只追踪中 · {Object.keys(profiles).length} 份历史档案
              </small>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭追踪复盘">
            <X size={18} />
          </button>
        </header>

        <div className="stock-tracking-dialog-toolbar">
          <label>
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选名称、代码、标签、逻辑或来源"
              aria-label="筛选追踪档案"
            />
          </label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">全部状态</option>
            <option value="tracking">追踪中</option>
            <option value="stopped">已停止</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
          >
            <option value="all">全部来源</option>
            {Object.entries(STOCK_TRACKING_SOURCE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {filteredProfiles.length === 0 ? (
          <div className="stock-tracking-dialog-empty">
            <Binoculars size={34} />
            <strong>没有匹配的追踪档案</strong>
            <span>可以从收盘扫描、分红融资榜、基本面筛选或个股详情开始追踪。</span>
          </div>
        ) : (
          <div className="stock-tracking-dialog-layout">
            <aside className="stock-tracking-profile-list">
              {filteredProfiles.map((profile) => {
                const quote = quoteMap.get(profile.quoteId)
                const trackingReturn = calculateStockTrackingPerformance(
                  profile,
                  quote,
                  []
                ).trackingReturn
                const lastEntry = profile.entries[0]
                return (
                  <button
                    className={`${selectedProfile?.quoteId === profile.quoteId ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setSelectedQuoteId(profile.quoteId)}
                    key={profile.quoteId}
                  >
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.code}</small>
                      <em className={`is-${profile.status}`}>
                        {profile.status === 'tracking' ? '追踪中' : '已停止'}
                      </em>
                    </span>
                    <span className="stock-tracking-list-sources">
                      {[
                        ...new Set(
                          profile.sources.map((source) => STOCK_TRACKING_SOURCE_LABELS[source.type])
                        )
                      ].join(' · ')}
                    </span>
                    <span className="stock-tracking-list-summary">
                      <small>{lastEntry?.content ?? '尚无记录'}</small>
                      <span className="stock-tracking-list-return">
                        <small>追踪以来</small>
                        <strong className={valueClass(trackingReturn)}>
                          {formatPercent(trackingReturn)}
                        </strong>
                      </span>
                    </span>
                  </button>
                )
              })}
            </aside>

            {selectedProfile ? (
              <main className="stock-tracking-dialog-content">
                <div className="stock-tracking-dialog-content-actions">
                  {watchlistQuoteIds.has(selectedProfile.quoteId) ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        onViewStock(selectedProfile.quoteId)
                        onClose()
                      }}
                    >
                      <Eye size={14} />
                      查看股票详情
                    </button>
                  ) : (
                    <span>该股票已不在自选中，历史档案仍保留。</span>
                  )}
                </div>
                <StockTrackingEditor
                  key={`${selectedProfile.quoteId}:${selectedProfile.updatedAt}`}
                  profile={selectedProfile}
                  quote={quoteMap.get(selectedProfile.quoteId)}
                  performance={selectedPerformance}
                  marketData={marketData}
                  onUpdateProfile={onUpdateProfile}
                  onStopTracking={onStopTracking}
                  onRestartTracking={onRestartTracking}
                  canRestart={watchlistQuoteIds.has(selectedProfile.quoteId)}
                />
              </main>
            ) : null}
          </div>
        )}
      </section>
    </div>,
    document.body
  )
}
