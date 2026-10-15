import type { StockTradingBook } from '../../shared/types'
import { stockTOverview } from '../../lib/stock-accounts'
import type { AccountFeeState } from '../../lib/account-trade-fees'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BellRing,
  FolderPlus,
  GripVertical,
  MonitorUp,
  PencilLine,
  Star,
  Trash2
} from 'lucide-react'
import { Fragment, lazy, memo, Suspense, type DragEvent, useCallback, useState } from 'react'
import {
  formatAmount,
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatSigned,
  formatShares
} from '../../lib/format'
import { fundamentalCompanyStaleReason } from '../../lib/data-snapshot-status'
import { hasDividendFinancingLabel } from '../../lib/dividend-financing'
import { isStockQuoteExpired, STOCK_QUOTE_SOURCE_LABELS } from '../../lib/quote-state'
import {
  currentDateKey,
  getAvailablePositionQuantity,
  getPositionHoldingDays,
  type PositionMetrics
} from '../../lib/portfolio'
import type { StockDetailNavigationRequest } from '../../lib/completion-notifications'
import { getTriggeredStockAlertDirection } from '../../lib/stock-alerts'
import {
  FINANCIAL_MINE_LEVEL_LABELS,
  evaluateFinancialMine
} from '../../lib/financial-mine-detector'
import {
  FUNDAMENTAL_RISK_TAG_LABELS,
  evaluateFundamentalRisk,
  summarizeFundamentalScreening,
  type FundamentalPeerComparison,
  type FundamentalScreeningEvaluation,
  type FundamentalScreeningSummary
} from '../../lib/fundamental-screening'
import type {
  CorporateActionRecord,
  CorporateActionRecords,
  DailyKlineIndicator,
  DividendFinancingRankingItem,
  ExchangeRateSettings,
  FundamentalSnapshot,
  StockQuote,
  StockPosition,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  StockRadarSignal,
  TTradingAccount,
  TradingCalendarSettings,
  WatchlistColumnId,
  WatchStock
} from '../../shared/types'
import {
  marketCapabilitiesForQuoteId,
  marketFromQuoteId,
  STOCK_CURRENCY_SYMBOLS
} from '../../shared/stock-market'
import { AnimatedNumber } from '../AnimatedNumber'
import { FiveLevelAlertBadges } from '../FiveLevelAlertBadges'
import { TAlertBadges } from '../TAlertBadges'
import { TFloatingProfitAlertBadge } from '../TFloatingProfitAlertBadge'
import { Tooltip } from '../Tooltip'
import { calculatePreviousCloseDividendYield, calculateSinceAddedPerformance } from './columns'

const ExpandedStockDetails = lazy(() =>
  import('../ExpandedStockDetails').then((module) => ({
    default: module.ExpandedStockDetails
  }))
)

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatPerformanceCacheTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function isChiNextStock(code: string): boolean {
  return code.startsWith('300') || code.startsWith('301')
}

function isStarMarketStock(code: string): boolean {
  return code.startsWith('688') || code.startsWith('689')
}

function formatTurnoverRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : `${value.toFixed(2)}%`
}

const FUNDAMENTAL_BADGE_META = {
  passed: { label: '基本', className: 'is-fundamental' },
  review: { label: '待核', className: 'is-review' },
  missing: { label: '缺数', className: 'is-missing' },
  financial: { label: '金融', className: 'is-financial' }
} as const

function fundamentalBadgeTitle(
  evaluation: FundamentalScreeningEvaluation,
  summary: FundamentalScreeningSummary,
  snapshotDate?: string
): string {
  const message =
    summary.status === 'passed'
      ? `满足推荐基本面三项条件；五年最低加权ROE ${evaluation.minimumRoe?.toFixed(2) ?? '--'}%；五年累计现金转换率 ${evaluation.cumulativeCashConversion?.toFixed(2) ?? '--'}%；行业负债分位 ${evaluation.company.latestBalanceSheet.industryPercentile?.toFixed(1) ?? '--'}%`
      : summary.status === 'review'
        ? `${summary.reviewCount}项待核：${summary.reviewReasons.join('、')}`
        : summary.status === 'missing'
          ? `数据不足：${summary.missingReasons.join('、')}${summary.reviewReasons.length > 0 ? `；已识别待核：${summary.reviewReasons.join('、')}` : ''}`
          : '金融企业不参与普通企业三项基本面筛选'
  return `${message}；快照 ${snapshotDate ?? '--'}；点击查看详情`
}

