import { AlertCircle, Eye, EyeOff, RefreshCw, Radar, Radio } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FundamentalCompany, StockQuote, WatchStock } from '../../../shared/types'
import { formatUpdateTime } from '../../../lib/format'
import { InvestmentValueMetrics } from '../../../components/InvestmentValueMetrics'
import { useDetailResource } from '../../../lib/data-center/detail-hooks'
import {
  insightSettingsResource,
  insightStatusResource,
  insightSnapshotResource,
  changeInsightSettings,
  refreshInsight,
  retainInsightUpdates
} from '../../../lib/data-center/optional-resources'
import { marketInsightApi } from './api'
import { IndicatorGrid } from './IndicatorGrid'
import {
  INTRADAY_INDICATOR_EXPLANATIONS,
  MOMENTUM_INDICATOR_EXPLANATIONS,
  ORDER_BOOK_AND_RELATIVE_STRENGTH_INDICATOR_EXPLANATIONS,
  SHORT_TERM_TECHNICAL_INDICATOR_EXPLANATIONS,
  TREND_INDICATOR_EXPLANATIONS,
  VOLATILITY_INDICATOR_EXPLANATIONS
} from './indicator-explanations'
import { NewsTimeline } from './NewsTimeline'
import { TPlanDistanceCard } from './TPlanDistanceCard'
import { WatchEventList } from './WatchEventList'
import type { MarketInsightSettings } from '../shared/types'

interface MarketInsightPanelProps {
  stock: WatchStock
  quote?: StockQuote
  fundamentalCompany?: FundamentalCompany
  fundamentalSnapshotDate?: string
  fundamentalStaleReason?: string | null
}

const INTRADAY_SECTION_HINT =
  '基于已完成的分时柱，汇总 VWAP、短窗收益、当日价格位置、开盘区间和近 5 分钟量价状态。'
const ORDER_BOOK_SECTION_HINT =
  '汇总买卖五档可见委托量及其变化，并对比个股相对行业、大盘的强弱、换手率与主力资金短窗变化。盘口仅反映当前可见委托。'

