import { BellRing, GripVertical, MonitorUp, PencilLine, Pin, Star, Trash2 } from 'lucide-react'
import { Fragment, memo, type DragEvent, useCallback, useState } from 'react'
import {
  formatAmount,
  formatCost,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares
} from '../../lib/format'
import {
  calculatePositionMetrics,
  currentDateKey,
  getAvailablePositionQuantity,
  getPositionHoldingDays
} from '../../lib/portfolio'
import type { StockDetailNavigationRequest } from '../../lib/completion-notifications'
import { getTriggeredStockAlertDirection } from '../../lib/stock-alerts'
import { getTriggeredTAlertBadges, getTriggeredTFloatingProfitAlert } from '../../lib/t-alerts'
import { calculateTBatchMetrics } from '../../lib/t-trading'
import { getBatchTrades } from '../../lib/trade-records'
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
  DividendFinancingRankingItem,
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  StockRadarSignal,
  TTradingAccount,
  WatchlistColumnId,
  WatchStock
} from '../../shared/types'
import { marketFromQuoteId } from '../../shared/stock-market'
import { ExpandedStockDetails } from '../ExpandedStockDetails'
import { FiveLevelAlertBadges } from '../FiveLevelAlertBadges'
import { TAlertBadges } from '../TAlertBadges'
import { TFloatingProfitAlertBadge } from '../TFloatingProfitAlertBadge'

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
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
  dividendFinancing: DividendFinancingRankingItem | undefined
  dividendFinancingSnapshotDate: string | undefined
  fundamentalScreening: FundamentalScreeningEvaluation | undefined
  fundamentalPeerComparison: FundamentalPeerComparison | undefined
  fundamentalSnapshotDate: string | undefined
  fundamentalGeneratedAt: string | undefined
  fundamentalStaleReason: string | null | undefined
  tradingAccount: TTradingAccount | undefined
  manualIndex: number
  columnOrder: WatchlistColumnId[]
  tradingCalendarClosedDates: string[]
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  trackingProfile?: StockTrackingProfile
  selected: boolean
  detailNavigationRequest: StockDetailNavigationRequest | null
  closing: boolean
  located: boolean
  dragDisabled: boolean
  dragging: boolean
  dragOver: boolean
  radarExpanded: boolean
  onToggleDetails: (quoteId: string) => void
  onDetailNavigationHandled: (requestId: string) => void
  onFinishClosing: (quoteId: string) => void
  onDragStart: (quoteId: string, event: DragEvent<HTMLElement>) => void
  onDragOver: (quoteId: string, event: DragEvent<HTMLTableRowElement>) => void
  onDrop: (quoteId: string, event: DragEvent<HTMLTableRowElement>) => void
  onDragEnd: () => void
  onPin: (quoteId: string) => void
  onTogglePriority: (quoteId: string) => void
  onToggleTaskbar: (quoteId: string) => void
  onEditPosition: (stock: WatchStock) => void
  onOpenStockAlert: (stock: WatchStock) => void
  onOpenTTrading: (stock: WatchStock) => void
  onOpenRadar: (quoteId: string, anchor: HTMLButtonElement) => void
  onChipDistributionEnabledChange: (enabled: boolean) => void
  onBollingerBandsEnabledChange: (enabled: boolean) => void
  onStartTracking: (quoteId: string) => void
  onUpdateTracking: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
  onRemove: (quoteId: string) => void
}