export function todayRadarSignals(signals: StockRadarSignal[] | undefined): StockRadarSignal[] {
  const today = currentDateKey().replaceAll('-', '')
  return signals?.filter((signal) => signal.date === today) ?? []
}

interface WatchlistRowProps {
  stock: WatchStock
  quote: StockQuote | undefined
  metrics: PositionMetrics
  cumulativeProfit: number | null | undefined
  cumulativeProfitGeneratedAt: string | undefined
  dividendFinancing: DividendFinancingRankingItem | undefined
  dividendFinancingSnapshotDate: string | undefined
  fundamentalScreening: FundamentalScreeningEvaluation | undefined
  fundamentalPeerComparison: FundamentalPeerComparison | undefined
  fundamentalSnapshotDate: string | undefined
  fundamentalGeneratedAt: string | undefined
  fundamentalSnapshotSchemaVersion: FundamentalSnapshot['schemaVersion'] | undefined
  fundamentalStaleReason: string | null | undefined
  tradingAccount: TTradingAccount | StockTradingBook | undefined
  feeState?: AccountFeeState
  corporateActionApplications: CorporateActionRecords
  manualIndex: number
  columnOrder: WatchlistColumnId[]
  tradingCalendar: TradingCalendarSettings
  exchangeRates: ExchangeRateSettings
  quoteStatusNow: Date
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  dailyKlineIndicator: DailyKlineIndicator
  trackingProfile?: StockTrackingProfile
  selected: boolean
  detailNavigationRequest: StockDetailNavigationRequest | null
  closing: boolean
  located: boolean
  dragDisabled: boolean
  dragging: boolean
  dragOver: boolean
  radarExpanded: boolean
  groupCount: number
  groupPopoverOpen: boolean
  isLastInManualOrder: boolean
  onToggleDetails: (quoteId: string) => void
  onDetailNavigationHandled: (requestId: string) => void
  onFinishClosing: (quoteId: string) => void
  onDragStart: (quoteId: string, event: DragEvent<HTMLElement>) => void
  onDragOver: (quoteId: string, event: DragEvent<HTMLTableRowElement>) => void
  onDrop: (quoteId: string, event: DragEvent<HTMLTableRowElement>) => void
  onDragEnd: () => void
  onPin: (quoteId: string) => void
  onMoveToBottom: (quoteId: string) => void
  onTogglePriority: (quoteId: string) => void
  onToggleTaskbar: (quoteId: string) => void
  onEditPosition: (stock: WatchStock) => void
  onOpenStockAlert: (stock: WatchStock) => void
  onOpenTTrading: (stock: WatchStock) => void
  onOpenRadar: (quoteId: string, anchor: HTMLButtonElement) => void
  onOpenGroups: (quoteId: string, anchor: HTMLButtonElement) => void
  onChipDistributionEnabledChange: (enabled: boolean) => void
  onBollingerBandsEnabledChange: (enabled: boolean) => void
  onDailyKlineIndicatorChange: (indicator: DailyKlineIndicator) => void
  onStartTracking: (quoteId: string) => void
  onUpdateTracking: (profile: StockTrackingProfile) => void
  onApplyCorporateAction: (
    quoteId: string,
    account: TTradingAccount,
    position: StockPosition | undefined,
    record: CorporateActionRecord
  ) => string | void
  onUpdateCorporateActionRecord: (record: CorporateActionRecord) => void
  onStopTracking: (
    quoteId: string,
    result: StockTrackingConclusionResult,
    summary: string,
    deletePreviousArchives?: boolean
  ) => void
  onRestartTracking: (quoteId: string) => void
  onRemove: (quoteId: string) => void
}

