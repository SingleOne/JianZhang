import { BellRing, GripVertical, MonitorUp, PencilLine, Pin, Star, Trash2 } from 'lucide-react'
import { Fragment, memo, type DragEvent } from 'react'
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
import { getTriggeredStockAlertDirection } from '../../lib/stock-alerts'
import { getTriggeredTAlertBadges } from '../../lib/t-alerts'
import { calculateTBatchMetrics } from '../../lib/t-trading'
import { getBatchTrades } from '../../lib/trade-records'
import type {
  StockQuote,
  StockRadarSignal,
  TTradingAccount,
  WatchlistColumnId,
  WatchStock
} from '../../shared/types'
import { ExpandedStockDetails } from '../ExpandedStockDetails'
import { FiveLevelAlertBadges } from '../FiveLevelAlertBadges'
import { TAlertBadges } from '../TAlertBadges'

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

export function todayRadarSignals(signals: StockRadarSignal[] | undefined): StockRadarSignal[] {
  const today = currentDateKey().replaceAll('-', '')
  return signals?.filter((signal) => signal.date === today) ?? []
}

interface WatchlistRowProps {
  stock: WatchStock
  quote: StockQuote | undefined
  tradingAccount: TTradingAccount | undefined
  manualIndex: number
  columnOrder: WatchlistColumnId[]
  tradingCalendarClosedDates: string[]
  priorityRefreshSeconds: number
  regularRefreshSeconds: number
  chipDistributionEnabled: boolean
  bollingerBandsEnabled: boolean
  selected: boolean
  closing: boolean
  located: boolean
  dragDisabled: boolean
  dragging: boolean
  dragOver: boolean
  radarExpanded: boolean
  onToggleDetails: (quoteId: string) => void
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
  onRemove: (quoteId: string) => void
}

export const WatchlistRow = memo(function WatchlistRow({
  stock,
  quote,
  tradingAccount,
  manualIndex,
  columnOrder,
  tradingCalendarClosedDates,
  priorityRefreshSeconds,
  regularRefreshSeconds,
  chipDistributionEnabled,
  bollingerBandsEnabled,
  selected,
  closing,
  located,
  dragDisabled,
  dragging,
  dragOver,
  radarExpanded,
  onToggleDetails,
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
  onRemove
}: WatchlistRowProps) {
  const metrics = calculatePositionMetrics(stock.position, quote, tradingAccount)
  const quoteDirection = valueClass(quote?.changePercent)
  const sectorDirection = valueClass(quote?.sector?.changePercent)
  const currentRadarSignals = stock.showRadarSignals ? todayRadarSignals(quote?.radarSignals) : []
  const latestRadarSignal = currentRadarSignals[0]
  const activeTBatch = tradingAccount?.activeBatch
  const activeTTrades = getBatchTrades(tradingAccount, activeTBatch)
  const tFloatingProfit = calculateTBatchMetrics(
    activeTBatch,
    activeTTrades,
    quote?.latest
  ).floatingProfit
  const tAlertBadges = getTriggeredTAlertBadges(activeTBatch, activeTTrades)
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
              aria-label={`管理 ${stock.name} 的T仓交易`}
              title={activeTBatch ? '继续记录当前T批次' : 'T仓管理'}
            >
              <span className="t-letter-icon" aria-hidden="true">
                T
              </span>
            </button>
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
                        {isChiNextStock(stock.code) ? (
                          <span className="stock-board-badge" title="创业板">
                            创
                          </span>
                        ) : null}
                        {isStarMarketStock(stock.code) ? (
                          <span className="stock-board-badge is-star" title="科创板">
                            科
                          </span>
                        ) : null}
                        <FiveLevelAlertBadges
                          alerts={activeTBatch ? quote?.fiveLevelLargeOrders : undefined}
                          compact
                        />
                        {tAlertBadges.length > 0 ? (
                          <button
                            type="button"
                            className="t-alert-cell-button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenTTrading(stock)
                            }}
                            title="查看当前 T 仓价格提醒"
                          >
                            <TAlertBadges badges={tAlertBadges} compact />
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
                  refreshSeconds={stock.isPriority ? priorityRefreshSeconds : regularRefreshSeconds}
                  autoRefreshOrderBook={Boolean(activeTBatch)}
                  chipDistributionEnabled={chipDistributionEnabled}
                  bollingerBandsEnabled={bollingerBandsEnabled}
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