export default function MarketInsightPanel({
  stock,
  quote,
  fundamentalCompany,
  fundamentalSnapshotDate,
  fundamentalStaleReason
}: MarketInsightPanelProps) {
  const settingsState = useDetailResource(insightSettingsResource())
  const statusState = useDetailResource(insightStatusResource())
  const sharedSnapshot = insightSnapshotResource(stock.quoteId)
  const snapshotState = useDetailResource(sharedSnapshot)
  const settings = settingsState.data
  const status = statusState.data ?? null
  const snapshot = snapshotState.data
  const [thresholdDraft, setThresholdDraft] = useState<
    Partial<Pick<MarketInsightSettings, 'volumeSpikeRatio' | 'eventCooldownMinutes'>>
  >({})
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState({ quoteId: '', message: '' })
  const setError = (message: string) => setActionError({ quoteId: stock.quoteId, message })
  const error =
    (actionError.quoteId === stock.quoteId ? actionError.message : '') ||
    snapshotState.error ||
    settingsState.error ||
    statusState.error
  const loading = snapshotState.loading || settingsState.loading || statusState.loading
  const isWatching = settings?.watchedQuoteIds.includes(stock.quoteId) ?? false
  const previousEnabled = useRef<boolean | undefined>(undefined)
  useEffect(retainInsightUpdates, [])

  useEffect(() => {
    let active = true
    const reenabled = previousEnabled.current === false && settings?.enabled === true
    previousEnabled.current = settings?.enabled
    if (settings?.enabled) {
      void (
        reenabled
          ? refreshInsight(stock.quoteId)
          : sharedSnapshot
              .request()
              .then((current) => (current ? undefined : refreshInsight(stock.quoteId)))
      ).catch((reason: unknown) => {
        if (active)
          setActionError({
            quoteId: stock.quoteId,
            message: reason instanceof Error ? reason.message : '市场观察数据加载失败'
          })
      })
    }
    return () => {
      active = false
    }
  }, [settings?.enabled, sharedSnapshot, stock.quoteId])

  const loadSnapshot = async () => {
    setRefreshing(true)
    setError('')
    try {
      await refreshInsight(stock.quoteId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '市场观察数据加载失败')
    } finally {
      setRefreshing(false)
    }
  }
  const toggleWatching = async () => {
    setError('')
    try {
      const next = await changeInsightSettings((current) => ({
        ...current,
        watchedQuoteIds: current.watchedQuoteIds.includes(stock.quoteId)
          ? current.watchedQuoteIds.filter((id) => id !== stock.quoteId)
          : [...current.watchedQuoteIds, stock.quoteId]
      }))
      if (next.watchedQuoteIds.includes(stock.quoteId)) await loadSnapshot()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '盯盘设置保存失败')
    }
  }
  const toggleOverlay = async () => {
    try {
      await changeInsightSettings((current) => ({
        ...current,
        showChartOverlay: !current.showChartOverlay
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图表叠加设置保存失败')
    }
  }
  const toggleOlderNews = async () => {
    try {
      await changeInsightSettings((current) => ({
        ...current,
        includeOlderNews: !current.includeOlderNews
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '要闻查询范围保存失败')
    }
  }
  const acknowledge = async (eventId: string) => {
    try {
      await marketInsightApi.acknowledgeEvent(eventId)
      sharedSnapshot.invalidate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '事件确认失败')
    }
  }
  const clearExpiredEvents = async () => {
    try {
      await marketInsightApi.clearExpiredEvents(stock.quoteId)
      sharedSnapshot.invalidate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '过期事件清理失败')
    }
  }
  const saveThresholds = async () => {
    try {
      await changeInsightSettings((current) => ({ ...current, ...thresholdDraft }))
      setThresholdDraft({})
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '观察阈值保存失败')
    }
  }

  const openSource = async (url: string) => {
    try {
      await marketInsightApi.openSource(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '原始来源打开失败')
    }
  }

  const refreshedLabel = useMemo(
    () => (snapshot ? formatUpdateTime(snapshot.generatedAt) : '--:--:--'),
    [snapshot]
  )

  if (settings && !settings.enabled) {
    return (
      <div className="market-insight-panel" role="tabpanel">
        <InvestmentValueMetrics
          quoteId={stock.quoteId}
          quote={quote}
          company={fundamentalCompany}
          snapshotDate={fundamentalSnapshotDate}
          staleReason={fundamentalStaleReason}
        />
        <div className="insight-disabled-state" role="status">
          <Radar size={26} />
          <span>
            <strong>市场观察尚未开启</strong>
            <small>请在“设置 → 行情”中开启“市场观察”后使用。</small>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="market-insight-panel" role="tabpanel">
      <header className="insight-header">
        <div>
          <strong>市场观察</strong>
          <span>
            <Radio size={12} />
            数据截止 {snapshot?.dataCutoffAt ?? quote?.updatedAt ?? '--'} · 更新 {refreshedLabel}
          </span>
        </div>
        <div className="insight-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={toggleOverlay}
            disabled={!settings}
          >
            {settings?.showChartOverlay ? <EyeOff size={14} /> : <Eye size={14} />}
            {settings?.showChartOverlay ? '隐藏图表叠加' : '显示图表叠加'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={toggleWatching}
            disabled={!settings}
          >
            <Radar size={14} />
            {isWatching ? '关闭该股票盯盘' : '开启该股票盯盘'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadSnapshot()}
            disabled={refreshing || !status?.enabled}
          >
            <RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />
            立即刷新
          </button>
        </div>
      </header>

      <div className={`insight-data-state is-${snapshot?.dataState ?? 'cached'}`}>
        {snapshot?.dataState === 'stale' ? <AlertCircle size={14} /> : <Radio size={14} />}
        <span>
          {snapshot?.dataState === 'stale'
            ? '部分数据可能已过期，当前显示最近一次缓存。'
            : snapshot?.dataState === 'cached'
              ? '当前显示缓存数据。'
              : '当前快照由现有行情和分层数据源计算。'}
        </span>
        <span>
          {isWatching
            ? '该股票已开启后台盯盘。'
            : '该股票未开启后台盯盘；详情页打开时仍可手动刷新。'}
        </span>
        <span>
          {stock.isPriority
            ? '重点关注股票的新闻每 15 分钟自动查询。'
            : '非重点股票的新闻在交易日收盘后每天查询一次。'}
        </span>
      </div>

      {settings ? (
        <div className="insight-threshold-settings">
          <strong>观察阈值</strong>
          <label>
            成交量倍数
            <input
              type="number"
              min="1"
              step="0.1"
              value={thresholdDraft.volumeSpikeRatio ?? settings.volumeSpikeRatio}
              onChange={(event) =>
                setThresholdDraft({
                  ...thresholdDraft,
                  volumeSpikeRatio: Number(event.target.value)
                })
              }
            />
          </label>
          <label>
            冷却
            <input
              type="number"
              min="1"
              step="1"
              value={thresholdDraft.eventCooldownMinutes ?? settings.eventCooldownMinutes}
              onChange={(event) =>
                setThresholdDraft({
                  ...thresholdDraft,
                  eventCooldownMinutes: Number(event.target.value)
                })
              }
            />
            分钟
          </label>
          <button className="secondary-button" type="button" onClick={() => void saveThresholds()}>
            保存阈值
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="insight-error">
          <AlertCircle size={15} />
          {error}
        </div>
      ) : null}
      {loading && !snapshot ? <div className="chart-loading">正在计算确定性市场指标…</div> : null}
      {snapshot ? (
        <div className="insight-content">
          <IndicatorGrid
            title="短期技术面"
            titleHint="基于单只股票自身近期已完成日K，概括当前动量方向、反转迹象、波动水平和成交活跃度。"
            values={snapshot.indicators.technical}
            explanations={SHORT_TERM_TECHNICAL_INDICATOR_EXPLANATIONS}
            variant="summary"
          />
          <InvestmentValueMetrics
            quoteId={stock.quoteId}
            quote={quote}
            company={fundamentalCompany}
            snapshotDate={fundamentalSnapshotDate}
            staleReason={fundamentalStaleReason}
          />
          <IndicatorGrid
            title="分时观察"
            titleHint={INTRADAY_SECTION_HINT}
            values={snapshot.indicators.intraday}
            headingValueId="price-volume-state"
            explanations={INTRADAY_INDICATOR_EXPLANATIONS}
          />
          <IndicatorGrid
            title="趋势"
            values={snapshot.indicators.trend}
            explanations={TREND_INDICATOR_EXPLANATIONS}
          />
          <div className="insight-indicator-split">
            <IndicatorGrid
              title="动量"
              values={snapshot.indicators.momentum}
              explanations={MOMENTUM_INDICATOR_EXPLANATIONS}
            />
            <IndicatorGrid
              title="波动"
              values={snapshot.indicators.volatility}
              explanations={VOLATILITY_INDICATOR_EXPLANATIONS}
            />
          </div>
          <IndicatorGrid
            title="盘口与相对强弱"
            titleHint={ORDER_BOOK_SECTION_HINT}
            values={[...snapshot.indicators.orderBook, ...snapshot.indicators.relativeStrength]}
            explanations={ORDER_BOOK_AND_RELATIVE_STRENGTH_INDICATOR_EXPLANATIONS}
          />
          <WatchEventList
            events={snapshot.events}
            onAcknowledge={(eventId) => void acknowledge(eventId)}
            onClearExpired={() => void clearExpiredEvents()}
          />
          <TPlanDistanceCard distances={snapshot.existingTPlanDistances} />
          <NewsTimeline
            quoteId={stock.quoteId}
            news={snapshot.news}
            status={status}
            includeOlderNews={settings?.includeOlderNews ?? false}
            onToggleOlderNews={() => void toggleOlderNews()}
            onOpenSource={(url) => void openSource(url)}
          />
          <p className="insight-disclaimer">
            窗口指标使用已闭合 K
            线，最后一根可能未闭合的分时柱不计入窗口；盘口只反映可见委托，不代表真实成交意愿或必然走势。所有观察事件仅陈述可复算的客观条件，不构成交易建议。
          </p>
        </div>
      ) : null}
    </div>
  )
}