export const WatchlistRow = memo(function WatchlistRow({
  stock,
  quote,
  metrics,
  cumulativeProfit,
  cumulativeProfitGeneratedAt,
  dividendFinancing,
  dividendFinancingSnapshotDate,
  fundamentalScreening,
  fundamentalPeerComparison,
  fundamentalSnapshotDate,
  fundamentalGeneratedAt,
  fundamentalSnapshotSchemaVersion,
  fundamentalStaleReason,
  tradingAccount,
  feeState,
  corporateActionApplications,
  manualIndex,
  columnOrder,
  tradingCalendar,
  exchangeRates,
  quoteStatusNow,
  priorityRefreshSeconds,
  regularRefreshSeconds,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  dailyKlineIndicator,
  trackingProfile,
  selected,
  detailNavigationRequest,
  closing,
  located,
  dragDisabled,
  dragging,
  dragOver,
  radarExpanded,
  groupCount,
  groupPopoverOpen,
  isLastInManualOrder,
  onToggleDetails,
  onDetailNavigationHandled,
  onFinishClosing,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPin,
  onMoveToBottom,
  onTogglePriority,
  onToggleTaskbar,
  onEditPosition,
  onOpenStockAlert,
  onOpenTTrading,
  onOpenRadar,
  onOpenGroups,
  onChipDistributionEnabledChange,
  onBollingerBandsEnabledChange,
  onDailyKlineIndicatorChange,
  onStartTracking,
  onUpdateTracking,
  onApplyCorporateAction,
  onUpdateCorporateActionRecord,
  onStopTracking,
  onRestartTracking,
  onRemove
}: WatchlistRowProps) {
  const market = marketFromQuoteId(stock.quoteId)
  const capabilities = marketCapabilitiesForQuoteId(stock.quoteId)
  const isAStock = market === 'CN'
  const quoteExpired = isStockQuoteExpired(quote, quoteStatusNow, tradingCalendar.markets[market])
  const quoteSourceLabel = quote?.source ? STOCK_QUOTE_SOURCE_LABELS[quote.source] : '来源未知'
  const [fundamentalTabRequested, setFundamentalTabRequested] = useState(false)
  const [trackingTabRequested, setTrackingTabRequested] = useState(false)
  const fundamentalSummary = summarizeFundamentalScreening(fundamentalScreening)
  const companyFundamentalSnapshotDate =
    fundamentalScreening?.company.dataSnapshotDate ?? fundamentalSnapshotDate
  const companyFundamentalGeneratedAt =
    fundamentalScreening?.company.dataGeneratedAt ?? fundamentalGeneratedAt
  const companyFundamentalStaleReason =
    fundamentalScreening && companyFundamentalGeneratedAt && fundamentalSnapshotSchemaVersion
      ? fundamentalCompanyStaleReason(
          fundamentalScreening.company,
          fundamentalSnapshotSchemaVersion,
          companyFundamentalGeneratedAt
        )
      : fundamentalStaleReason
  const fundamentalRisk = fundamentalScreening
    ? evaluateFundamentalRisk(fundamentalScreening.company)
    : null
  const financialMine = fundamentalScreening
    ? evaluateFinancialMine(fundamentalScreening.company)
    : null
  const quoteDirection = valueClass(quote?.changePercent)
  const sectorDirection = valueClass(quote?.sector?.changePercent)
  const sinceAddedPerformance = calculateSinceAddedPerformance(stock, quote)
  const sinceAddedDirection = valueClass(sinceAddedPerformance?.changePercent)
  const dividendYield = calculatePreviousCloseDividendYield(dividendFinancing, quote)
  const hasPosition = (stock.position?.quantity ?? 0) > 0
  const displayedTotalProfit = hasPosition ? metrics.totalProfit : cumulativeProfit
  const cumulativeProfitSnapshotTime = cumulativeProfitGeneratedAt
    ? formatPerformanceCacheTime(cumulativeProfitGeneratedAt)
    : '--'
  const totalProfitTooltip = hasPosition
    ? '当前有持仓，显示当前持仓周期收益；第二行为持仓收益率。'
    : cumulativeProfit === null || cumulativeProfit === undefined
      ? '当前无持仓；本地尚无累计收益快照，请打开跨市场收益分析进行计算。'
      : `当前无持仓，显示跨市场收益分析保存的累计收益（人民币）；快照时间 ${cumulativeProfitSnapshotTime}。`
  const currentRadarSignals =
    capabilities.radar && stock.showRadarSignals ? todayRadarSignals(quote?.radarSignals) : []
  const latestRadarSignal = currentRadarSignals[0]
  const overview = stockTOverview(
    capabilities.tTrading ? tradingAccount : undefined,
    quote?.latest,
    { market, instrumentType: stock.instrumentType, feeState }
  )
  const tFloatingProfit = overview.floatingProfit
  const tAlertBadges = overview.badges
  const tFloatingProfitAlert = overview.floatingAlert
  const enabledStockAlertCount = stock.alertRules?.filter((rule) => rule.enabled).length ?? 0
  const stockAlertDirection = getTriggeredStockAlertDirection(stock.alertRules)
  const stockAlertClass = stockAlertDirection
    ? `is-alert-triggered is-alert-${stockAlertDirection}`
    : ''
  const holdingDays = getPositionHoldingDays(
    stock.position,
    tradingCalendar.markets[market].closedDates,
    market,
    tradingCalendar.markets[market].halfDayDates
  )
  const availablePositionQuantity = getAvailablePositionQuantity(
    stock.position,
    tradingAccount,
    market
  )
  const tButtonState = !overview.summaries.length
    ? ''
    : tFloatingProfit !== null && tFloatingProfit > 0
      ? 'is-t-profit-up'
      : tFloatingProfit !== null && tFloatingProfit < 0
        ? 'is-t-profit-down'
        : 'is-active'
  const handleFundamentalBadgeClick = useCallback(() => {
    setFundamentalTabRequested(true)
    if (!selected) onToggleDetails(stock.quoteId)
  }, [onToggleDetails, selected, stock.quoteId])

  const handleTrackingBadgeClick = useCallback(() => {
    setTrackingTabRequested(true)
    if (!selected) onToggleDetails(stock.quoteId)
  }, [onToggleDetails, selected, stock.quoteId])

  return (
    <Fragment>
      <tr
        data-quote-id={stock.quoteId}
        className={`stock-row ${selected ? 'is-selected' : ''} ${located ? 'is-located' : ''} ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-drag-over' : ''}`}
        onClick={() => onToggleDetails(stock.quoteId)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onToggleDetails(stock.quoteId)
        }}
        onDragOver={(event) => onDragOver(stock.quoteId, event)}
        onDrop={(event) => onDrop(stock.quoteId, event)}
        tabIndex={0}
        aria-expanded={selected}
      >
        <td className="order-column">
          <div className="row-order-actions">
            <Tooltip content={dragDisabled ? '请先恢复手动排序' : '拖动调整股票顺序'}>
              <span
                className={`row-drag-handle ${dragDisabled ? 'is-disabled' : ''}`}
                draggable={!dragDisabled}
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => onDragStart(stock.quoteId, event)}
                onDragEnd={onDragEnd}
              >
                <GripVertical size={15} />
              </span>
            </Tooltip>
          </div>
        </td>
        <td className="settings-column">
          <div className="row-actions">
            <Tooltip content={dragDisabled ? '置顶并恢复手动排序' : '置顶'}>
              <button
                className="row-action-button is-pin-action"
                type="button"
                disabled={!dragDisabled && manualIndex === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  onPin(stock.quoteId)
                }}
                aria-label={`置顶 ${stock.name}`}
              >
                <ArrowUpToLine size={15} />
              </button>
            </Tooltip>
            <Tooltip
              content={
                stock.position
                  ? '持仓股票已自动设为重点关注'
                  : stock.isPriority
                    ? '取消重点关注'
                    : '设为重点关注'
              }
            >
              <button
                className={`row-action-button is-priority-action ${stock.isPriority ? 'is-active' : ''} ${stock.position ? 'is-locked' : ''}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onTogglePriority(stock.quoteId)
                }}
                aria-pressed={stock.isPriority}
                aria-disabled={Boolean(stock.position)}
                aria-label={
                  stock.isPriority ? `取消重点关注 ${stock.name}` : `重点关注 ${stock.name}`
                }
              >
                <Star size={15} fill={stock.isPriority ? 'currentColor' : 'none'} />
              </button>
            </Tooltip>
            <Tooltip content={stock.showInTaskbar ? '取消任务栏展示' : '直接在任务栏显示实时价格'}>
              <button
                className={`row-action-button is-taskbar-action ${stock.showInTaskbar ? 'is-active' : ''}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleTaskbar(stock.quoteId)
                }}
                aria-pressed={stock.showInTaskbar}
                aria-label={
                  stock.showInTaskbar
                    ? `取消在任务栏显示 ${stock.name}`
                    : `在任务栏显示 ${stock.name}`
                }
              >
                <MonitorUp size={15} />
              </button>
            </Tooltip>
            <Tooltip
              content={groupCount > 0 ? `调整分组，已加入 ${groupCount} 个分组` : '加入分组'}
            >
              <button
                className={`row-action-button is-group-action ${groupCount > 0 || groupPopoverOpen ? 'is-active' : ''}`}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={groupPopoverOpen}
                aria-controls={groupPopoverOpen ? 'watchlist-group-quick-popover' : undefined}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenGroups(stock.quoteId, event.currentTarget)
                }}
                aria-label={`调整 ${stock.name} 的分组`}
              >
                <FolderPlus size={15} />
              </button>
            </Tooltip>
            {capabilities.position || capabilities.tTrading ? (
              <>
                {capabilities.position ? (
                  <Tooltip content="编辑持仓数量和成本">
                    <button
                      className={`row-action-button is-position-action ${stock.position ? 'has-position' : ''}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onEditPosition(stock)
                      }}
                      aria-label={`编辑 ${stock.name} 的持仓`}
                    >
                      <PencilLine size={15} />
                    </button>
                  </Tooltip>
                ) : null}
                {capabilities.tTrading ? (
                  <Tooltip
                    content={
                      overview.summaries.length > 1
                        ? `${overview.summaries.length} 个账户正在做 T`
                        : overview.summaries.length
                          ? '继续记录当前交易批次'
                          : '交易管理'
                    }
                  >
                    <button
                      className={`row-action-button is-t-action ${tButtonState}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenTTrading(stock)
                      }}
                      aria-label={`打开 ${stock.name} 的交易管理`}
                    >
                      <span className="t-letter-icon" aria-hidden="true">
                        T
                      </span>
                    </button>
                  </Tooltip>
                ) : null}
              </>
            ) : null}
            <Tooltip
              content={
                enabledStockAlertCount > 0
                  ? `已启用 ${enabledStockAlertCount} 条股价提醒`
                  : '设置股价、涨幅或收益率提醒'
              }
            >
              <button
                className={`row-action-button is-alert-action ${stockAlertClass || (enabledStockAlertCount > 0 ? 'is-active' : '')}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenStockAlert(stock)
                }}
                aria-label={`设置 ${stock.name} 的股价提醒`}
              >
                <BellRing size={15} />
              </button>
            </Tooltip>
            <Tooltip content={dragDisabled ? '移到底部并恢复手动排序' : '移到底部'}>
              <button
                className="row-action-button is-bottom-action"
                type="button"
                disabled={!dragDisabled && isLastInManualOrder}
                onClick={(event) => {
                  event.stopPropagation()
                  onMoveToBottom(stock.quoteId)
                }}
                aria-label={`将 ${stock.name} 移到底部`}
              >
                <ArrowDownToLine size={15} />
              </button>
            </Tooltip>
          </div>
        </td>
        {columnOrder.map((columnId) => {
          switch (columnId) {
            case 'stock':
              return (
                <td className={`stock-column ${stockAlertClass}`} key={columnId}>
                  <div className="stock-identity">
                    <span>
                      <span className="stock-name-line">
                        <strong>{stock.name}</strong>
                        {isAStock && isChiNextStock(stock.code) ? (
                          <Tooltip content="创业板">
                            <span className="stock-board-badge">创</span>
                          </Tooltip>
                        ) : null}
                        {isAStock && isStarMarketStock(stock.code) ? (
                          <Tooltip content="科创板">
                            <span className="stock-board-badge is-star">科</span>
                          </Tooltip>
                        ) : null}
                        {quoteExpired ? (
                          <Tooltip
                            content={`${quoteSourceLabel}行情已超过 5 分钟未更新 · 行情时间 ${quote?.dataAt ?? '未知'} · 请求时间 ${quote?.updatedAt ?? '未知'}`}
                          >
                            <span className="stock-quote-expired-badge">过期</span>
                          </Tooltip>
                        ) : null}
                        {trackingProfile?.status === 'tracking' ? (
                          <Tooltip content="打开选股追踪">
                            <button
                              className="stock-tracking-row-badge"
                              type="button"
                              aria-label={`打开 ${stock.name} 的选股追踪`}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleTrackingBadgeClick()
                              }}
                            >
                              追踪
                            </button>
                          </Tooltip>
                        ) : null}
                        <FiveLevelAlertBadges
                          alerts={
                            overview.summaries.length ? quote?.fiveLevelLargeOrders : undefined
                          }
                          compact
                        />
                        {tAlertBadges.length > 0 || tFloatingProfitAlert ? (
                          <Tooltip content="查看当前 T 仓提醒">
                            <button
                              type="button"
                              className="t-alert-cell-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onOpenTTrading(stock)
                              }}
                            >
                              <TAlertBadges badges={tAlertBadges} compact />
                              {overview.floatingAlerts.map((summary) => (
                                <TFloatingProfitAlertBadge
                                  key={summary.account.accountId}
                                  accountName={summary.account.accountName}
                                  batch={summary.batch}
                                  floatingProfit={summary.metrics.floatingProfit}
                                  currency={metrics.currency}
                                  compact
                                />
                              ))}
                            </button>
                          </Tooltip>
                        ) : null}
                      </span>
                      <small>
                        {stock.code} · {stock.marketLabel}
                      </small>
                    </span>
                  </div>
                </td>
              )
            case 'latest':
              return (
                <td key={columnId}>
                  <div className={`latest-cell ${quoteDirection}`}>
                    <strong className="latest-price">
                      <AnimatedNumber value={quote?.latest} formatValue={formatPrice} />
                    </strong>
                    <small>
                      {quote?.change === null || quote?.change === undefined
                        ? '--'
                        : `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}`}
                    </small>
                  </div>
                </td>
              )
            case 'changePercent':
              return (
                <Tooltip
                  key={columnId}
                  content={
                    quote?.sector
                      ? `${quote.sector.name}（${quote.sector.code}）`
                      : '暂无所属行业板块行情'
                  }
                >
                  <td>
                    <span className="change-percent-cell">
                      <strong className={`change-percent ${quoteDirection}`}>
                        {formatPercent(quote?.changePercent)}
                      </strong>
                      <small className={sectorDirection}>
                        板块 {formatPercent(quote?.sector?.changePercent)}
                      </small>
                    </span>
                  </td>
                </Tooltip>
              )
            case 'sinceAddedChange':
              return (
                <Tooltip
                  key={columnId}
                  content={
                    sinceAddedPerformance
                      ? `添加时间 ${stock.addedAt ?? '--'}，添加基准价 ${formatPrice(stock.addedPrice)}`
                      : '旧数据未记录添加时价格；新添加股票会自动记录'
                  }
                >
                  <td>
                    <span className="since-added-change-cell">
                      <strong className={sinceAddedDirection}>
                        {formatPercent(sinceAddedPerformance?.changePercent)}
                      </strong>
                      <small className={sinceAddedDirection}>
                        {formatSigned(sinceAddedPerformance?.change, 3)}
                      </small>
                    </span>
                  </td>
                </Tooltip>
              )
            case 'dividendFinancingRatio':
              return (
                <Tooltip
                  content={
                    dividendFinancing
                      ? `累计A股分红 ${dividendFinancing.dividendYi.toLocaleString('zh-CN')} 亿元，累计A股融资 ${dividendFinancing.financingYi.toLocaleString('zh-CN')} 亿元；净回报 ${(dividendFinancing.netReturnYi ?? dividendFinancing.dividendYi - dividendFinancing.financingYi).toLocaleString('zh-CN')} 亿元；${dividendYield ? `${dividendYield.dividendYear} 年每股分红约 ${formatPrice(dividendYield.dividendPerShare)} 元，按昨收 ${formatPrice(quote?.previousClose)} 计算股息率` : '缺少上一年度分红、最新价、总市值或昨收数据，暂不能计算股息率'}；快照 ${dividendFinancingSnapshotDate ?? '--'}`
                      : `当前全量快照暂无完整的分红、融资数据；快照 ${dividendFinancingSnapshotDate ?? '--'}`
                  }
                >
                  <td key={columnId}>
                    {dividendFinancing ? (
                      <span className="dividend-financing-cell">
                        <strong>{dividendFinancing.ratio.toFixed(2)}%</strong>
                        <small className={valueClass(dividendYield?.yieldPercent)}>
                          股息率 {formatPercent(dividendYield?.yieldPercent)}
                        </small>
                      </span>
                    ) : (
                      <span className="dividend-financing-cell is-empty">
                        <strong>--</strong>
                        <small>股息率 --</small>
                      </span>
                    )}
                  </td>
                </Tooltip>
              )
            case 'valueTags': {
              const fundamentalBadge =
                fundamentalScreening && fundamentalSummary.status !== 'unavailable'
                  ? FUNDAMENTAL_BADGE_META[fundamentalSummary.status]
                  : null
              const hasDividendBadge = hasDividendFinancingLabel(dividendFinancing)
              const hasAnnualRisk = Boolean(fundamentalRisk?.tags.length)
              const hasMineRisk =
                financialMine?.level === 'high' || financialMine?.level === 'medium'
              const hasRiskBadge = hasAnnualRisk || hasMineRisk
              const riskSeverity =
                fundamentalRisk?.severity === 'critical' || financialMine?.level === 'high'
                  ? 'critical'
                  : 'warning'
              const riskMessages = [
                ...(fundamentalRisk?.tags.map((tag) => FUNDAMENTAL_RISK_TAG_LABELS[tag]) ?? []),
                ...(hasMineRisk && financialMine
                  ? [`财务排雷${FINANCIAL_MINE_LEVEL_LABELS[financialMine.level]}`]
                  : [])
              ]
              return (
                <td key={columnId}>
                  <span className="value-tag-cell">
                    {fundamentalBadge && fundamentalScreening ? (
                      <Tooltip
                        content={fundamentalBadgeTitle(
                          fundamentalScreening,
                          fundamentalSummary,
                          companyFundamentalSnapshotDate
                        )}
                      >
                        <button
                          className={`value-screening-badge ${fundamentalBadge.className}`}
                          type="button"
                          aria-label={`打开${stock.name}基本面详情`}
                          onKeyDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleFundamentalBadgeClick()
                          }}
                        >
                          {fundamentalBadge.label}
                        </button>
                      </Tooltip>
                    ) : null}
                    {hasRiskBadge ? (
                      <Tooltip
                        content={`基本面${riskSeverity === 'critical' ? '风险' : '关注'}：${riskMessages.join('、')}；点击查看详情`}
                      >
                        <button
                          className={`value-screening-badge is-risk-${riskSeverity}`}
                          type="button"
                          aria-label={`打开${stock.name}基本面风险详情`}
                          onKeyDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleFundamentalBadgeClick()
                          }}
                        >
                          {riskSeverity === 'critical' ? '风险' : '关注'}
                        </button>
                      </Tooltip>
                    ) : null}
                    {hasDividendBadge ? (
                      <Tooltip
                        content={`分红融资比超过100%；当前比值 ${dividendFinancing?.ratio.toFixed(2) ?? '--'}%，全量排名第 ${dividendFinancing?.rank ?? '--'} 名；快照 ${dividendFinancingSnapshotDate ?? '--'}`}
                      >
                        <span className="value-screening-badge is-dividend">分红</span>
                      </Tooltip>
                    ) : null}
                    {!fundamentalBadge && !hasRiskBadge && !hasDividendBadge ? (
                      <span className="value-tag-empty">--</span>
                    ) : null}
                  </span>
                </td>
              )
            }
            case 'open':
              return (
                <td key={columnId}>
                  <Tooltip
                    content={`今开 ${formatPrice(quote?.open)}，昨收 ${formatPrice(quote?.previousClose)}，最低 ${formatPrice(quote?.low)}，最高 ${formatPrice(quote?.high)}`}
                  >
                    <span className="today-market-cell">
                      <span>今开：{formatPrice(quote?.open)}</span>
                      <span>昨收：{formatPrice(quote?.previousClose)}</span>
                      <span>最低：{formatPrice(quote?.low)}</span>
                      <span>最高：{formatPrice(quote?.high)}</span>
                    </span>
                  </Tooltip>
                </td>
              )
            case 'trading':
              return (
                <td key={columnId}>
                  <Tooltip
                    content={`成交额 ${formatAmount(quote?.amount)}，换手率 ${formatTurnoverRate(quote?.turnoverRate)}`}
                  >
                    <span className="trading-market-cell">
                      <span>成交额：{formatAmount(quote?.amount)}</span>
                      <span>换手率：{formatTurnoverRate(quote?.turnoverRate)}</span>
                    </span>
                  </Tooltip>
                </td>
              )
            case 'amount':
              return <td key={columnId}>{holdingDays ? `${holdingDays} 天` : '--'}</td>
            case 'radar':
              return (
                <td className="radar-column" key={columnId}>
                  {latestRadarSignal ? (
                    <Tooltip
                      content={`今日 ${currentRadarSignals.length} 条异动，点击查看近 5 日详情`}
                    >
                      <button
                        className={`radar-summary-button is-${latestRadarSignal.direction}`}
                        type="button"
                        aria-expanded={radarExpanded}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenRadar(stock.quoteId, event.currentTarget)
                        }}
                      >
                        <span>今日有异动</span>
                        <b>{currentRadarSignals.length}</b>
                      </button>
                    </Tooltip>
                  ) : (
                    '--'
                  )}
                </td>
              )
            case 'positionQuantity':
              return (
                <td className="position-value-cell" key={columnId}>
                  <span className="position-quantity-cell">
                    <span>{formatShares(stock.position?.quantity)}</span>
                    {availablePositionQuantity !== null ? (
                      <Tooltip content="已扣除今日买入数量">
                        <small>可用 {formatShares(availablePositionQuantity)}</small>
                      </Tooltip>
                    ) : null}
                  </span>
                </td>
              )
            case 'marketValue':
              return (
                <td className="position-value-cell" key={columnId}>
                  <span className="combined-position-cell">
                    <span>{formatMoney(metrics.marketValue, metrics.currency)}</span>
                    <small>
                      成本{' '}
                      {metrics.holdingCost !== null
                        ? `${STOCK_CURRENCY_SYMBOLS[metrics.currency]}${formatCost(metrics.holdingCost)}`
                        : '--'}
                    </small>
                  </span>
                </td>
              )
            case 'todayProfit':
              return (
                <td key={columnId}>
                  <span className="combined-profit-cell">
                    <span className={valueClass(metrics.todayProfit)}>
                      {formatMoneyProfit(metrics.todayProfit, metrics.currency)}
                    </span>
                    <span className={valueClass(metrics.todayProfitPercent)}>
                      {formatPercent(metrics.todayProfitPercent)}
                    </span>
                  </span>
                </td>
              )
            case 'totalProfit':
              return (
                <td key={columnId}>
                  <Tooltip content={totalProfitTooltip}>
                    <span className="combined-profit-cell">
                      <span className={valueClass(displayedTotalProfit)}>
                        {formatMoneyProfit(
                          displayedTotalProfit,
                          hasPosition ? metrics.currency : 'CNY'
                        )}
                      </span>
                      {hasPosition ? (
                        <span className={valueClass(metrics.profitPercent)}>
                          {formatPercent(metrics.profitPercent)}
                        </span>
                      ) : (
                        <small className="cumulative-profit-label">累计收益</small>
                      )}
                    </span>
                  </Tooltip>
                </td>
              )
            case 'operation':
              return null
          }
        })}
        <td className="delete-column">
          <Tooltip content="移除自选">
            <button
              className="icon-button remove-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(stock.quoteId)
              }}
              aria-label={`移除 ${stock.name}`}
            >
              <Trash2 size={15} />
            </button>
          </Tooltip>
        </td>
      </tr>
      {selected || closing ? (
        <tr className={`expanded-row ${closing && !selected ? 'is-closing' : 'is-opening'}`}>
          <td colSpan={columnOrder.length + 3}>
            <div
              className="expanded-row-motion"
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target && closing && !selected) {
                  onFinishClosing(stock.quoteId)
                }
              }}
            >
              <div className="expanded-row-content">
                <Suspense fallback={<div className="expanded-row-loading">正在准备行情详情…</div>}>
                  <ExpandedStockDetails
                    stock={stock}
                    quote={quote}
                    dividendFinancing={dividendFinancing}
                    dividendFinancingSnapshotDate={dividendFinancingSnapshotDate}
                    fundamentalScreening={fundamentalScreening}
                    fundamentalPeerComparison={fundamentalPeerComparison}
                    fundamentalSnapshotDate={companyFundamentalSnapshotDate}
                    fundamentalGeneratedAt={companyFundamentalGeneratedAt}
                    fundamentalStaleReason={companyFundamentalStaleReason}
                    fundamentalTabRequested={fundamentalTabRequested}
                    onFundamentalTabRequestHandled={() => setFundamentalTabRequested(false)}
                    trackingTabRequested={trackingTabRequested}
                    onTrackingTabRequestHandled={() => setTrackingTabRequested(false)}
                    detailNavigationRequest={detailNavigationRequest}
                    onDetailNavigationHandled={onDetailNavigationHandled}
                    refreshSeconds={
                      stock.isPriority ? priorityRefreshSeconds : regularRefreshSeconds
                    }
                    autoRefreshOrderBook={overview.summaries.length > 0}
                    chipDistributionEnabled={chipDistributionEnabled}
                    bollingerBandsEnabled={bollingerBandsEnabled}
                    dailyKlineIndicator={dailyKlineIndicator}
                    tradingCalendar={tradingCalendar}
                    exchangeRates={exchangeRates}
                    tradingAccount={tradingAccount}
                    corporateActionApplications={corporateActionApplications}
                    onApplyCorporateAction={(account, position, record) =>
                      onApplyCorporateAction(stock.quoteId, account, position, record)
                    }
                    onUpdateCorporateActionRecord={onUpdateCorporateActionRecord}
                    trackingProfile={trackingProfile}
                    onStartTracking={onStartTracking}
                    onUpdateTracking={onUpdateTracking}
                    onStopTracking={onStopTracking}
                    onRestartTracking={onRestartTracking}
                    onChipDistributionEnabledChange={onChipDistributionEnabledChange}
                    onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                    onDailyKlineIndicatorChange={onDailyKlineIndicatorChange}
                  />
                </Suspense>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
})