export const WatchlistRow = memo(function WatchlistRow({
  stock,
  quote,
  dividendFinancing,
  dividendFinancingSnapshotDate,
  fundamentalScreening,
  fundamentalPeerComparison,
  fundamentalSnapshotDate,
  fundamentalGeneratedAt,
  fundamentalStaleReason,
  tradingAccount,
  manualIndex,
  columnOrder,
  tradingCalendarClosedDates,
  priorityRefreshSeconds,
  regularRefreshSeconds,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  trackingProfile,
  selected,
  detailNavigationRequest,
  closing,
  located,
  dragDisabled,
  dragging,
  dragOver,
  radarExpanded,
  onToggleDetails,
  onDetailNavigationHandled,
  onFinishClosing,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPin,
  onTogglePriority,
  onToggleTaskbar,
  onEditPosition,
  onOpenStockAlert,
  onOpenTTrading,
  onOpenRadar,
  onChipDistributionEnabledChange,
  onBollingerBandsEnabledChange,
  onStartTracking,
  onUpdateTracking,
  onStopTracking,
  onRestartTracking,
  onRemove
}: WatchlistRowProps) {
  const isAStock = marketFromQuoteId(stock.quoteId) === 'CN'
  const [fundamentalTabRequested, setFundamentalTabRequested] = useState(false)
  const [trackingTabRequested, setTrackingTabRequested] = useState(false)
  const fundamentalSummary = summarizeFundamentalScreening(fundamentalScreening)
  const fundamentalRisk = fundamentalScreening
    ? evaluateFundamentalRisk(fundamentalScreening.company)
    : null
  const financialMine = fundamentalScreening
    ? evaluateFinancialMine(fundamentalScreening.company)
    : null
  const metrics = calculatePositionMetrics(stock.position, quote, tradingAccount)
  const quoteDirection = valueClass(quote?.changePercent)
  const sectorDirection = valueClass(quote?.sector?.changePercent)
  const currentRadarSignals =
    isAStock && stock.showRadarSignals ? todayRadarSignals(quote?.radarSignals) : []
  const latestRadarSignal = currentRadarSignals[0]
  const activeTBatch = isAStock ? tradingAccount?.activeBatch : undefined
  const activeTTrades = getBatchTrades(tradingAccount, activeTBatch)
  const tFloatingProfit = calculateTBatchMetrics(
    activeTBatch,
    activeTTrades,
    quote?.latest
  ).floatingProfit
  const tAlertBadges = getTriggeredTAlertBadges(activeTBatch, activeTTrades)
  const tFloatingProfitAlert = getTriggeredTFloatingProfitAlert(activeTBatch)
  const enabledStockAlertCount = stock.alertRules?.filter((rule) => rule.enabled).length ?? 0
  const stockAlertDirection = getTriggeredStockAlertDirection(stock.alertRules)
  const stockAlertClass = stockAlertDirection
    ? `is-alert-triggered is-alert-${stockAlertDirection}`
    : ''
  const holdingDays = getPositionHoldingDays(stock.position, tradingCalendarClosedDates)
  const availablePositionQuantity = getAvailablePositionQuantity(stock.position, tradingAccount)
  const tButtonState = !activeTBatch
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
            <span
              className={`row-drag-handle ${dragDisabled ? 'is-disabled' : ''}`}
              draggable={!dragDisabled}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => onDragStart(stock.quoteId, event)}
              onDragEnd={onDragEnd}
              title={dragDisabled ? '请先恢复手动排序' : '拖动调整股票顺序'}
            >
              <GripVertical size={15} />
            </span>
            <button
              className="icon-button row-pin-button"
              type="button"
              disabled={!dragDisabled && manualIndex === 0}
              onClick={(event) => {
                event.stopPropagation()
                onPin(stock.quoteId)
              }}
              aria-label={`置顶 ${stock.name}`}
              title={dragDisabled ? '置顶并恢复手动排序' : '置顶'}
            >
              <Pin size={13} />
            </button>
          </div>
        </td>
        <td className="settings-column">
          <div className="row-actions">
            <button
              className={`row-action-button ${stock.isPriority ? 'is-active' : ''} ${stock.position ? 'is-locked' : ''}`}
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
              title={
                stock.position
                  ? '持仓股票已自动设为重点关注'
                  : stock.isPriority
                    ? '取消重点关注'
                    : '设为重点关注'
              }
            >
              <Star size={15} fill={stock.isPriority ? 'currentColor' : 'none'} />
            </button>
            <button
              className={`row-action-button ${stock.showInTaskbar ? 'is-active' : ''}`}
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
              title={stock.showInTaskbar ? '取消任务栏展示' : '直接在任务栏显示实时价格'}
            >
              <MonitorUp size={15} />
            </button>
            <button
              className={`row-action-button ${stockAlertClass || (enabledStockAlertCount > 0 ? 'is-active' : '')}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onOpenStockAlert(stock)
              }}
              aria-label={`设置 ${stock.name} 的股价提醒`}
              title={
                enabledStockAlertCount > 0
                  ? `已启用 ${enabledStockAlertCount} 条股价提醒`
                  : '设置股价、涨幅或收益率提醒'
              }
            >
              <BellRing size={15} />
            </button>
            {isAStock ? (
              <>
                <button
                  className={`row-action-button ${stock.position ? 'has-position' : ''}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onEditPosition(stock)
                  }}
                  aria-label={`编辑 ${stock.name} 的持仓`}
                  title="编辑持仓数量和成本"
                >
                  <PencilLine size={15} />
                </button>
                <button
                  className={`row-action-button ${tButtonState}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenTTrading(stock)
                  }}
                  aria-label={`打开 ${stock.name} 的交易管理`}
                  title={activeTBatch ? '继续记录当前交易批次' : '交易管理'}
                >
                  <span className="t-letter-icon" aria-hidden="true">
                    T
                  </span>
                </button>
              </>
            ) : null}
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
                          <span className="stock-board-badge" title="创业板">
                            创
                          </span>
                        ) : null}
                        {isAStock && isStarMarketStock(stock.code) ? (
                          <span className="stock-board-badge is-star" title="科创板">
                            科
                          </span>
                        ) : null}
                        {trackingProfile?.status === 'tracking' ? (
                          <button
                            className="stock-tracking-row-badge"
                            type="button"
                            title="打开选股追踪"
                            aria-label={`打开 ${stock.name} 的选股追踪`}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleTrackingBadgeClick()
                            }}
                          >
                            追踪
                          </button>
                        ) : null}
                        <FiveLevelAlertBadges
                          alerts={activeTBatch ? quote?.fiveLevelLargeOrders : undefined}
                          compact
                        />
                        {tAlertBadges.length > 0 || tFloatingProfitAlert ? (
                          <button
                            type="button"
                            className="t-alert-cell-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenTTrading(stock)
                            }}
                            title="查看当前 T 仓提醒"
                          >
                            <TAlertBadges badges={tAlertBadges} compact />
                            <TFloatingProfitAlertBadge
                              batch={activeTBatch}
                              floatingProfit={tFloatingProfit}
                              compact
                            />
                          </button>
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
                    <strong className="latest-price">{formatPrice(quote?.latest)}</strong>
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
                <td key={columnId}>
                  <strong className={`change-percent ${quoteDirection}`}>
                    {formatPercent(quote?.changePercent)}
                  </strong>
                </td>
              )
            case 'sectorChangePercent':
              return (
                <td
                  key={columnId}
                  title={
                    quote?.sector
                      ? `${quote.sector.name}（${quote.sector.code}）`
                      : '暂无所属行业板块行情'
                  }
                >
                  <strong className={sectorDirection}>
                    {formatPercent(quote?.sector?.changePercent)}
                  </strong>
                </td>
              )
            case 'dividendFinancingRatio':
              return (
                <td
                  key={columnId}
                  title={
                    dividendFinancing
                      ? `榜单第 ${dividendFinancing.rank} 名；累计A股分红 ${dividendFinancing.dividendYi.toLocaleString('zh-CN')} 亿元，累计A股融资 ${dividendFinancing.financingYi.toLocaleString('zh-CN')} 亿元；净回报 ${(dividendFinancing.netReturnYi ?? dividendFinancing.dividendYi - dividendFinancing.financingYi).toLocaleString('zh-CN')} 亿元；连续分红 ${dividendFinancing.consecutiveDividendYears ?? '--'} 年；质量评分 ${dividendFinancing.qualityScore?.toFixed(1) ?? '--'}；快照 ${dividendFinancingSnapshotDate ?? '--'}`
                      : `未进入分红融资比大于100%榜单或暂无完整数据；快照 ${dividendFinancingSnapshotDate ?? '--'}`
                  }
                >
                  {dividendFinancing ? (
                    <span className="dividend-financing-cell">
                      <strong>{dividendFinancing.ratio.toFixed(2)}%</strong>
                      <small>第 {dividendFinancing.rank} 名</small>
                    </span>
                  ) : (
                    <span className="dividend-financing-cell is-empty">
                      <strong>--</strong>
                      <small>未入榜</small>
                    </span>
                  )}
                </td>
              )
            case 'valueTags': {
              const fundamentalBadge =
                fundamentalScreening && fundamentalSummary.status !== 'unavailable'
                  ? FUNDAMENTAL_BADGE_META[fundamentalSummary.status]
                  : null
              const hasDividendBadge = Boolean(dividendFinancing)
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
                      <button
                        className={`value-screening-badge ${fundamentalBadge.className}`}
                        type="button"
                        title={fundamentalBadgeTitle(
                          fundamentalScreening,
                          fundamentalSummary,
                          fundamentalSnapshotDate
                        )}
                        aria-label={`打开${stock.name}基本面详情`}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleFundamentalBadgeClick()
                        }}
                      >
                        {fundamentalBadge.label}
                      </button>
                    ) : null}
                    {hasRiskBadge ? (
                      <button
                        className={`value-screening-badge is-risk-${riskSeverity}`}
                        type="button"
                        title={`基本面${riskSeverity === 'critical' ? '风险' : '关注'}：${riskMessages.join('、')}；点击查看详情`}
                        aria-label={`打开${stock.name}基本面风险详情`}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleFundamentalBadgeClick()
                        }}
                      >
                        {riskSeverity === 'critical' ? '风险' : '关注'}
                      </button>
                    ) : null}
                    {hasDividendBadge ? (
                      <span
                        className="value-screening-badge is-dividend"
                        title={`进入分红融资榜；分红融资比 ${dividendFinancing?.ratio.toFixed(2) ?? '--'}%，第 ${dividendFinancing?.rank ?? '--'} 名；快照 ${dividendFinancingSnapshotDate ?? '--'}`}
                      >
                        分红
                      </span>
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
                  <span
                    className="today-market-cell"
                    title={`今开 ${formatPrice(quote?.open)}，昨收 ${formatPrice(quote?.previousClose)}，最低 ${formatPrice(quote?.low)}，最高 ${formatPrice(quote?.high)}`}
                  >
                    <span>今开：{formatPrice(quote?.open)}</span>
                    <span>昨收：{formatPrice(quote?.previousClose)}</span>
                    <span>最低：{formatPrice(quote?.low)}</span>
                    <span>最高：{formatPrice(quote?.high)}</span>
                  </span>
                </td>
              )
            case 'trading':
              return (
                <td key={columnId}>
                  <span
                    className="trading-market-cell"
                    title={`成交额 ${formatAmount(quote?.amount)}，换手率 ${formatTurnoverRate(quote?.turnoverRate)}`}
                  >
                    <span>成交额：{formatAmount(quote?.amount)}</span>
                    <span>换手率：{formatTurnoverRate(quote?.turnoverRate)}</span>
                  </span>
                </td>
              )
            case 'amount':
              return <td key={columnId}>{holdingDays ? `${holdingDays} 天` : '--'}</td>
            case 'radar':
              return (
                <td className="radar-column" key={columnId}>
                  {latestRadarSignal ? (
                    <button
                      className={`radar-summary-button is-${latestRadarSignal.direction}`}
                      type="button"
                      aria-expanded={radarExpanded}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenRadar(stock.quoteId, event.currentTarget)
                      }}
                      title={`今日 ${currentRadarSignals.length} 条异动，点击查看近 5 日详情`}
                    >
                      <span>今日有异动</span>
                      <b>{currentRadarSignals.length}</b>
                    </button>
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
                      <small title="已扣除今日买入数量">
                        可用 {formatShares(availablePositionQuantity)}
                      </small>
                    ) : null}
                  </span>
                </td>
              )
            case 'cost':
              return (
                <td className="position-value-cell" key={columnId}>
                  {formatCost(stock.position?.cost)}
                </td>
              )
            case 'marketValue':
              return (
                <td className="position-value-cell" key={columnId}>
                  {formatCurrency(metrics.marketValue)}
                </td>
              )
            case 'todayProfit':
              return (
                <td key={columnId}>
                  <span className="combined-profit-cell">
                    <span className={valueClass(metrics.todayProfit)}>
                      {formatProfit(metrics.todayProfit)}
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
                  <span className="combined-profit-cell">
                    <span className={valueClass(metrics.totalProfit)}>
                      {formatProfit(metrics.totalProfit)}
                    </span>
                    <span className={valueClass(metrics.profitPercent)}>
                      {formatPercent(metrics.profitPercent)}
                    </span>
                  </span>
                </td>
              )
            case 'operation':
              return null
          }
        })}
        <td className="delete-column">
          <button
            className="icon-button remove-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(stock.quoteId)
            }}
            aria-label={`移除 ${stock.name}`}
            title="移除自选"
          >
            <Trash2 size={15} />
          </button>
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
                <ExpandedStockDetails
                  stock={stock}
                  quote={quote}
                  dividendFinancing={dividendFinancing}
                  dividendFinancingSnapshotDate={dividendFinancingSnapshotDate}
                  fundamentalScreening={fundamentalScreening}
                  fundamentalPeerComparison={fundamentalPeerComparison}
                  fundamentalSnapshotDate={fundamentalSnapshotDate}
                  fundamentalGeneratedAt={fundamentalGeneratedAt}
                  fundamentalStaleReason={fundamentalStaleReason}
                  fundamentalTabRequested={fundamentalTabRequested}
                  onFundamentalTabRequestHandled={() => setFundamentalTabRequested(false)}
                  trackingTabRequested={trackingTabRequested}
                  onTrackingTabRequestHandled={() => setTrackingTabRequested(false)}
                  detailNavigationRequest={detailNavigationRequest}
                  onDetailNavigationHandled={onDetailNavigationHandled}
                  refreshSeconds={stock.isPriority ? priorityRefreshSeconds : regularRefreshSeconds}
                  autoRefreshOrderBook={Boolean(activeTBatch)}
                  chipDistributionEnabled={chipDistributionEnabled}
                  bollingerBandsEnabled={bollingerBandsEnabled}
                  tradingCalendarClosedDates={tradingCalendarClosedDates}
                  trackingProfile={trackingProfile}
                  onStartTracking={onStartTracking}
                  onUpdateTracking={onUpdateTracking}
                  onStopTracking={onStopTracking}
                  onRestartTracking={onRestartTracking}
                  onChipDistributionEnabledChange={onChipDistributionEnabledChange}
                  onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
                />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
})
