import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  MonitorUp,
  RotateCcw,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculatePortfolioQualitySummary } from '../lib/portfolio-quality'
import type { StockDetailNavigationRequest } from '../lib/completion-notifications'
import type {
  DividendFinancingRankingItem,
  StockAlertRule,
  StockPosition,
  StockPositionSnapshot,
  StockQuote,
  StockSelectionRequest,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  StockTrackingProfiles,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingAccounts,
  TTradingFeeSettings,
  TradingCalendarSettings,
  StockMarket,
  WatchlistColumnId,
  WatchlistGroup,
  WatchStock
} from '../shared/types'
import {
  marketCapabilitiesForQuoteId,
  marketFromQuoteId,
  STOCK_MARKET_LABELS
} from '../shared/stock-market'
import {
  hasFundamentalRisk,
  matchesFundamentalDividendFilter,
  matchesFundamentalWatchlistFilter,
  summarizeFundamentalDividendWatchlist,
  summarizeFundamentalWatchlist,
  type FundamentalDividendFilter,
  type FundamentalPeerComparison,
  type FundamentalScreeningEvaluation,
  type FundamentalWatchlistFilter
} from '../lib/fundamental-screening'
import { normalizeWatchlistColumnOrder } from '../shared/types'
import { PositionEditor } from './PositionEditor'
import { PortfolioQualityDialog } from './PortfolioQualityDialog'
import { StockAlertDialog } from './StockAlertDialog'
import { TTradingDrawer } from './TTradingDrawer'
import { WatchlistGroupDialog } from './WatchlistGroupDialog'
import {
  COLUMN_META,
  DELETE_COLUMN_WIDTH,
  ORDER_COLUMN_WIDTH,
  sortRows,
  TABLE_MIN_WIDTH,
  type SectorFilterOption,
  type SortState,
  type StockRowData
} from './watchlist-table/columns'
import { WatchlistFilters } from './watchlist-table/WatchlistFilters'
import { FundamentalWatchlistOverview } from './watchlist-table/FundamentalWatchlistOverview'
import { todayRadarSignals, WatchlistRow } from './watchlist-table/WatchlistRow'
import { useDragReorder } from './watchlist-table/useDragReorder'

interface WatchlistTableProps {
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  quotes: StockQuote[]
  dividendFinancingByCode: ReadonlyMap<string, DividendFinancingRankingItem>
  dividendFinancingSnapshotDate?: string
  dividendFinancingStaleReason?: string | null
  fundamentalScreeningByCode: ReadonlyMap<string, FundamentalScreeningEvaluation>
  fundamentalPeerComparisonsByCode: ReadonlyMap<string, FundamentalPeerComparison>
  fundamentalSnapshotDate?: string
  fundamentalGeneratedAt?: string
  fundamentalStaleReason?: string | null
  columnOrder: WatchlistColumnId[]
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  selectedQuoteId: string | null
  stockSelectionRequest: StockSelectionRequest | null
  detailNavigationRequest: StockDetailNavigationRequest | null
  tTradingAccounts: TTradingAccounts
  tTradingFees: TTradingFeeSettings
  tPlanDefaults: TPlanDefaultSettings
  tFloatingProfitAlertDefaultThreshold: number
  tradingCalendar: TradingCalendarSettings
  onSelect: (quoteId: string) => void
  onDetailNavigationHandled: (requestId: string) => void
  onToggleTaskbar: (quoteId: string) => void
  onTogglePriority: (quoteId: string) => void
  onEditPosition: (
    quoteId: string,
    position: StockPosition | undefined,
    showRadarSignals: boolean,
    positionSnapshots: StockPositionSnapshot[],
    updatedAccount?: TTradingAccount
  ) => void
  onUpdateTTrading: (
    quoteId: string,
    account: TTradingAccount,
    position: StockPosition | undefined
  ) => void
  onUpdateStockAlerts: (quoteId: string, rules: StockAlertRule[]) => void
  stockTrackingProfiles: StockTrackingProfiles
  onStartTracking: (quoteId: string) => void
  onUpdateTracking: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
  onReorder: (sourceQuoteId: string, targetQuoteId: string) => void
  onPin: (quoteId: string) => void
  onColumnOrderChange: (columnOrder: WatchlistColumnId[]) => void
  onUpdateWatchlistGroups: (
    groups: WatchlistGroup[],
    groupIdsByQuoteId: Record<string, string[]>
  ) => void
  onChipDistributionEnabledChange: (enabled: boolean) => void
  onBollingerBandsEnabledChange: (enabled: boolean) => void
  onRemove: (quoteId: string) => void
}

interface RadarPopoverState {
  quoteId: string
  left: number
  top: number
  placement: 'above' | 'below'
}

const ALL_FILTER = 'all'
const UNGROUPED_FILTER = 'ungrouped'
const NO_SECTOR_FILTER = 'no-sector'

const FUNDAMENTAL_FILTER_LABELS: Record<FundamentalWatchlistFilter, string> = {
  all: '全部',
  passed: '基本',
  review: '待核',
  missing: '缺数',
  financial: '金融',
  unavailable: '无数据',
  roe: 'ROE待核',
  cash: '现金待核',
  debt: '杠杆待核'
}

