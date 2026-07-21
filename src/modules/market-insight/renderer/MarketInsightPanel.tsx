import { AlertCircle, Eye, EyeOff, Power, RefreshCw, Radar, Radio } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StockQuote, WatchStock } from '../../../shared/types'
import { formatUpdateTime } from '../../../lib/format'
import { marketInsightApi } from './api'
import { IndicatorGrid } from './IndicatorGrid'
import { NewsTimeline } from './NewsTimeline'
import { TPlanDistanceCard } from './TPlanDistanceCard'
import { WatchEventList } from './WatchEventList'
import type { MarketInsightSettings, MarketInsightSnapshot, MarketInsightStatus } from '../shared/types'
import { normalizeMarketInsightSettings } from '../shared/normalize'

interface MarketInsightPanelProps {
  stock: WatchStock
  quote?: StockQuote
  onSnapshotChanged: (snapshot: MarketInsightSnapshot | null) => void
  onChartOverlayEnabledChange: (enabled: boolean) => void
}

export default function MarketInsightPanel({
  stock,
  quote,
  onSnapshotChanged,
  onChartOverlayEnabledChange
}: MarketInsightPanelProps) {
  const [status, setStatus] = useState<MarketInsightStatus | null>(null)
  const [settings, setSettings] = useState<MarketInsightSettings | null>(null)
  const [snapshot, setSnapshot] = useState<MarketInsightSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const isWatching = settings?.watchedQuoteIds.includes(stock.quoteId) ?? false

  const updateSnapshot = useCallback((nextSnapshot: MarketInsightSnapshot | null) => {
    setSnapshot(nextSnapshot)
    onSnapshotChanged(nextSnapshot)
  }, [onSnapshotChanged])

  const loadSnapshot = useCallback(async (refresh = false, allowCreate = true) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const nextSnapshot = refresh
        ? await marketInsightApi.refresh(stock.quoteId)
        : await marketInsightApi.getSnapshot(stock.quoteId)
      updateSnapshot(nextSnapshot)
      if (!nextSnapshot && !refresh && allowCreate) {
        const created = await marketInsightApi.refresh(stock.quoteId)
        updateSnapshot(created)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '市场观察数据加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [stock.quoteId, updateSnapshot])

  useEffect(() => {
    let active = true
    Promise.all([
      marketInsightApi.getStatus(),
      marketInsightApi.getSettings(),
      marketInsightApi.getSnapshot(stock.quoteId)
    ])
      .then(([nextStatus, nextSettings, initialSnapshot]) => {
        if (!active) return
        setStatus(nextStatus)
        setSettings(nextSettings)
        onChartOverlayEnabledChange(nextSettings.showChartOverlay)
        updateSnapshot(initialSnapshot)
        if (!initialSnapshot && nextStatus.enabled) void loadSnapshot(true)
        else setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '市场观察设置加载失败')
        setLoading(false)
      })
    const unsubscribe = marketInsightApi.onUpdated((quoteId) => {
      if (quoteId !== stock.quoteId) return
      void Promise.all([
        marketInsightApi.getSnapshot(quoteId),
        marketInsightApi.getStatus()
      ]).then(([nextSnapshot, nextStatus]) => {
        if (!active) return
        setStatus(nextStatus)
        updateSnapshot(nextSnapshot)
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [loadSnapshot, onChartOverlayEnabledChange, stock.quoteId, updateSnapshot])

  const saveSettings = useCallback(async (nextSettings: MarketInsightSettings) => {
    const normalized = normalizeMarketInsightSettings(nextSettings)
    setSettings(normalized)
    await marketInsightApi.saveSettings(normalized)
    setStatus((current) => current ? { ...current, enabled: normalized.enabled, watchedQuoteIds: normalized.watchedQuoteIds } : current)
  }, [])

  const toggleWatching = async () => {
    if (!settings) return
    setError('')
    try {
      const watchedQuoteIds = isWatching
        ? settings.watchedQuoteIds.filter((quoteId) => quoteId !== stock.quoteId)
        : [...settings.watchedQuoteIds, stock.quoteId]
      await saveSettings({ ...settings, watchedQuoteIds })
      if (!isWatching) await loadSnapshot(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '盯盘设置保存失败')
    }
  }

  const toggleModule = async () => {
    if (!settings) return
    const nextSettings = { ...settings, enabled: !settings.enabled }
    try {
      await saveSettings(nextSettings)
      if (nextSettings.enabled) await loadSnapshot(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模块开关保存失败')
    }
  }

  const toggleOverlay = async () => {
    if (!settings) return
    try {
      const nextSettings = { ...settings, showChartOverlay: !settings.showChartOverlay }
      await saveSettings(nextSettings)
      onChartOverlayEnabledChange(nextSettings.showChartOverlay)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图表叠加设置保存失败')
    }
  }

  const toggleOlderNews = async () => {
    if (!settings) return
    try {
      await saveSettings({ ...settings, includeOlderNews: !settings.includeOlderNews })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '要闻查询范围保存失败')
    }
  }

  const acknowledge = async (eventId: string) => {
    try {
      await marketInsightApi.acknowledgeEvent(eventId)
      const events = await marketInsightApi.listEvents(stock.quoteId)
      if (snapshot) updateSnapshot({ ...snapshot, events })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '事件确认失败')
    }
  }

  const clearExpiredEvents = async () => {
    try {
      await marketInsightApi.clearExpiredEvents(stock.quoteId)
      const events = await marketInsightApi.listEvents(stock.quoteId)
      if (snapshot) updateSnapshot({ ...snapshot, events })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '过期事件清理失败')
    }
  }

  const saveThresholds = async () => {
    if (!settings) return
    try {
      await saveSettings(settings)
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

  const refreshedLabel = useMemo(() => snapshot ? formatUpdateTime(snapshot.generatedAt) : '--:--:--', [snapshot])

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
          <button className="secondary-button" type="button" onClick={toggleModule} disabled={!settings}>
            <Power size={14} />
            {settings?.enabled ? '关闭市场洞察' : '开启市场洞察'}
          </button>
          <button className="secondary-button" type="button" onClick={toggleOverlay} disabled={!settings}>
            {settings?.showChartOverlay ? <EyeOff size={14} /> : <Eye size={14} />}
            {settings?.showChartOverlay ? '隐藏图表叠加' : '显示图表叠加'}
          </button>
          <button className="secondary-button" type="button" onClick={toggleWatching} disabled={!settings}>
            <Radar size={14} />
            {isWatching ? '关闭该股票盯盘' : '开启该股票盯盘'}
          </button>
          <button className="secondary-button" type="button" onClick={() => void loadSnapshot(true)} disabled={refreshing || !status?.enabled}>
            <RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />
            立即刷新
          </button>
        </div>
      </header>

      <div className={`insight-data-state is-${snapshot?.dataState ?? 'cached'}`}>
        {snapshot?.dataState === 'stale' ? <AlertCircle size={14} /> : <Radio size={14} />}
        <span>{snapshot?.dataState === 'stale' ? '部分数据可能已过期，当前显示最近一次缓存。' : snapshot?.dataState === 'cached' ? '当前显示缓存数据。' : '当前快照由现有行情和分层数据源计算。'}</span>
        <span>{!status?.enabled ? '市场洞察模块当前已关闭。' : isWatching ? '该股票已开启后台盯盘。' : '该股票未开启后台盯盘；详情页打开时仍可手动刷新。'}</span>
        <span>{stock.isPriority ? '重点关注股票的新闻每 15 分钟自动查询。' : '非重点股票的新闻在交易日收盘后每天查询一次。'}</span>
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
              value={settings.volumeSpikeRatio}
              onChange={(event) => setSettings({ ...settings, volumeSpikeRatio: Number(event.target.value) })}
            />
          </label>
          <label>
            冷却
            <input
              type="number"
              min="1"
              step="1"
              value={settings.eventCooldownMinutes}
              onChange={(event) => setSettings({ ...settings, eventCooldownMinutes: Number(event.target.value) })}
            />
            分钟
          </label>
          <button className="secondary-button" type="button" onClick={() => void saveThresholds()}>
            保存阈值
          </button>
        </div>
      ) : null}

      {error ? <div className="insight-error"><AlertCircle size={15} />{error}</div> : null}
      {loading && !snapshot ? <div className="chart-loading">正在计算确定性市场指标…</div> : null}
      {snapshot ? (
        <div className="insight-content">
          <IndicatorGrid
            title="分时观察"
            values={snapshot.indicators.intraday}
            headingValueId="price-volume-state"
          />
          <IndicatorGrid title="趋势" values={snapshot.indicators.trend} />
          <div className="insight-indicator-split">
            <IndicatorGrid title="动量" values={snapshot.indicators.momentum} />
            <IndicatorGrid title="波动" values={snapshot.indicators.volatility} />
          </div>
          <IndicatorGrid title="盘口与相对强弱" values={[...snapshot.indicators.orderBook, ...snapshot.indicators.relativeStrength]} />
          <WatchEventList
            events={snapshot.events}
            onAcknowledge={(eventId) => void acknowledge(eventId)}
            onClearExpired={() => void clearExpiredEvents()}
          />
          <TPlanDistanceCard distances={snapshot.existingTPlanDistances} />
          <NewsTimeline
            news={snapshot.news}
            status={status}
            includeOlderNews={settings?.includeOlderNews ?? false}
            onToggleOlderNews={() => void toggleOlderNews()}
            onOpenSource={(url) => void openSource(url)}
          />
          <p className="insight-disclaimer">窗口指标使用已闭合 K 线，最后一根可能未闭合的分时柱不计入窗口；盘口只反映可见委托，不代表真实成交意愿或必然走势。所有观察事件仅陈述可复算的客观条件，不构成交易建议。</p>
        </div>
      ) : null}
    </div>
  )
}
