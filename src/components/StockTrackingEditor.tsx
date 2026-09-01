import {
  BookOpenText,
  CircleStop,
  Eye,
  History,
  Play,
  Plus,
  Save,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import { useState } from 'react'
import {
  STOCK_TRACKING_CONCLUSION_LABELS,
  STOCK_TRACKING_ENTRY_LABELS,
  STOCK_TRACKING_SOURCE_LABELS,
  addTrackingSourceTags,
  addStockTrackingEntry,
  trackingProfileSourceTags,
  trackingSourceDescription
} from '../lib/stock-tracking'
import { formatPercent, formatPrice } from '../lib/format'
import type { StockTrackingPerformance } from '../lib/stock-tracking-performance'
import type {
  DailyKlineIndicator,
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingEntryType,
  StockTrackingProfile
} from '../shared/types'
import { marketFromQuoteId } from '../shared/stock-market'
import { AppSelect, type AppSelectOption } from './AppSelect'
import { StockTrackingMetricsPanel } from './StockTrackingMetricsPanel'
import type { StockTrackingMarketData } from './useStockTrackingMarketData'

interface StockTrackingEditorProps {
  profile: StockTrackingProfile
  quote?: StockQuote
  performance?: StockTrackingPerformance
  marketData?: StockTrackingMarketData
  showDailyKline?: boolean
  bollingerBandsEnabled?: boolean
  onBollingerBandsEnabledChange?: (enabled: boolean) => void
  dailyKlineIndicator?: DailyKlineIndicator
  onDailyKlineIndicatorChange?: (indicator: DailyKlineIndicator) => void
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
  canRestart?: boolean
  onViewStock?: () => void
  onDeleteStock?: () => void
}

const CONCLUSION_OPTIONS = Object.entries(STOCK_TRACKING_CONCLUSION_LABELS).map(
  ([value, label]) => ({ value: value as StockTrackingConclusionResult, label })
) satisfies readonly AppSelectOption<StockTrackingConclusionResult>[]

type EditableEntryType = Exclude<StockTrackingEntryType, 'system'>

const ENTRY_TYPE_OPTIONS = (['note', 'thesis', 'review'] as const).map((value) => ({
  value,
  label: STOCK_TRACKING_ENTRY_LABELS[value]
})) satisfies readonly AppSelectOption<EditableEntryType>[]

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export function StockTrackingEditor({
  profile,
  quote,
  performance,
  marketData,
  showDailyKline = false,
  bollingerBandsEnabled,
  onBollingerBandsEnabledChange,
  dailyKlineIndicator,
  onDailyKlineIndicatorChange,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking,
  canRestart = true,
  onViewStock,
  onDeleteStock
}: StockTrackingEditorProps) {
  const [thesis, setThesis] = useState(profile.thesis)
  const [tagInput, setTagInput] = useState('')
  const [entryType, setEntryType] = useState<EditableEntryType>('note')
  const [entryContent, setEntryContent] = useState('')
  const [showStopForm, setShowStopForm] = useState(false)
  const [conclusionResult, setConclusionResult] =
    useState<StockTrackingConclusionResult>('unverified')
  const [conclusionSummary, setConclusionSummary] = useState('')
  const sourceTags = trackingProfileSourceTags(profile)
  const missingSourceTags = sourceTags.filter((tag) => !profile.tags.includes(tag))

  const saveThesis = () => {
    const now = new Date().toISOString()
    onUpdateProfile({ ...profile, thesis: thesis.trim(), updatedAt: now })
  }

  const addTags = () => {
    const nextTags = tagInput
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (nextTags.length === 0) return
    onUpdateProfile({
      ...profile,
      tags: [...new Set([...profile.tags, ...nextTags])],
      updatedAt: new Date().toISOString()
    })
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    onUpdateProfile({
      ...profile,
      tags: profile.tags.filter((item) => item !== tag),
      updatedAt: new Date().toISOString()
    })
  }

  const addSourceTags = () => {
    onUpdateProfile(addTrackingSourceTags(profile))
  }

  const addEntry = () => {
    if (!entryContent.trim()) return
    onUpdateProfile(addStockTrackingEntry(profile, entryType, entryContent, quote))
    setEntryContent('')
  }

  return (
    <div className="stock-tracking-editor">
      <header className="stock-tracking-editor-header">
        <div className="stock-tracking-editor-identity">
          <span className={`stock-tracking-status is-${profile.status}`}>
            {profile.status === 'tracking' ? '追踪中' : '已停止'}
          </span>
          <strong>{profile.name}</strong>
          <small>
            {profile.code} · {profile.marketLabel}
          </small>
        </div>
        <div className="stock-tracking-editor-actions">
          {onViewStock ? (
            <button className="secondary-button" type="button" onClick={onViewStock}>
              <Eye size={14} />
              查看股票详情
            </button>
          ) : null}
          {profile.status === 'tracking' ? (
            <>
              <button
                className="secondary-button stock-tracking-stop-trigger"
                type="button"
                onClick={() => setShowStopForm((current) => !current)}
              >
                <CircleStop size={15} />
                停止追踪
              </button>
              {onDeleteStock ? (
                <button
                  className="icon-button stock-tracking-delete-stock"
                  type="button"
                  onClick={onDeleteStock}
                  aria-label={`从股票列表中删除 ${profile.name} 并停止追踪`}
                  title="从股票列表中删除并停止追踪"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </>
          ) : (
            <button
              className="primary-button stock-tracking-restart"
              type="button"
              onClick={() => onRestartTracking(profile.quoteId)}
              disabled={!canRestart}
              title={canRestart ? undefined : '请先重新加入自选，再恢复追踪'}
            >
              <Play size={15} />
              重新追踪
            </button>
          )}
        </div>
      </header>

      {showStopForm && profile.status === 'tracking' ? (
        <section className="stock-tracking-stop-form">
          <div className="stock-tracking-field">
            <span>追踪结论</span>
            <AppSelect
              value={conclusionResult}
              options={CONCLUSION_OPTIONS}
              label="追踪结论"
              onChange={setConclusionResult}
            />
          </div>
          <label>
            <span>停止原因与复盘总结</span>
            <textarea
              value={conclusionSummary}
              onChange={(event) => setConclusionSummary(event.target.value)}
              placeholder="记录逻辑是否兑现、为什么停止，以及后续需要改进的地方"
            />
          </label>
          <div className="stock-tracking-stop-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowStopForm(false)}
            >
              取消
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => onStopTracking(profile.quoteId, conclusionResult, conclusionSummary)}
            >
              确认停止
            </button>
          </div>
        </section>
      ) : null}

      {profile.conclusion ? (
        <section className="stock-tracking-conclusion">
          <strong>{STOCK_TRACKING_CONCLUSION_LABELS[profile.conclusion.result]}</strong>
          <span>{profile.conclusion.summary || '未填写停止总结'}</span>
          <small>停止于 {formatDateTime(profile.conclusion.stoppedAt)}</small>
        </section>
      ) : null}

      {performance ? (
        <section className="stock-tracking-performance" aria-label="追踪表现">
          <span>
            <small>追踪以来</small>
            <strong className={valueClass(performance.trackingReturn)}>
              {formatPercent(performance.trackingReturn)}
            </strong>
          </span>
          <span>
            <small>区间最大涨幅</small>
            <strong className={valueClass(performance.maximumGain)}>
              {formatPercent(performance.maximumGain)}
            </strong>
          </span>
          <span>
            <small>最大回撤</small>
            <strong className={valueClass(performance.maximumDrawdown)}>
              {formatPercent(performance.maximumDrawdown)}
            </strong>
          </span>
          <span>
            <small>观察天数</small>
            <strong>{performance.trackingDays} 天</strong>
          </span>
        </section>
      ) : null}

      <StockTrackingMetricsPanel
        snapshots={profile.metricSnapshots}
        market={marketFromQuoteId(profile.quoteId)}
        marketData={marketData}
        showDailyKline={showDailyKline}
        trackingStartedAt={profile.startedAt}
        trackingStoppedAt={profile.stoppedAt}
        bollingerBandsEnabled={bollingerBandsEnabled}
        onBollingerBandsEnabledChange={onBollingerBandsEnabledChange}
        dailyKlineIndicator={dailyKlineIndicator}
        onDailyKlineIndicatorChange={onDailyKlineIndicatorChange}
      />

      <section className="stock-tracking-section">
        <div className="stock-tracking-section-title">
          <History size={16} />
          <strong>来源历史</strong>
        </div>
        <div className="stock-tracking-sources">
          {profile.sources.map((source) => (
            <article key={source.id}>
              <strong>{STOCK_TRACKING_SOURCE_LABELS[source.type]}</strong>
              <span>{trackingSourceDescription(source) || formatDateTime(source.recordedAt)}</span>
              <small>{formatDateTime(source.recordedAt)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="stock-tracking-section">
        <div className="stock-tracking-section-title">
          <Tag size={16} />
          <strong>标签与特点</strong>
          <button
            className="stock-tracking-source-tags-button"
            type="button"
            onClick={addSourceTags}
            disabled={missingSourceTags.length === 0}
            title={
              missingSourceTags.length > 0
                ? `添加来源标签：${missingSourceTags.join('、')}`
                : sourceTags.length > 0
                  ? '当前来源标签已全部添加'
                  : '当前来源没有可添加的标签'
            }
          >
            <Plus size={13} />
            一键添加来源标签
          </button>
        </div>
        <div className="stock-tracking-tags">
          {profile.tags.map((tag) => (
            <span key={tag}>
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`删除标签 ${tag}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="stock-tracking-inline-form">
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTags()
              }
            }}
            placeholder="输入标签，多个标签用逗号分隔"
            aria-label="股票追踪标签"
          />
          <button
            className="secondary-button"
            type="button"
            onClick={addTags}
            disabled={!tagInput.trim()}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
      </section>

      <div className="stock-tracking-edit-grid">
        <section className="stock-tracking-section">
          <div className="stock-tracking-section-title">
            <BookOpenText size={16} />
            <strong>当前选股逻辑与总结</strong>
          </div>
          <textarea
            className="stock-tracking-thesis"
            value={thesis}
            onChange={(event) => setThesis(event.target.value)}
            placeholder="记录为什么关注这只股票、预期验证条件、风险点和失效条件"
          />
          <div className="stock-tracking-save-row">
            <span>输入内容不会在每次按键时写入配置，请点击保存。</span>
            <button className="primary-button" type="button" onClick={saveThesis}>
              <Save size={14} />
              保存总结
            </button>
          </div>
        </section>

        <section className="stock-tracking-section">
          <div className="stock-tracking-section-title">
            <History size={16} />
            <strong>新增跟踪记录</strong>
          </div>
          <div className="stock-tracking-entry-form">
            <textarea
              value={entryContent}
              onChange={(event) => setEntryContent(event.target.value)}
              placeholder="记录今天观察到的变化、判断和后续计划"
            />
            <div className="stock-tracking-save-row">
              <AppSelect
                className="stock-tracking-entry-type-select"
                value={entryType}
                options={ENTRY_TYPE_OPTIONS}
                label="跟踪记录类型"
                onChange={setEntryType}
              />
              <button
                className="primary-button"
                type="button"
                onClick={addEntry}
                disabled={!entryContent.trim()}
              >
                <Plus size={14} />
                添加记录
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="stock-tracking-section">
        <div className="stock-tracking-section-title">
          <History size={16} />
          <strong>追踪时间线</strong>
          <small>{profile.entries.length} 条</small>
        </div>
        <div className="stock-tracking-timeline">
          {profile.entries.map((entry) => (
            <article className={`is-${entry.type}`} key={entry.id}>
              <div>
                <strong>{STOCK_TRACKING_ENTRY_LABELS[entry.type]}</strong>
                <small>{formatDateTime(entry.createdAt)}</small>
              </div>
              <p>{entry.content}</p>
              {entry.quoteSnapshot ? (
                <span>
                  当时股价 {formatPrice(entry.quoteSnapshot.latest)}
                  <em className={valueClass(entry.quoteSnapshot.changePercent)}>
                    {formatPercent(entry.quoteSnapshot.changePercent)}
                  </em>
                </span>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