const VALUE_FILTER_LABELS: Record<FundamentalDividendFilter, string> = {
  all: '全部',
  dual: '双优',
  fundamental: '仅基',
  dividend: '仅分',
  unlabeled: '暂无'
}

type ColumnMove = -1 | 1 | 'start' | 'end'

const RADAR_SIGNAL_DESCRIPTIONS: Record<string, string> = {
  4: '股价触及涨停价，并有买单将涨停价封住。',
  8: '股价触及跌停价，并有卖单将跌停价封住。',
  16: '原本封住的涨停板被卖单打开，股价离开涨停价。',
  32: '原本封住的跌停板被买单打开，股价离开跌停价。',
  64: '盘口中出现较大的买入委托或主动买入。',
  128: '盘口中出现较大的卖出委托或主动卖出。',
  8193: '短时间内出现金额较大的主动买入成交。',
  8194: '短时间内出现金额较大的主动卖出成交。',
  8201: '股价在短时间内快速向上拉升。',
  8202: '股价下跌后在短时间内明显回升。',
  8203: '股价在较高位置短时间内快速下跌。',
  8204: '股价的下跌速度在短时间内明显加快。',
  8207: '集合竞价阶段的股票价格明显上涨。',
  8208: '集合竞价阶段的股票价格明显下跌。',
  8209: '股票开盘价高于近5个交易日均线。',
  8210: '股票开盘价低于近5个交易日均线。',
  8211: '价格相对上一交易日形成向上的跳空缺口。',
  8212: '价格相对上一交易日形成向下的跳空缺口。',
  8213: '股价达到近60个交易日的新高。',
  8214: '股价达到近60个交易日的新低。',
  8215: '股价在近60个交易日内出现较大幅度上涨。',
  8216: '股价在近60个交易日内出现较大幅度下跌。'
}

