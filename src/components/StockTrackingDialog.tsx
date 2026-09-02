import { Binoculars, Search, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import { STOCK_TRACKING_SOURCE_LABELS } from '../lib/stock-tracking'
import { calculateStockTrackingPerformance } from '../lib/stock-tracking-performance'
import { formatPercent } from '../lib/format'
import type {
  DailyKlineIndicator,
  StockQuote,
  StockTrackingConclusionResult,
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

interface GroupPopoverState {
  quoteId: string
  left: number
  top: number
  placement: 'above' | 'below'
}

const GROUP_POPOVER_WIDTH = 286
const GROUP_POPOVER_ESTIMATED_HEIGHT = 360

const STATUS_FILTER_OPTIONS: readonly AppSelectOption<StatusFilter>[] = [
  { value: 'all', label: '全部状态' },
  { value: 'tracking', label: '追踪中' },
  { value: 'stopped', label: '已停止' }
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

interface StockTrackingDialogProps {
  open: boolean
  profiles: StockTrackingProfiles
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  quotes: StockQuote[]
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
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

export function StockTrackingDialog({
  open,
  profiles,
  watchlist,
  watchlistGroups,
  quotes,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking,
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
  const [groupPopover, setGroupPopover] = useState<GroupPopoverState | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [profileSnapshot, setProfileSnapshot] = useState<StockTrackingProfile[]>([])
  const [trackingQuotes, setTrackingQuotes] = useState<StockQuote[]>([])
  const profilesRef = useRef(profiles)
  const quotesRef = useRef(quotes)
  const groupAnchorRef = useRef<HTMLButtonElement | null>(null)
  const groupPopoverRef = useRef<HTMLDivElement>(null)
  profilesRef.current = profiles
  quotesRef.current = quotes

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
      if (groupPopoverRef.current?.contains(target) || groupAnchorRef.current?.contains(target)) {
        return
      }
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

  useEffect(() => {
    setGroupPopover(null)
  }, [selectedQuoteId])

  useEffect(() => {
    if (open) return
    setGroupPopover(null)
    setGroupDialogOpen(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const nextProfiles = Object.values(profilesRef.current)
    const openingQuotes = quotesRef.current
    const quoteIds = nextProfiles.map((profile) => profile.quoteId)
    setProfileSnapshot(nextProfiles)
    setTrackingQuotes(openingQuotes)
    setSelectedQuoteId((current) =>
      nextProfiles.some((profile) => profile.quoteId === current)
        ? current
        : (nextProfiles[0]?.quoteId ?? '')
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

  const snapshotQuoteMap = useMemo(
    () => new Map(trackingQuotes.map((quote) => [quote.quoteId, quote] as const)),
    [trackingQuotes]
  )
  const detailQuoteMap = useMemo(
    () => new Map([...trackingQuotes, ...quotes].map((quote) => [quote.quoteId, quote] as const)),
    [quotes, trackingQuotes]
  )
  const watchlistQuoteIds = useMemo(
    () => new Set(watchlist.map((stock) => stock.quoteId)),
    [watchlist]
  )
  const trackingReturns = useMemo(
    () =>
      new Map(
        profileSnapshot.map(
          (profile) =>
            [
              profile.quoteId,
              calculateStockTrackingPerformance(profile, snapshotQuoteMap.get(profile.quoteId), [])
                .trackingReturn
            ] as const
        )
      ),
    [profileSnapshot, snapshotQuoteMap]
  )
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredProfiles = useMemo(
    () =>
      profileSnapshot
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
        .sort((left, right) => {
          switch (profileSort) {
            case 'started-desc':
              return right.startedAt.localeCompare(left.startedAt)
            case 'return-desc':
              return compareTrackingReturn(
                trackingReturns.get(left.quoteId) ?? null,
                trackingReturns.get(right.quoteId) ?? null,
                'desc'
              )
            case 'return-asc':
              return compareTrackingReturn(
                trackingReturns.get(left.quoteId) ?? null,
                trackingReturns.get(right.quoteId) ?? null,
                'asc'
              )
            case 'name-asc':
              return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
            case 'updated-desc':
              return right.updatedAt.localeCompare(left.updatedAt)
          }
        }),
    [normalizedQuery, profileSnapshot, profileSort, sourceFilter, statusFilter, trackingReturns]
  )
  const selectedSnapshotProfile =
    filteredProfiles.find((profile) => profile.quoteId === selectedQuoteId) ?? filteredProfiles[0]
  const selectedProfile = selectedSnapshotProfile
    ? (profiles[selectedSnapshotProfile.quoteId] ?? selectedSnapshotProfile)
    : undefined
  const activeGroupStock = groupPopover
    ? watchlist.find((stock) => stock.quoteId === groupPopover.quoteId)
    : undefined
  const watchlistGroupIdSet = useMemo(
    () => new Set(watchlistGroups.map((group) => group.id)),
    [watchlistGroups]
  )
  const activeGroupCount = activeGroupStock
    ? (activeGroupStock.groupIds ?? []).filter((groupId) => watchlistGroupIdSet.has(groupId)).length
    : 0
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

  const openGroupDialog = () => {
    setGroupPopover(null)
    setGroupDialogOpen(true)
  }

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
                const trackingReturn = trackingReturns.get(profile.quoteId) ?? null
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
                {!watchlistQuoteIds.has(selectedProfile.quoteId) ? (
                  <div className="stock-tracking-dialog-content-note">
                    该股票已不在自选中，历史档案仍保留。
                  </div>
                ) : null}
                <StockTrackingEditor
                  key={`${selectedProfile.quoteId}:${selectedProfile.updatedAt}`}
                  profile={selectedProfile}
                  quote={detailQuoteMap.get(selectedProfile.quoteId)}
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
                  canRestart={watchlistQuoteIds.has(selectedProfile.quoteId)}
                  groupCount={
                    (
                      watchlist.find((stock) => stock.quoteId === selectedProfile.quoteId)
                        ?.groupIds ?? []
                    ).filter((groupId) => watchlistGroupIdSet.has(groupId)).length
                  }
                  groupPopoverOpen={groupPopover?.quoteId === selectedProfile.quoteId}
                  onOpenGroups={
                    watchlistQuoteIds.has(selectedProfile.quoteId)
                      ? (anchor) => openStockGroups(selectedProfile.quoteId, anchor)
                      : undefined
                  }
                  onViewStock={
                    watchlistQuoteIds.has(selectedProfile.quoteId)
                      ? () => {
                          onViewStock(selectedProfile.quoteId)
                          onClose()
                        }
                      : undefined
                  }
                  onDeleteStock={
                    watchlistQuoteIds.has(selectedProfile.quoteId)
                      ? () => onDeleteStock(selectedProfile.quoteId)
                      : undefined
                  }
                />
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
                onManageGroups={openGroupDialog}
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
