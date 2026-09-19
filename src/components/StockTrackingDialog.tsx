import { Binoculars, History, Play, Search, Trash2, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import { STOCK_TRACKING_SOURCE_LABELS } from '../lib/stock-tracking'
import { calculateStockTrackingPerformance } from '../lib/stock-tracking-performance'
import { formatPercent } from '../lib/format'
import type {
  DailyKlineIndicator,
  StockQuote,
  StockTrackingArchiveIndex,
  StockTrackingConclusionResult,
  StockTrackingCycleSummary,
  StockTrackingProfile,
  StockTrackingProfiles,
  StockTrackingSourceType,
  WatchlistGroup,
  WatchStock
} from '../shared/types'
import { AppSelect, type AppSelectOption } from './AppSelect'
import { StockGroupQuickPopover } from './StockGroupQuickPopover'
import { StockTrackingEditor } from './StockTrackingEditor'
import { WatchlistGroupDialog } from './WatchlistGroupDialog'
import { useStockTrackingMarketData } from './useStockTrackingMarketData'
import './StockTracking.css'

type StatusFilter = 'all' | 'tracking' | 'stopped'
type SourceFilter = 'all' | StockTrackingSourceType
type ProfileSort = 'updated-desc' | 'started-desc' | 'return-desc' | 'return-asc' | 'name-asc'
type DetailMode = 'current' | 'history'

interface GroupPopoverState {
  quoteId: string
  left: number
  top: number
  placement: 'above' | 'below'
}

interface TrackingStockRow {
  quoteId: string
  code: string
  name: string
  marketLabel: string
  status: 'tracking' | 'stopped'
  activeProfile?: StockTrackingProfile
  cycles: StockTrackingCycleSummary[]
  updatedAt: string
  startedAt: string
  sourceTypes: StockTrackingSourceType[]
  tags: string[]
  lastEntryContent?: string
  trackingReturn: number | null
}

interface StockTrackingDialogProps {
  open: boolean
  profiles: StockTrackingProfiles
  archiveIndex: StockTrackingArchiveIndex
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  quotes: StockQuote[]
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (
    quoteId: string,
    result: StockTrackingConclusionResult,
    summary: string,
    deletePreviousArchives?: boolean
  ) => void
  onRestartTracking: (quoteId: string) => void
  onDeleteArchiveCycle: (cycle: StockTrackingCycleSummary) => Promise<boolean>
  onDeleteAllArchives: (quoteId: string) => Promise<boolean>
  onDeleteStock: (quoteId: string) => void
  onViewStock: (quoteId: string) => void
  onUpdateWatchlistGroups: (
    groups: WatchlistGroup[],
    groupIdsByQuoteId: Record<string, string[]>
  ) => void
  onUpdateStockGroups: (quoteId: string, groupIds: string[]) => void
  bollingerBandsEnabled: boolean
  onBollingerBandsEnabledChange: (enabled: boolean) => void
  dailyKlineIndicator: DailyKlineIndicator
  onDailyKlineIndicatorChange: (indicator: DailyKlineIndicator) => void
  onClose: () => void
}

const GROUP_POPOVER_WIDTH = 286
const GROUP_POPOVER_ESTIMATED_HEIGHT = 360

const STATUS_FILTER_OPTIONS: readonly AppSelectOption<StatusFilter>[] = [
  { value: 'all', label: '全部状态' },
  { value: 'tracking', label: '追踪中' },
  { value: 'stopped', label: '仅有历史档案' }
]

const SOURCE_FILTER_OPTIONS: readonly AppSelectOption<SourceFilter>[] = [
  { value: 'all', label: '全部来源' },
  ...Object.entries(STOCK_TRACKING_SOURCE_LABELS).map(([value, label]) => ({
    value: value as StockTrackingSourceType,
    label
  }))
]

const PROFILE_SORT_OPTIONS: readonly AppSelectOption<ProfileSort>[] = [
  { value: 'updated-desc', label: '最近更新' },
  { value: 'started-desc', label: '最近开始追踪' },
  { value: 'return-desc', label: '追踪收益从高到低' },
  { value: 'return-asc', label: '追踪收益从低到高' },
  { value: 'name-asc', label: '股票名称' }
]

function valueClass(value: number | null): string {
  if (value === null || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function compareTrackingReturn(
  left: number | null,
  right: number | null,
  direction: 'asc' | 'desc'
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'asc' ? left - right : right - left
}

function formatCycleDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

export function StockTrackingDialog({
  open,
  profiles,
  archiveIndex,
  watchlist,
  watchlistGroups,
  quotes,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking,
  onDeleteArchiveCycle,
  onDeleteAllArchives,
  onDeleteStock,
  onViewStock,
  onUpdateWatchlistGroups,
  onUpdateStockGroups,
  bollingerBandsEnabled,
  onBollingerBandsEnabledChange,
  dailyKlineIndicator,
  onDailyKlineIndicatorChange,
  onClose
}: StockTrackingDialogProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [profileSort, setProfileSort] = useState<ProfileSort>('updated-desc')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [detailMode, setDetailMode] = useState<DetailMode>('current')
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [archiveProfile, setArchiveProfile] = useState<StockTrackingProfile | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [groupPopover, setGroupPopover] = useState<GroupPopoverState | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [trackingQuotes, setTrackingQuotes] = useState<StockQuote[]>([])
  const archiveCacheRef = useRef(new Map<string, StockTrackingProfile>())
  const archiveRequestsRef = useRef(new Map<string, Promise<StockTrackingProfile>>())
  const stockRowsRef = useRef<TrackingStockRow[]>([])
  const quotesRef = useRef(quotes)
  const groupAnchorRef = useRef<HTMLButtonElement | null>(null)
  const groupPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !document.querySelector(
          '.app-select-menu, .confirm-dialog-backdrop, .watchlist-group-quick-popover, .stock-tracking-group-dialog-backdrop'
        )
      ) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!groupPopover) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (groupPopoverRef.current?.contains(target) || groupAnchorRef.current?.contains(target))
        return
      setGroupPopover(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGroupPopover(null)
    }
    const closePopover = () => setGroupPopover(null)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closePopover)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closePopover)
    }
  }, [groupPopover])

  const detailQuoteMap = useMemo(
    () => new Map([...trackingQuotes, ...quotes].map((quote) => [quote.quoteId, quote] as const)),
    [quotes, trackingQuotes]
  )
  const watchlistQuoteIds = useMemo(
    () => new Set(watchlist.map((stock) => stock.quoteId)),
    [watchlist]
  )
  const watchlistGroupIdSet = useMemo(
    () => new Set(watchlistGroups.map((group) => group.id)),
    [watchlistGroups]
  )
  const stockRows = useMemo<TrackingStockRow[]>(() => {
    const quoteIds = new Set([...Object.keys(profiles), ...Object.keys(archiveIndex)])
    return [...quoteIds].flatMap((quoteId) => {
      const activeProfile = profiles[quoteId]
      const archive = archiveIndex[quoteId]
      const latestCycle = archive?.cycles[0]
      const identity = activeProfile ?? archive
      if (!identity) return []
      const activeReturn = activeProfile
        ? calculateStockTrackingPerformance(activeProfile, detailQuoteMap.get(quoteId), [])
            .trackingReturn
        : null
      return [
        {
          quoteId,
          code: identity.code,
          name: identity.name,
          marketLabel: identity.marketLabel,
          status: activeProfile ? 'tracking' : 'stopped',
          activeProfile,
          cycles: archive?.cycles ?? [],
          updatedAt: activeProfile?.updatedAt ?? latestCycle?.updatedAt ?? '',
          startedAt: activeProfile?.startedAt ?? latestCycle?.startedAt ?? '',
          sourceTypes: activeProfile
            ? [...new Set(activeProfile.sources.map((source) => source.type))]
            : (latestCycle?.sourceTypes ?? []),
          tags: activeProfile?.tags ?? latestCycle?.tags ?? [],
          lastEntryContent: activeProfile?.entries[0]?.content ?? latestCycle?.lastEntryContent,
          trackingReturn: activeProfile ? activeReturn : (latestCycle?.trackingReturn ?? null)
        }
      ]
    })
  }, [archiveIndex, detailQuoteMap, profiles])

  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredRows = useMemo(
    () =>
      stockRows
        .filter((row) => statusFilter === 'all' || row.status === statusFilter)
        .filter((row) => sourceFilter === 'all' || row.sourceTypes.includes(sourceFilter))
        .filter((row) => {
          if (!normalizedQuery) return true
          return [
            row.name,
            row.code,
            row.marketLabel,
            ...row.tags,
            ...row.sourceTypes.map((source) => STOCK_TRACKING_SOURCE_LABELS[source])
          ]
            .join(' ')
            .toLocaleLowerCase('zh-CN')
            .includes(normalizedQuery)
        })
        .sort((left, right) => {
          switch (profileSort) {
            case 'started-desc':
              return right.startedAt.localeCompare(left.startedAt)
            case 'return-desc':
              return compareTrackingReturn(left.trackingReturn, right.trackingReturn, 'desc')
            case 'return-asc':
              return compareTrackingReturn(left.trackingReturn, right.trackingReturn, 'asc')
            case 'name-asc':
              return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
            case 'updated-desc':
              return right.updatedAt.localeCompare(left.updatedAt)
          }
        }),
    [normalizedQuery, profileSort, sourceFilter, statusFilter, stockRows]
  )
  const selectedRow = filteredRows.find((row) => row.quoteId === selectedQuoteId) ?? filteredRows[0]
  stockRowsRef.current = stockRows
  quotesRef.current = quotes
  const selectedProfile = detailMode === 'history' ? archiveProfile : selectedRow?.activeProfile
  const activeGroupStock = groupPopover
    ? watchlist.find((stock) => stock.quoteId === groupPopover.quoteId)
    : undefined
  const activeGroupCount = activeGroupStock
    ? (activeGroupStock.groupIds ?? []).filter((groupId) => watchlistGroupIdSet.has(groupId)).length
    : 0

  useEffect(() => {
    if (!open) return
    const openingRows = stockRowsRef.current
    const openingQuotes = quotesRef.current
    const quoteIds = openingRows.map((row) => row.quoteId)
    setTrackingQuotes(openingQuotes)
    setSelectedQuoteId((current) =>
      openingRows.some((row) => row.quoteId === current) ? current : (openingRows[0]?.quoteId ?? '')
    )
    if (quoteIds.length === 0) return
    let active = true
    void stockApi
      .refreshQuotesByIds(quoteIds)
      .then((refreshedQuotes) => {
        if (!active) return
        const quoteMap = new Map(
          [...openingQuotes, ...refreshedQuotes].map((quote) => [quote.quoteId, quote] as const)
        )
        setTrackingQuotes([...quoteMap.values()])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [open])

  const selectedRowQuoteId = selectedRow?.quoteId
  const selectedRowHasActiveProfile = Boolean(selectedRow?.activeProfile)
  const selectedRowFirstCycleId = selectedRow?.cycles[0]?.cycleId ?? ''
  useEffect(() => {
    if (!selectedRowQuoteId) return
    setDetailMode(selectedRowHasActiveProfile ? 'current' : 'history')
    setSelectedCycleId(selectedRowFirstCycleId)
    setArchiveProfile(null)
    setArchiveError('')
    setGroupPopover(null)
  }, [selectedRowFirstCycleId, selectedRowHasActiveProfile, selectedRowQuoteId])

  useEffect(() => {
    if (!selectedRow || detailMode !== 'history') return
    const cycleId = selectedRow.cycles.some((cycle) => cycle.cycleId === selectedCycleId)
      ? selectedCycleId
      : (selectedRow.cycles[0]?.cycleId ?? '')
    if (cycleId !== selectedCycleId) setSelectedCycleId(cycleId)
    if (!cycleId) {
      setArchiveProfile(null)
      return
    }
    const cacheKey = `${selectedRow.quoteId}:${cycleId}`
    const cached = archiveCacheRef.current.get(cacheKey)
    if (cached) {
      setArchiveProfile(cached)
      setArchiveError('')
      return
    }
    let request = archiveRequestsRef.current.get(cacheKey)
    if (!request) {
      request = stockApi.getStockTrackingArchiveCycle(selectedRow.quoteId, cycleId)
      archiveRequestsRef.current.set(cacheKey, request)
      void request.finally(() => archiveRequestsRef.current.delete(cacheKey))
    }
    let active = true
    setArchiveLoading(true)
    setArchiveError('')
    void request
      .then((profile) => {
        archiveCacheRef.current.set(cacheKey, profile)
        if (active) setArchiveProfile(profile)
      })
      .catch((reason: unknown) => {
        if (active) {
          setArchiveProfile(null)
          setArchiveError(reason instanceof Error ? reason.message : '追踪档案加载失败')
        }
      })
      .finally(() => {
        if (active) setArchiveLoading(false)
      })
    return () => {
      active = false
    }
  }, [detailMode, selectedCycleId, selectedRow])

  const marketData = useStockTrackingMarketData(open ? selectedProfile?.quoteId : undefined)
  const selectedPerformance = useMemo(
    () =>
      selectedProfile
        ? calculateStockTrackingPerformance(
            selectedProfile,
            detailQuoteMap.get(selectedProfile.quoteId),
            marketData.dailyBars
          )
        : undefined,
    [detailQuoteMap, marketData.dailyBars, selectedProfile]
  )

  const openStockGroups = (quoteId: string, anchor: HTMLButtonElement) => {
    groupAnchorRef.current = anchor
    setGroupPopover((current) => {
      if (current?.quoteId === quoteId) return null
      const rect = anchor.getBoundingClientRect()
      const placement =
        rect.bottom + GROUP_POPOVER_ESTIMATED_HEIGHT > window.innerHeight &&
        rect.top > GROUP_POPOVER_ESTIMATED_HEIGHT
          ? 'above'
          : 'below'
      return {
        quoteId,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - GROUP_POPOVER_WIDTH - 12)),
        top: placement === 'above' ? rect.top - 7 : rect.bottom + 7,
        placement
      }
    })
  }

  const toggleStockGroup = (groupId: string, checked: boolean) => {
    if (!activeGroupStock) return
    const nextGroupIds = new Set(activeGroupStock.groupIds ?? [])
    if (checked) nextGroupIds.add(groupId)
    else nextGroupIds.delete(groupId)
    onUpdateStockGroups(activeGroupStock.quoteId, [...nextGroupIds])
  }

  if (!open) return null

  const historicalCycleCount = Object.values(archiveIndex).reduce(
    (count, archive) => count + archive.cycles.length,
    0
  )

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
                {Object.keys(profiles).length} 只追踪中 · {historicalCycleCount} 个历史周期
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
              placeholder="筛选名称、代码、标签或来源"
              aria-label="筛选追踪档案"
            />
          </label>
          <AppSelect
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            label="追踪状态"
            onChange={setStatusFilter}
          />
          <AppSelect
            value={sourceFilter}
            options={SOURCE_FILTER_OPTIONS}
            label="追踪来源"
            onChange={setSourceFilter}
          />
          <AppSelect
            className="stock-tracking-sort-select"
            value={profileSort}
            options={PROFILE_SORT_OPTIONS}
            label="列表排序"
            onChange={setProfileSort}
          />
        </div>

        {filteredRows.length === 0 ? (
          <div className="stock-tracking-dialog-empty">
            <Binoculars size={34} />
            <strong>没有匹配的追踪档案</strong>
            <span>可以从收盘扫描、分红融资榜、基本面筛选或个股详情开始追踪。</span>
          </div>
        ) : (
          <div className="stock-tracking-dialog-layout">
            <aside className="stock-tracking-profile-list">
              {filteredRows.map((row) => (
                <button
                  className={`${selectedRow?.quoteId === row.quoteId ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setSelectedQuoteId(row.quoteId)}
                  key={row.quoteId}
                >
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.code}</small>
                    <em className={`is-${row.status}`}>
                      {row.status === 'tracking' ? '追踪中' : '仅有历史'}
                    </em>
                  </span>
                  <span className="stock-tracking-list-sources">
                    {row.sourceTypes
                      .map((source) => STOCK_TRACKING_SOURCE_LABELS[source])
                      .join(' · ') || '暂无来源'}
                  </span>
                  <span className="stock-tracking-list-summary">
                    <small>{row.lastEntryContent ?? '尚无记录'}</small>
                    <span className="stock-tracking-list-return">
                      <small>{row.cycles.length} 个历史周期</small>
                      <strong className={valueClass(row.trackingReturn)}>
                        {formatPercent(row.trackingReturn)}
                      </strong>
                    </span>
                  </span>
                </button>
              ))}
            </aside>

            {selectedRow ? (
              <main className="stock-tracking-dialog-content">
                {!watchlistQuoteIds.has(selectedRow.quoteId) ? (
                  <div className="stock-tracking-dialog-content-note">
                    该股票已不在自选中，历史档案仍保留。
                  </div>
                ) : null}
                <div className="stock-tracking-detail-tabs">
                  <button
                    type="button"
                    className={detailMode === 'current' ? 'is-active' : ''}
                    onClick={() => setDetailMode('current')}
                    disabled={!selectedRow.activeProfile}
                  >
                    当前追踪
                  </button>
                  <button
                    type="button"
                    className={detailMode === 'history' ? 'is-active' : ''}
                    onClick={() => setDetailMode('history')}
                  >
                    <History size={14} />
                    历史档案（{selectedRow.cycles.length}）
                  </button>
                  {!selectedRow.activeProfile && watchlistQuoteIds.has(selectedRow.quoteId) ? (
                    <button
                      className="primary-button stock-tracking-new-cycle"
                      type="button"
                      onClick={() => onRestartTracking(selectedRow.quoteId)}
                    >
                      <Play size={14} />
                      开始新一轮追踪
                    </button>
                  ) : null}
                </div>

                {detailMode === 'current' && selectedRow.activeProfile ? (
                  <StockTrackingEditor
                    key={`${selectedRow.activeProfile.cycleId}:${selectedRow.activeProfile.updatedAt}`}
                    profile={selectedRow.activeProfile}
                    quote={detailQuoteMap.get(selectedRow.quoteId)}
                    performance={selectedPerformance}
                    marketData={marketData}
                    showDailyKline
                    bollingerBandsEnabled={bollingerBandsEnabled}
                    onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                    dailyKlineIndicator={dailyKlineIndicator}
                    onDailyKlineIndicatorChange={onDailyKlineIndicatorChange}
                    onUpdateProfile={onUpdateProfile}
                    onStopTracking={onStopTracking}
                    onRestartTracking={onRestartTracking}
                    groupCount={
                      (
                        watchlist.find((stock) => stock.quoteId === selectedRow.quoteId)
                          ?.groupIds ?? []
                      ).filter((groupId) => watchlistGroupIdSet.has(groupId)).length
                    }
                    groupPopoverOpen={groupPopover?.quoteId === selectedRow.quoteId}
                    onOpenGroups={
                      watchlistQuoteIds.has(selectedRow.quoteId)
                        ? (anchor) => openStockGroups(selectedRow.quoteId, anchor)
                        : undefined
                    }
                    onViewStock={
                      watchlistQuoteIds.has(selectedRow.quoteId)
                        ? () => {
                            onViewStock(selectedRow.quoteId)
                            onClose()
                          }
                        : undefined
                    }
                    onDeleteStock={
                      watchlistQuoteIds.has(selectedRow.quoteId)
                        ? () => onDeleteStock(selectedRow.quoteId)
                        : undefined
                    }
                  />
                ) : null}

                {detailMode === 'history' ? (
                  <div className="stock-tracking-history-layout">
                    <aside className="stock-tracking-cycle-list">
                      <div className="stock-tracking-cycle-list-header">
                        <strong>历史追踪周期</strong>
                        <button
                          className="danger-button"
                          type="button"
                          disabled={selectedRow.cycles.length === 0}
                          onClick={() => void onDeleteAllArchives(selectedRow.quoteId)}
                        >
                          <Trash2 size={13} />
                          全部删除
                        </button>
                      </div>
                      {selectedRow.cycles.length === 0 ? (
                        <div className="stock-tracking-history-empty">
                          还没有已经结束的追踪周期。
                        </div>
                      ) : (
                        selectedRow.cycles.map((cycle) => (
                          <article
                            className={selectedCycleId === cycle.cycleId ? 'is-active' : ''}
                            key={cycle.cycleId}
                          >
                            <button type="button" onClick={() => setSelectedCycleId(cycle.cycleId)}>
                              <strong>
                                {formatCycleDate(cycle.startedAt)} —{' '}
                                {formatCycleDate(cycle.stoppedAt)}
                              </strong>
                              <span>{cycle.conclusion.summary || '未填写停止总结'}</span>
                              <small className={valueClass(cycle.trackingReturn)}>
                                {cycle.conclusion.result === 'expected'
                                  ? '符合预期'
                                  : cycle.conclusion.result === 'unexpected'
                                    ? '不符合预期'
                                    : '尚未验证'}{' '}
                                · {formatPercent(cycle.trackingReturn)}
                              </small>
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              aria-label={`删除 ${cycle.name} 的该追踪周期`}
                              title="删除该追踪周期"
                              onClick={() => {
                                void onDeleteArchiveCycle(cycle).then((deleted) => {
                                  if (!deleted) return
                                  archiveCacheRef.current.delete(
                                    `${cycle.quoteId}:${cycle.cycleId}`
                                  )
                                  if (selectedCycleId === cycle.cycleId) {
                                    setArchiveProfile(null)
                                    setSelectedCycleId('')
                                  }
                                })
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </article>
                        ))
                      )}
                    </aside>
                    <section className="stock-tracking-history-detail">
                      {archiveLoading ? (
                        <div className="stock-tracking-history-state">正在加载追踪档案…</div>
                      ) : null}
                      {archiveError ? (
                        <div className="stock-tracking-history-state is-error">{archiveError}</div>
                      ) : null}
                      {!archiveLoading && !archiveError && archiveProfile ? (
                        <StockTrackingEditor
                          key={`${archiveProfile.cycleId}:${archiveProfile.updatedAt}`}
                          profile={archiveProfile}
                          quote={detailQuoteMap.get(archiveProfile.quoteId)}
                          performance={selectedPerformance}
                          marketData={marketData}
                          showDailyKline
                          readOnly
                          bollingerBandsEnabled={bollingerBandsEnabled}
                          onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                          dailyKlineIndicator={dailyKlineIndicator}
                          onDailyKlineIndicatorChange={onDailyKlineIndicatorChange}
                          onUpdateProfile={() => undefined}
                          onStopTracking={() => undefined}
                          onRestartTracking={onRestartTracking}
                          onViewStock={
                            watchlistQuoteIds.has(archiveProfile.quoteId)
                              ? () => {
                                  onViewStock(archiveProfile.quoteId)
                                  onClose()
                                }
                              : undefined
                          }
                        />
                      ) : null}
                    </section>
                  </div>
                ) : null}
              </main>
            ) : null}
          </div>
        )}
        {groupPopover && activeGroupStock
          ? createPortal(
              <StockGroupQuickPopover
                id="stock-tracking-group-quick-popover"
                className="stock-tracking-group-quick-popover"
                stock={activeGroupStock}
                groups={watchlistGroups}
                groupCount={activeGroupCount}
                placement={groupPopover.placement}
                style={{ left: groupPopover.left, top: groupPopover.top }}
                popoverRef={groupPopoverRef}
                onToggleGroup={toggleStockGroup}
                onManageGroups={() => {
                  setGroupPopover(null)
                  setGroupDialogOpen(true)
                }}
                onClose={() => setGroupPopover(null)}
              />,
              document.body
            )
          : null}
        {groupDialogOpen ? (
          <WatchlistGroupDialog
            groups={watchlistGroups}
            stocks={watchlist}
            quotes={quotes}
            backdropClassName="stock-tracking-group-dialog-backdrop"
            onClose={() => setGroupDialogOpen(false)}
            onSave={(groups, groupIdsByQuoteId) => {
              onUpdateWatchlistGroups(groups, groupIdsByQuoteId)
              setGroupDialogOpen(false)
            }}
          />
        ) : null}
      </section>
    </div>,
    document.body
  )
}