export function WatchlistTable({
  watchlist,
  watchlistGroups,
  quotes,
  dividendFinancingByCode,
  dividendFinancingSnapshotDate,
  dividendFinancingStaleReason,
  fundamentalScreeningByCode,
  fundamentalPeerComparisonsByCode,
  fundamentalSnapshotDate,
  fundamentalGeneratedAt,
  fundamentalStaleReason,
  columnOrder,
  priorityRefreshSeconds,
  regularRefreshSeconds,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  selectedQuoteId,
  stockSelectionRequest,
  detailNavigationRequest,
  tTradingAccounts,
  tTradingFees,
  tPlanDefaults,
  tFloatingProfitAlertDefaultThreshold,
  tradingCalendar,
  onSelect,
  onDetailNavigationHandled,
  onToggleTaskbar,
  onTogglePriority,
  onEditPosition,
  onUpdateTTrading,
  onUpdateStockAlerts,
  stockTrackingProfiles,
  onStartTracking,
  onUpdateTracking,
  onStopTracking,
  onRestartTracking,
  onReorder,
  onPin,
  onColumnOrderChange,
  onUpdateWatchlistGroups,
  onChipDistributionEnabledChange,
  onBollingerBandsEnabledChange,
  onRemove
}: WatchlistTableProps) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [editingStock, setEditingStock] = useState<WatchStock | null>(null)
  const [tTradingStock, setTTradingStock] = useState<WatchStock | null>(null)
  const [stockAlertStock, setStockAlertStock] = useState<WatchStock | null>(null)
  const [closingQuoteIds, setClosingQuoteIds] = useState<Set<string>>(() => new Set())
  const [radarPopover, setRadarPopover] = useState<RadarPopoverState | null>(null)
  const [locatedQuoteId, setLocatedQuoteId] = useState<string | null>(null)
  const [customGroupFilter, setCustomGroupFilter] = useState(ALL_FILTER)
  const [sectorFilter, setSectorFilter] = useState(ALL_FILTER)
  const [marketFilter, setMarketFilter] = useState<StockMarket | 'all'>('all')
  const [fundamentalFilter, setFundamentalFilter] = useState<FundamentalWatchlistFilter>('all')
  const [valueFilter, setValueFilter] = useState<FundamentalDividendFilter>('all')
  const [riskOnly, setRiskOnly] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [portfolioQualityOpen, setPortfolioQualityOpen] = useState(false)
  const [quoteStatusNow, setQuoteStatusNow] = useState(() => new Date())
  const tableScrollerRef = useRef<HTMLDivElement>(null)
  const radarAnchorRef = useRef<HTMLButtonElement | null>(null)
  const radarPopoverRef = useRef<HTMLDivElement>(null)
  const locateTimerRef = useRef<number | undefined>(undefined)
  const locateFrameRef = useRef<number | undefined>(undefined)
  const selectedQuoteIdRef = useRef(selectedQuoteId)
  selectedQuoteIdRef.current = selectedQuoteId
  const tradingCalendarClosedDates = tradingCalendar.markets.CN.closedDates

  useEffect(() => {
    const timer = window.setInterval(() => setQuoteStatusNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const renderedColumnOrder = useMemo(
    () => normalizeWatchlistColumnOrder(columnOrder),
    [columnOrder]
  )
  const adjustableColumnOrder = useMemo(
    () => renderedColumnOrder.slice(0, -1),
    [renderedColumnOrder]
  )
  const [columnMenuOrder, setColumnMenuOrder] = useState<WatchlistColumnId[]>(
    () => adjustableColumnOrder
  )
  const {
    draggingQuoteId,
    dragOverQuoteId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd
  } = useDragReorder({ disabled: Boolean(sort), onReorder })

  const rows = useMemo<StockRowData[]>(() => {
    const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
    return watchlist.map((stock, manualIndex) => {
      const quote = quoteMap.get(stock.quoteId)
      const capabilities = marketCapabilitiesForQuoteId(stock.quoteId)
      return {
        stock,
        quote,
        dividendFinancing: capabilities.dividendFinancing
          ? dividendFinancingByCode.get(stock.code)
          : undefined,
        fundamentalScreening: capabilities.fundamentals
          ? fundamentalScreeningByCode.get(stock.code)
          : undefined,
        fundamentalPeerComparison: capabilities.fundamentals
          ? fundamentalPeerComparisonsByCode.get(stock.code)
          : undefined,
        metrics: calculatePositionMetrics(stock.position, quote, tTradingAccounts[stock.quoteId]),
        manualIndex
      }
    })
  }, [
    dividendFinancingByCode,
    fundamentalPeerComparisonsByCode,
    fundamentalScreeningByCode,
    quotes,
    tTradingAccounts,
    watchlist
  ])

  const groupCounts = useMemo(
    () =>
      new Map(
        watchlistGroups.map((group) => [
          group.id,
          rows.filter(({ stock }) => stock.groupIds?.includes(group.id)).length
        ])
      ),
    [rows, watchlistGroups]
  )
  const ungroupedCount = useMemo(
    () =>
      rows.filter(
        ({ stock }) => !watchlistGroups.some((group) => stock.groupIds?.includes(group.id))
      ).length,
    [rows, watchlistGroups]
  )
  const sectorOptions = useMemo<SectorFilterOption[]>(() => {
    const sectors = new Map<string, SectorFilterOption>()
    for (const { quote } of rows) {
      const sector = quote?.sector
      if (!sector) continue
      const current = sectors.get(sector.quoteId)
      sectors.set(sector.quoteId, {
        quoteId: sector.quoteId,
        name: sector.name,
        count: (current?.count ?? 0) + 1
      })
    }
    return [...sectors.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [rows])
  const noSectorCount = useMemo(() => rows.filter(({ quote }) => !quote?.sector).length, [rows])
  const scopeRows = useMemo(
    () =>
      rows.filter(({ stock, quote }) => {
        const matchesGroup =
          customGroupFilter === ALL_FILTER ||
          (customGroupFilter === UNGROUPED_FILTER
            ? !watchlistGroups.some((group) => stock.groupIds?.includes(group.id))
            : Boolean(stock.groupIds?.includes(customGroupFilter)))
        const matchesSector =
          sectorFilter === ALL_FILTER ||
          (sectorFilter === NO_SECTOR_FILTER
            ? !quote?.sector
            : quote?.sector?.quoteId === sectorFilter)
        const matchesMarket =
          marketFilter === ALL_FILTER || marketFromQuoteId(stock.quoteId) === marketFilter
        return matchesGroup && matchesSector && matchesMarket
      }),
    [customGroupFilter, marketFilter, rows, sectorFilter, watchlistGroups]
  )
  const fundamentalSummary = useMemo(
    () =>
      summarizeFundamentalWatchlist(
        scopeRows
          .filter(({ stock }) => marketCapabilitiesForQuoteId(stock.quoteId).fundamentals)
          .map(({ fundamentalScreening }) => fundamentalScreening)
      ),
    [scopeRows]
  )
  const valueDataReady = Boolean(fundamentalSnapshotDate && dividendFinancingSnapshotDate)
  const valueDataStaleReason = [fundamentalStaleReason, dividendFinancingStaleReason]
    .filter((reason): reason is string => Boolean(reason))
    .join('；')
  const valueSummary = useMemo(
    () =>
      valueDataReady
        ? summarizeFundamentalDividendWatchlist(
            scopeRows
              .filter(
                ({ stock }) => marketCapabilitiesForQuoteId(stock.quoteId).dividendFinancing
              )
              .map(({ fundamentalScreening, dividendFinancing }) => ({
                evaluation: fundamentalScreening,
                hasDividendLabel: Boolean(dividendFinancing)
              }))
          )
        : null,
    [scopeRows, valueDataReady]
  )
  useEffect(() => {
    if (valueDataReady) return
    setValueFilter('all')
    setSort((current) => (current?.column === 'valueTags' ? null : current))
  }, [valueDataReady])
  const portfolioQualitySummary = useMemo(
    () =>
      calculatePortfolioQualitySummary(
        rows.flatMap(({ stock, quote, metrics, fundamentalScreening, dividendFinancing }) =>
          marketCapabilitiesForQuoteId(stock.quoteId).position && stock.position
            ? [
                {
                  quoteId: stock.quoteId,
                  code: stock.code,
                  name: stock.name,
                  industryName:
                    quote?.sector?.name ?? fundamentalScreening?.company.industryName ?? '行业待核',
                  marketValue: metrics.marketValue,
                  costValue: stock.position.cost * stock.position.quantity,
                  fundamentalEvaluation: fundamentalScreening,
                  hasDividendLabel: Boolean(dividendFinancing)
                }
              ]
            : []
        )
      ),
    [rows]
  )
  const filteredRows = useMemo(
    () =>
      scopeRows.filter(({ stock, fundamentalScreening, dividendFinancing }) => {
        if (!marketCapabilitiesForQuoteId(stock.quoteId).fundamentals) {
          return fundamentalFilter === 'all' && valueFilter === 'all' && !riskOnly
        }
        return (
          matchesFundamentalWatchlistFilter(fundamentalScreening, fundamentalFilter) &&
          (valueFilter === 'all' ||
            (valueDataReady &&
              matchesFundamentalDividendFilter(
                {
                  evaluation: fundamentalScreening,
                  hasDividendLabel: Boolean(dividendFinancing)
                },
                valueFilter
              ))) &&
          (!riskOnly || hasFundamentalRisk(fundamentalScreening))
        )
      }),
    [fundamentalFilter, riskOnly, scopeRows, valueDataReady, valueFilter]
  )
  const displayedRows = useMemo(
    () => (sort ? sortRows(filteredRows, sort, tradingCalendarClosedDates) : filteredRows),
    [filteredRows, sort, tradingCalendarClosedDates]
  )
  const displayedStocks = useMemo(() => displayedRows.map(({ stock }) => stock), [displayedRows])
  const customGroupFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: '全部分组', count: rows.length },
      ...watchlistGroups.map((group) => ({
        value: group.id,
        label: group.name,
        count: groupCounts.get(group.id) ?? 0
      })),
      { value: UNGROUPED_FILTER, label: '未分组', count: ungroupedCount }
    ],
    [groupCounts, rows.length, ungroupedCount, watchlistGroups]
  )
  const sectorFilterOptions = useMemo(
    () => [
      {
        value: ALL_FILTER,
        label: '全部板块',
        count: rows.length,
        description: '全部自选股票'
      },
      ...sectorOptions.map((sector) => ({
        value: sector.quoteId,
        label: sector.name,
        count: sector.count,
        description: '自动板块'
      })),
      ...(noSectorCount > 0
        ? [
            {
              value: NO_SECTOR_FILTER,
              label: '未获取板块',
              count: noSectorCount,
              description: '暂无板块数据'
            }
          ]
        : [])
    ],
    [noSectorCount, rows.length, sectorOptions]
  )
  const marketFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: '全部市场', count: rows.length },
      ...(['CN', 'HK', 'US'] as const).map((market) => ({
        value: market,
        label: STOCK_MARKET_LABELS[market],
        count: rows.filter(({ stock }) => marketFromQuoteId(stock.quoteId) === market).length
      }))
    ],
    [rows]
  )
  const selectedGroupName = watchlistGroups.find((group) => group.id === customGroupFilter)?.name
  const selectedSectorName = sectorOptions.find((sector) => sector.quoteId === sectorFilter)?.name
  const activeRadarRow = radarPopover
    ? rows.find(({ stock }) => stock.quoteId === radarPopover.quoteId)
    : undefined

  useEffect(() => {
    if (
      customGroupFilter !== ALL_FILTER &&
      customGroupFilter !== UNGROUPED_FILTER &&
      !watchlistGroups.some((group) => group.id === customGroupFilter)
    ) {
      setCustomGroupFilter(ALL_FILTER)
    }
  }, [customGroupFilter, watchlistGroups])

  useEffect(() => {
    if (
      sectorFilter !== ALL_FILTER &&
      sectorFilter !== NO_SECTOR_FILTER &&
      !sectorOptions.some((sector) => sector.quoteId === sectorFilter)
    ) {
      setSectorFilter(ALL_FILTER)
    }
  }, [sectorFilter, sectorOptions])

  useEffect(
    () => () => {
      window.clearTimeout(locateTimerRef.current)
      window.cancelAnimationFrame(locateFrameRef.current ?? 0)
    },
    []
  )

  useEffect(() => {
    if (!radarPopover) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (radarPopoverRef.current?.contains(target) || radarAnchorRef.current?.contains(target)) {
        return
      }
      setRadarPopover(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRadarPopover(null)
    }
    const closePopover = () => setRadarPopover(null)
    const scroller = tableScrollerRef.current
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closePopover)
    scroller?.addEventListener('scroll', closePopover)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closePopover)
      scroller?.removeEventListener('scroll', closePopover)
    }
  }, [radarPopover])

  const moveColumn = (columnId: WatchlistColumnId, move: ColumnMove) => {
    const currentIndex = adjustableColumnOrder.indexOf(columnId)
    if (currentIndex === -1) return

    const nextIndex =
      move === 'start' ? 0 : move === 'end' ? adjustableColumnOrder.length - 1 : currentIndex + move
    if (nextIndex < 0 || nextIndex >= adjustableColumnOrder.length || nextIndex === currentIndex) {
      return
    }

    const nextOrder = [...adjustableColumnOrder]
    const [movedColumn] = nextOrder.splice(currentIndex, 1)
    nextOrder.splice(nextIndex, 0, movedColumn)
    onColumnOrderChange([...nextOrder, 'operation'])
  }

  const changeSort = (column: WatchlistColumnId) => {
    if (!COLUMN_META[column].sortable) return
    setSort((current) => {
      if (current?.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: column === 'stock' ? 'asc' : 'desc' }
    })
  }

  const toggleStockDetails = useCallback(
    (quoteId: string) => {
      const currentSelectedQuoteId = selectedQuoteIdRef.current
      setClosingQuoteIds((current) => {
        const next = new Set(current)
        if (currentSelectedQuoteId) next.add(currentSelectedQuoteId)
        if (currentSelectedQuoteId !== quoteId) next.delete(quoteId)
        return next
      })
      onSelect(quoteId)
    },
    [onSelect]
  )

  const finishClosingStockDetails = useCallback((quoteId: string) => {
    setClosingQuoteIds((current) => {
      const next = new Set(current)
      next.delete(quoteId)
      return next
    })
  }, [])

  const scrollToStock = useCallback(
    (quoteId: string, alignment: 'center' | 'sticky-top' = 'center') => {
      const scroller = tableScrollerRef.current
      const row = scroller?.querySelector<HTMLTableRowElement>(`tr[data-quote-id="${quoteId}"]`)
      if (!scroller || !row) return

      const scrollerRect = scroller.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const stickyTop =
        alignment === 'sticky-top' ? Number.parseFloat(window.getComputedStyle(row).top) || 0 : 0
      const targetTop =
        scroller.scrollTop +
        rowRect.top -
        scrollerRect.top -
        (alignment === 'sticky-top' ? stickyTop : (scroller.clientHeight - rowRect.height) / 2)
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      row.focus({ preventScroll: true })
      window.clearTimeout(locateTimerRef.current)
      window.cancelAnimationFrame(locateFrameRef.current ?? 0)
      setLocatedQuoteId(null)
      locateFrameRef.current = window.requestAnimationFrame(() => {
        setLocatedQuoteId(quoteId)
        locateTimerRef.current = window.setTimeout(() => setLocatedQuoteId(null), 2000)
      })
    },
    []
  )

  const openRadar = useCallback((quoteId: string, anchor: HTMLButtonElement) => {
    radarAnchorRef.current = anchor
    setRadarPopover((current) => {
      if (current?.quoteId === quoteId) return null
      const rect = anchor.getBoundingClientRect()
      const placement = rect.bottom + 280 > window.innerHeight && rect.top > 280 ? 'above' : 'below'
      return {
        quoteId,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
        top: placement === 'above' ? rect.top - 7 : rect.bottom + 7,
        placement
      }
    })
  }, [])

  const handlePin = useCallback(
    (quoteId: string) => {
      setSort(null)
      onPin(quoteId)
    },
    [onPin]
  )
  const openPositionEditor = useCallback((stock: WatchStock) => setEditingStock(stock), [])
  const openStockAlert = useCallback((stock: WatchStock) => setStockAlertStock(stock), [])
  const openTTrading = useCallback((stock: WatchStock) => setTTradingStock(stock), [])
  const openGroupDialog = useCallback(() => setGroupDialogOpen(true), [])
  const resetFilters = useCallback(() => {
    setCustomGroupFilter(ALL_FILTER)
    setSectorFilter(ALL_FILTER)
    setMarketFilter(ALL_FILTER)
    setFundamentalFilter('all')
    setValueFilter('all')
    setRiskOnly(false)
  }, [])
  const toggleValueTagSort = useCallback(() => {
    setSort((current) => {
      if (current?.column !== 'valueTags') return { column: 'valueTags', direction: 'desc' }
      if (current.direction === 'desc') return { column: 'valueTags', direction: 'asc' }
      return null
    })
  }, [])
  const locatePortfolioHolding = useCallback(
    (quoteId: string) => {
      setPortfolioQualityOpen(false)
      resetFilters()
      window.requestAnimationFrame(() => scrollToStock(quoteId))
    },
    [resetFilters, scrollToStock]
  )

  const detailNavigationRequestId = detailNavigationRequest?.id
  const detailNavigationQuoteId = detailNavigationRequest?.quoteId
  const stockSelectionRequestId = stockSelectionRequest?.id
  const stockSelectionQuoteId = stockSelectionRequest?.quoteId
  const stockSelectionScrollAlignment = stockSelectionRequest?.scrollAlignment

  useEffect(() => {
    if (
      !stockSelectionRequestId ||
      !stockSelectionQuoteId ||
      stockSelectionScrollAlignment !== 'sticky-top'
    ) {
      return
    }
    resetFilters()
    window.requestAnimationFrame(() => scrollToStock(stockSelectionQuoteId, 'sticky-top'))
  }, [
    resetFilters,
    scrollToStock,
    stockSelectionQuoteId,
    stockSelectionRequestId,
    stockSelectionScrollAlignment
  ])

  useEffect(() => {
    if (!detailNavigationRequestId || !detailNavigationQuoteId) return
    resetFilters()
    window.requestAnimationFrame(() => scrollToStock(detailNavigationQuoteId))
  }, [detailNavigationQuoteId, detailNavigationRequestId, resetFilters, scrollToStock])

  if (watchlist.length === 0) {
    return (
      <div className="empty-watchlist">
        <div className="empty-watchlist-icon">
          <MonitorUp size={24} />
        </div>
        <strong>还没有自选股票</strong>
        <span>在上方输入股票代码或名称开始添加</span>
      </div>
    )
  }

  return (
    <div className="watchlist-table-area">
      <div className="table-toolbar">
        <span>
          {sort
            ? `当前按“${COLUMN_META[sort.column].label}”${sort.direction === 'asc' ? '升序' : '降序'}排列`
            : '当前为手动排序 · 使用最左侧的拖动手柄或置顶按钮调整顺序'}
          {customGroupFilter === ALL_FILTER
            ? ''
            : ` · 分组：${customGroupFilter === UNGROUPED_FILTER ? '未分组' : selectedGroupName}`}
          {sectorFilter === ALL_FILTER
            ? ''
            : ` · 板块：${sectorFilter === NO_SECTOR_FILTER ? '未获取板块' : selectedSectorName}`}
          {marketFilter === ALL_FILTER ? '' : ` · 市场：${STOCK_MARKET_LABELS[marketFilter]}`}
          {fundamentalFilter === 'all'
            ? ''
            : ` · 基本面：${FUNDAMENTAL_FILTER_LABELS[fundamentalFilter]}`}
          {valueFilter === 'all' ? '' : ` · 价值组合：${VALUE_FILTER_LABELS[valueFilter]}`}
          {riskOnly ? ' · 基本面：有风险' : ''}
          {customGroupFilter !== ALL_FILTER ||
          sectorFilter !== ALL_FILTER ||
          marketFilter !== ALL_FILTER ||
          fundamentalFilter !== 'all' ||
          valueFilter !== 'all' ||
          riskOnly
            ? ` · 显示 ${displayedRows.length}/${rows.length} 只`
            : ''}
        </span>
        <div className="table-toolbar-actions">
          <WatchlistFilters
            customGroupFilter={customGroupFilter}
            customGroupOptions={customGroupFilterOptions}
            sectorFilter={sectorFilter}
            sectorOptions={sectorFilterOptions}
            marketFilter={marketFilter}
            marketOptions={marketFilterOptions}
            displayedStocks={displayedStocks}
            onCustomGroupChange={setCustomGroupFilter}
            onSectorChange={setSectorFilter}
            onMarketChange={setMarketFilter}
            onManageGroups={openGroupDialog}
            onChooseStock={scrollToStock}
          />
          <button
            className="secondary-button table-tool-button"
            type="button"
            disabled={!sort}
            onClick={() => setSort(null)}
            title="返回最近一次手动调整并保存的顺序"
          >
            <RotateCcw size={15} />
            恢复手动排序
          </button>
          <details
            className="column-order-menu"
            onToggle={(event) => {
              if (event.currentTarget.open) setColumnMenuOrder([...adjustableColumnOrder])
            }}
          >
            <summary className="secondary-button table-tool-button">
              <Columns3 size={15} />
              调整列位置
            </summary>
            <div className="column-order-popover">
              <div className="column-order-heading">
                <strong>列显示顺序</strong>
                <span>顺序将在下次打开时更新</span>
              </div>
              {columnMenuOrder.map((columnId) => {
                const currentIndex = adjustableColumnOrder.indexOf(columnId)
                const isFirst = currentIndex === 0
                const isLast = currentIndex === adjustableColumnOrder.length - 1
                return (
                  <div className="column-order-item" key={columnId}>
                    <span>{COLUMN_META[columnId].label}</span>
                    <span>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isFirst}
                        onClick={() => moveColumn(columnId, 'start')}
                        aria-label={`将${COLUMN_META[columnId].label}列移到最左侧`}
                        title="移到最左侧"
                      >
                        <ChevronsLeft size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isFirst}
                        onClick={() => moveColumn(columnId, -1)}
                        aria-label={`向左移动${COLUMN_META[columnId].label}列`}
                        title="向左移动一列"
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isLast}
                        onClick={() => moveColumn(columnId, 1)}
                        aria-label={`向右移动${COLUMN_META[columnId].label}列`}
                        title="向右移动一列"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button column-move-button"
                        type="button"
                        disabled={isLast}
                        onClick={() => moveColumn(columnId, 'end')}
                        aria-label={`将${COLUMN_META[columnId].label}列移到最右侧`}
                        title="移到最右侧"
                      >
                        <ChevronsRight size={14} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      </div>

      <FundamentalWatchlistOverview
        summary={fundamentalSummary}
        valueSummary={valueSummary}
        portfolioQuality={portfolioQualitySummary}
        activeFilter={fundamentalFilter}
        activeValueFilter={valueFilter}
        riskOnly={riskOnly}
        valueDataReady={valueDataReady}
        valueDataStaleReason={valueDataStaleReason || null}
        valueTagSortDirection={sort?.column === 'valueTags' ? sort.direction : null}
        filtersActive={
          customGroupFilter !== ALL_FILTER ||
          sectorFilter !== ALL_FILTER ||
          marketFilter !== ALL_FILTER ||
          fundamentalFilter !== 'all' ||
          valueFilter !== 'all' ||
          riskOnly
        }
        onOpenPortfolioQuality={() => setPortfolioQualityOpen(true)}
        onFilterChange={setFundamentalFilter}
        onValueFilterChange={setValueFilter}
        onRiskOnlyChange={setRiskOnly}
        onValueTagSortToggle={toggleValueTagSort}
        onResetFilters={resetFilters}
      />

      <div className="table-scroller" ref={tableScrollerRef}>
        <table className="watchlist-table" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <colgroup>
            <col style={{ width: ORDER_COLUMN_WIDTH }} />
            <col style={{ width: COLUMN_META.operation.width }} />
            {adjustableColumnOrder.map((columnId) => (
              <col key={columnId} style={{ width: COLUMN_META[columnId].width }} />
            ))}
            <col style={{ width: DELETE_COLUMN_WIDTH }} />
          </colgroup>
          <thead>
            <tr>
              <th className="order-column">排序</th>
              <th className="settings-column">{COLUMN_META.operation.label}</th>
              {adjustableColumnOrder.map((columnId) => {
                const meta = COLUMN_META[columnId]
                const activeSort = sort?.column === columnId ? sort : null
                return (
                  <th
                    className={meta.className}
                    key={columnId}
                    aria-sort={
                      activeSort
                        ? activeSort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {meta.sortable ? (
                      <button
                        className={`column-sort-button ${activeSort ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => changeSort(columnId)}
                        title={`按${meta.label}排序`}
                      >
                        <span>{meta.label}</span>
                        {activeSort?.direction === 'asc' ? (
                          <ArrowUp size={13} />
                        ) : activeSort?.direction === 'desc' ? (
                          <ArrowDown size={13} />
                        ) : (
                          <ArrowUpDown size={13} />
                        )}
                      </button>
                    ) : (
                      meta.label
                    )}
                  </th>
                )
              })}
              <th className="delete-column">删除</th>
            </tr>
          </thead>
          {displayedRows.map(
            ({
              stock,
              quote,
              dividendFinancing,
              fundamentalScreening,
              fundamentalPeerComparison,
              manualIndex
            }) => (
              <tbody
                className={`watchlist-stock-group ${
                  selectedQuoteId === stock.quoteId ? 'is-expanded' : ''
                }`}
                key={stock.quoteId}
              >
                <WatchlistRow
                  stock={stock}
                  quote={quote}
                  dividendFinancing={dividendFinancing}
                  dividendFinancingSnapshotDate={dividendFinancingSnapshotDate}
                  fundamentalScreening={fundamentalScreening}
                  fundamentalPeerComparison={fundamentalPeerComparison}
                  fundamentalSnapshotDate={fundamentalSnapshotDate}
                  fundamentalGeneratedAt={fundamentalGeneratedAt}
                  fundamentalStaleReason={fundamentalStaleReason}
                  tradingAccount={tTradingAccounts[stock.quoteId]}
                  manualIndex={manualIndex}
                  columnOrder={adjustableColumnOrder}
                  tradingCalendar={tradingCalendar}
                  quoteStatusNow={quoteStatusNow}
                  priorityRefreshSeconds={priorityRefreshSeconds}
                  regularRefreshSeconds={regularRefreshSeconds}
                  chipDistributionEnabled={chipDistributionEnabled}
                  bollingerBandsEnabled={bollingerBandsEnabled}
                  trackingProfile={stockTrackingProfiles[stock.quoteId]}
                  selected={selectedQuoteId === stock.quoteId}
                  detailNavigationRequest={
                    detailNavigationRequest?.quoteId === stock.quoteId
                      ? detailNavigationRequest
                      : null
                  }
                  closing={closingQuoteIds.has(stock.quoteId)}
                  located={locatedQuoteId === stock.quoteId}
                  dragDisabled={Boolean(sort)}
                  dragging={draggingQuoteId === stock.quoteId}
                  dragOver={dragOverQuoteId === stock.quoteId}
                  radarExpanded={radarPopover?.quoteId === stock.quoteId}
                  onToggleDetails={toggleStockDetails}
                  onDetailNavigationHandled={onDetailNavigationHandled}
                  onFinishClosing={finishClosingStockDetails}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onPin={handlePin}
                  onTogglePriority={onTogglePriority}
                  onToggleTaskbar={onToggleTaskbar}
                  onEditPosition={openPositionEditor}
                  onOpenStockAlert={openStockAlert}
                  onOpenTTrading={openTTrading}
                  onOpenRadar={openRadar}
                  onChipDistributionEnabledChange={onChipDistributionEnabledChange}
                  onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                  onStartTracking={onStartTracking}
                  onUpdateTracking={onUpdateTracking}
                  onStopTracking={onStopTracking}
                  onRestartTracking={onRestartTracking}
                  onRemove={onRemove}
                />
              </tbody>
            )
          )}
          {displayedRows.length === 0 ? (
            <tbody>
              <tr>
                <td className="table-filter-empty" colSpan={adjustableColumnOrder.length + 3}>
                  当前筛选条件下没有股票。
                </td>
              </tr>
            </tbody>
          ) : null}
        </table>
      </div>

      {radarPopover && activeRadarRow?.quote?.radarSignals?.length ? (
        <div
          className={`radar-popover is-${todayRadarSignals(activeRadarRow.quote.radarSignals)[0]?.direction ?? 'up'} ${radarPopover.placement === 'above' ? 'is-above' : ''}`}
          style={{ left: radarPopover.left, top: radarPopover.top }}
          ref={radarPopoverRef}
          role="dialog"
          aria-label={`${activeRadarRow.stock.name}近5日异动提示`}
        >
          <div className="radar-popover-heading">
            <span>
              <strong>{activeRadarRow.stock.name}</strong>
              <small>{activeRadarRow.stock.code}</small>
            </span>
            <b>近 5 日异动</b>
            <button
              className="icon-button radar-popover-close"
              type="button"
              onClick={() => setRadarPopover(null)}
              aria-label="关闭异动提示"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="radar-popover-list">
            {activeRadarRow.quote.radarSignals.map((signal) => (
              <div
                className={`radar-popover-item is-${signal.direction}`}
                key={`${signal.date}-${signal.type}`}
              >
                <time>
                  {signal.date.slice(4, 6)}-{signal.date.slice(6, 8)} {signal.time}
                </time>
                <strong title={RADAR_SIGNAL_DESCRIPTIONS[signal.type]}>{signal.label}</strong>
                {signal.info ? <small>{signal.info}</small> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {editingStock ? (
        <PositionEditor
          key={editingStock.quoteId}
          stock={watchlist.find((stock) => stock.quoteId === editingStock.quoteId) ?? editingStock}
          quote={quotes.find((quote) => quote.quoteId === editingStock.quoteId)}
          account={tTradingAccounts[editingStock.quoteId]}
          planDefaults={tPlanDefaults}
          onClose={() => setEditingStock(null)}
          onSave={(position, showRadarSignals, positionSnapshots, updatedAccount) => {
            onEditPosition(
              editingStock.quoteId,
              position,
              showRadarSignals,
              positionSnapshots,
              updatedAccount
            )
            setEditingStock(null)
          }}
        />
      ) : null}

      {tTradingStock ? (
        <TTradingDrawer
          key={tTradingStock.quoteId}
          stock={
            watchlist.find((stock) => stock.quoteId === tTradingStock.quoteId) ?? tTradingStock
          }
          quote={quotes.find((quote) => quote.quoteId === tTradingStock.quoteId)}
          account={tTradingAccounts[tTradingStock.quoteId]}
          feeSettings={tTradingFees}
          planDefaults={tPlanDefaults}
          floatingProfitAlertDefaultThreshold={tFloatingProfitAlertDefaultThreshold}
          onClose={() => setTTradingStock(null)}
          onApply={(account, position) => {
            onUpdateTTrading(tTradingStock.quoteId, account, position)
          }}
        />
      ) : null}

      {stockAlertStock ? (
        <StockAlertDialog
          key={stockAlertStock.quoteId}
          stock={
            watchlist.find((stock) => stock.quoteId === stockAlertStock.quoteId) ?? stockAlertStock
          }
          quote={quotes.find((quote) => quote.quoteId === stockAlertStock.quoteId)}
          account={tTradingAccounts[stockAlertStock.quoteId]}
          onClose={() => setStockAlertStock(null)}
          onSave={(rules) => {
            onUpdateStockAlerts(stockAlertStock.quoteId, rules)
            setStockAlertStock(null)
          }}
        />
      ) : null}

      {groupDialogOpen ? (
        <WatchlistGroupDialog
          groups={watchlistGroups}
          stocks={watchlist}
          quotes={quotes}
          onClose={() => setGroupDialogOpen(false)}
          onSave={(groups, groupIdsByQuoteId) => {
            onUpdateWatchlistGroups(groups, groupIdsByQuoteId)
            setGroupDialogOpen(false)
          }}
        />
      ) : null}
      {portfolioQualityOpen ? (
        <PortfolioQualityDialog
          summary={portfolioQualitySummary}
          fundamentalSnapshotDate={fundamentalSnapshotDate}
          dividendSnapshotDate={dividendFinancingSnapshotDate}
          fundamentalStaleReason={fundamentalStaleReason}
          dividendStaleReason={dividendFinancingStaleReason}
          onLocateStock={locatePortfolioHolding}
          onClose={() => setPortfolioQualityOpen(false)}
        />
      ) : null}
    </div>
  )
}
