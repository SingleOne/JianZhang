import {
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Sparkles,
  Settings2,
  Upload
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import {
  MARKET_INDEX_OPTIONS,
  type AppSettings,
  type CacheCategoryId,
  type CacheSummary,
  type DataSnapshotRuntimeState,
  type GitHubDeviceAuthorization,
  type GitHubSyncSettings,
  type MarketIndexId
} from '../shared/types'

const MarketInsightSettingsToggle = __JIANZHANG_MARKET_INSIGHT_ENABLED__
  ? lazy(() =>
      import('../modules/market-insight/renderer/MarketInsightSettingsToggle').then((module) => ({
        default: module.MarketInsightSettingsToggle
      }))
    )
  : null

interface SettingsMenuProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onImportConfig: () => void
  onExportConfig: () => void
  configBusy: boolean
  githubSyncSettings: GitHubSyncSettings
  githubSyncPassword: string | null
  githubGistLoading: boolean
  githubSyncPasswordSaving: boolean
  githubSyncError: string
  githubDeviceAuthorization: GitHubDeviceAuthorization | null
  githubSyncBusy: boolean
  githubSyncUploading: boolean
  githubSyncDownloading: boolean
  onConnectGitHub: () => void
  onDisconnectGitHub: () => void
  onGenerateGitHubSyncPassword: () => Promise<string>
  onSaveGitHubSyncPassword: (password: string) => Promise<boolean>
  onUploadUserDataToGitHub: () => void
  onDownloadUserDataFromGitHub: () => void
  onRefreshTradingCalendar: () => void
  calendarRefreshing: boolean
  fundamentalDataState: DataSnapshotRuntimeState
  onUpdateFundamentalData: () => void
  cacheSummary: CacheSummary | null
  cacheBusy: boolean
  onRefreshCacheSummary: () => void
  onClearCaches: (categoryIds: CacheCategoryId[]) => void
}

const T_PLAN_DEFAULT_GROUPS = [
  { key: 'buyLevels', label: '买入五档', percentLabel: '跌幅' },
  { key: 'sellLevels', label: '卖出五档', percentLabel: '涨幅' }
] as const

type SettingsTab = 'market' | 'trading' | 'system' | 'data'

const SETTINGS_TABS = [
  { id: 'market', label: '行情' },
  { id: 'trading', label: '做T' },
  { id: 'system', label: '系统' },
  { id: 'data', label: '数据' }
] as const satisfies readonly { id: SettingsTab; label: string }[]

function GitHubIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.96 10.96 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  )
}

function formatCalendarRefreshTime(value: string | null): string {
  if (!value) return '尚未在线刷新'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function dataStatusLabel(state: DataSnapshotRuntimeState): string {
  if (state.status === 'ready') return '数据有效'
  if (state.status === 'stale') return '已过期'
  if (state.status === 'queued') return '等待更新'
  if (state.status === 'updating') return '正在更新'
  if (state.status === 'failed') return '更新失败'
  return '尚无数据'
}

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function SettingsMenu({
  settings,
  onChange,
  onImportConfig,
  onExportConfig,
  configBusy,
  githubSyncSettings,
  githubSyncPassword,
  githubGistLoading,
  githubSyncPasswordSaving,
  githubSyncError,
  githubDeviceAuthorization,
  githubSyncBusy,
  githubSyncUploading,
  githubSyncDownloading,
  onConnectGitHub,
  onDisconnectGitHub,
  onGenerateGitHubSyncPassword,
  onSaveGitHubSyncPassword,
  onUploadUserDataToGitHub,
  onDownloadUserDataFromGitHub,
  onRefreshTradingCalendar,
  calendarRefreshing,
  fundamentalDataState,
  onUpdateFundamentalData,
  cacheSummary,
  cacheBusy,
  onRefreshCacheSummary,
  onClearCaches
}: SettingsMenuProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('market')
  const [githubPasswordEditing, setGitHubPasswordEditing] = useState(false)
  const [githubPasswordVisible, setGitHubPasswordVisible] = useState(false)
  const [githubPasswordDraft, setGitHubPasswordDraft] = useState('')
  const [githubPasswordConfirmation, setGitHubPasswordConfirmation] = useState('')
  const [githubPasswordMessage, setGitHubPasswordMessage] = useState('')
  const [cacheAdvancedOpen, setCacheAdvancedOpen] = useState(false)
  const [selectedCacheIds, setSelectedCacheIds] = useState<CacheCategoryId[]>([])
  const githubControlsDisabled = githubSyncBusy || githubGistLoading

  const defaultCacheIds =
    cacheSummary?.categories
      .filter((category) => category.group === 'default')
      .map((category) => category.id) ?? []
  const advancedCacheCategories =
    cacheSummary?.categories.filter((category) => category.group !== 'default') ?? []

  const toggleCacheSelection = (categoryId: CacheCategoryId, selected: boolean) => {
    setSelectedCacheIds((current) => {
      if (selected) return current.includes(categoryId) ? current : [...current, categoryId]
      return current.filter((id) => id !== categoryId)
    })
  }

  const editGitHubPassword = () => {
    setGitHubPasswordDraft(githubSyncPassword ?? '')
    setGitHubPasswordConfirmation(githubSyncPassword ?? '')
    setGitHubPasswordMessage('')
    setGitHubPasswordEditing(true)
  }

  const generateGitHubPassword = async () => {
    const generated = await onGenerateGitHubSyncPassword()
    if (!generated) return
    setGitHubPasswordDraft(generated)
    setGitHubPasswordConfirmation(generated)
    setGitHubPasswordVisible(true)
    setGitHubPasswordMessage('已生成安全密钥，保存前可以自行修改')
  }

  const saveGitHubPassword = async () => {
    if (!githubPasswordDraft.trim()) {
      setGitHubPasswordMessage('请输入同步密码')
      return
    }
    if (githubPasswordDraft !== githubPasswordConfirmation) {
      setGitHubPasswordMessage('两次输入的同步密码不一致')
      return
    }
    if (await onSaveGitHubSyncPassword(githubPasswordDraft)) {
      setGitHubPasswordEditing(false)
      setGitHubPasswordMessage('')
    }
  }

  const toggleMarketIndex = (indexId: MarketIndexId, selected: boolean) => {
    const selectedIds = new Set(settings.marketIndexIds)
    if (selected) selectedIds.add(indexId)
    else selectedIds.delete(indexId)
    onChange({
      ...settings,
      marketIndexIds: MARKET_INDEX_OPTIONS.filter((index) => selectedIds.has(index.id)).map(
        (index) => index.id
      )
    })
  }

  const updateTradingFee = (key: keyof AppSettings['tTradingFees'], value: number) => {
    onChange({
      ...settings,
      tTradingFees: {
        ...settings.tTradingFees,
        [key]: Math.max(0, value || 0)
      }
    })
  }

  const updateTPlanDefault = (
    side: 'buyLevels' | 'sellLevels',
    index: number,
    key: 'targetPercent' | 'quantity',
    value: number
  ) => {
    onChange({
      ...settings,
      tPlanDefaults: {
        ...settings.tPlanDefaults,
        [side]: settings.tPlanDefaults[side].map((level, levelIndex) =>
          levelIndex === index ? { ...level, [key]: Math.max(0, value || 0) } : level
        )
      }
    })
  }

  return (
    <details className="settings-menu">
      <summary className="secondary-button" title="设置">
        <Settings2 size={17} />
        <span>设置</span>
      </summary>
      <div className="settings-popover">
        <div className="settings-heading">
          <strong>应用设置</strong>
          <span>修改后立即生效</span>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          {SETTINGS_TABS.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              className={activeTab === tab.id ? 'is-active' : ''}
              onClick={() => setActiveTab(tab.id)}
              key={tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="settings-panel" id={`settings-panel-${activeTab}`} role="tabpanel">
          {activeTab === 'market' ? (
            <>
              <label className="setting-row setting-row-input">
                <span>
                  <strong>重点关注刷新</strong>
                  <small>默认 5 秒，建议不少于 3 秒</small>
                </span>
                <span className="number-input-wrap">
                  <input
                    type="number"
                    min="3"
                    max="300"
                    value={settings.priorityRefreshSeconds}
                    onChange={(event) => {
                      const value = Math.min(300, Math.max(3, Number(event.target.value) || 3))
                      onChange({ ...settings, priorityRefreshSeconds: value })
                    }}
                    aria-label="重点关注股票刷新间隔秒数"
                  />
                  <span>秒</span>
                </span>
              </label>
              <label className="setting-row setting-row-input">
                <span>
                  <strong>其余股票刷新</strong>
                  <small>默认 10 秒，建议不少于 3 秒</small>
                </span>
                <span className="number-input-wrap">
                  <input
                    type="number"
                    min="3"
                    max="300"
                    value={settings.regularRefreshSeconds}
                    onChange={(event) => {
                      const value = Math.min(300, Math.max(3, Number(event.target.value) || 3))
                      onChange({ ...settings, regularRefreshSeconds: value })
                    }}
                    aria-label="其余股票刷新间隔秒数"
                  />
                  <span>秒</span>
                </span>
              </label>
              {MarketInsightSettingsToggle ? (
                <Suspense
                  fallback={
                    <div className="setting-row market-insight-setting-row">
                      <span>
                        <strong>市场观察</strong>
                        <small>正在读取功能设置…</small>
                      </span>
                      <input
                        className="switch-input"
                        type="checkbox"
                        disabled
                        aria-label="市场观察设置读取中"
                      />
                    </div>
                  }
                >
                  <MarketInsightSettingsToggle />
                </Suspense>
              ) : null}
              <fieldset className="market-index-setting">
                <legend>大盘指数</legend>
                <small>选择显示在总收益左侧的指数，按其余股票间隔刷新</small>
                <div className="market-index-options">
                  {MARKET_INDEX_OPTIONS.map((index) => (
                    <label key={index.id}>
                      <input
                        type="checkbox"
                        checked={settings.marketIndexIds.includes(index.id)}
                        onChange={(event) => toggleMarketIndex(index.id, event.target.checked)}
                      />
                      <span>{index.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}

          {activeTab === 'trading' ? (
            <>
              <fieldset className="trading-fee-setting">
                <legend>做T费用</legend>
                <small>
                  佣金按净佣金计算；深A将过户费计入最低 5 元，沪A过户费在最低 5 元外单独收取
                </small>
                <div className="trading-fee-grid">
                  <label>
                    <span>佣金</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={settings.tTradingFees.commissionRatePerTenThousand}
                      onChange={(event) =>
                        updateTradingFee('commissionRatePerTenThousand', Number(event.target.value))
                      }
                    />
                    <em>万分</em>
                  </label>
                  <label>
                    <span>最低合计</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settings.tTradingFees.minimumCommissionBundle}
                      onChange={(event) =>
                        updateTradingFee('minimumCommissionBundle', Number(event.target.value))
                      }
                    />
                    <em>元</em>
                  </label>
                  <label>
                    <span>经手费</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={settings.tTradingFees.handlingRatePerTenThousand}
                      onChange={(event) =>
                        updateTradingFee('handlingRatePerTenThousand', Number(event.target.value))
                      }
                    />
                    <em>万分</em>
                  </label>
                  <label>
                    <span>证管费</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={settings.tTradingFees.regulatoryRatePerTenThousand}
                      onChange={(event) =>
                        updateTradingFee('regulatoryRatePerTenThousand', Number(event.target.value))
                      }
                    />
                    <em>万分</em>
                  </label>
                  <label>
                    <span>过户费</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={settings.tTradingFees.transferRatePerTenThousand}
                      onChange={(event) =>
                        updateTradingFee('transferRatePerTenThousand', Number(event.target.value))
                      }
                    />
                    <em>万分</em>
                  </label>
                  <label>
                    <span>印花税</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={settings.tTradingFees.stampDutyRatePerTenThousand}
                      onChange={(event) =>
                        updateTradingFee('stampDutyRatePerTenThousand', Number(event.target.value))
                      }
                    />
                    <em>万分</em>
                  </label>
                </div>
              </fieldset>
              <fieldset className="t-plan-default-setting">
                <legend>双五档默认值</legend>
                <small>新建 T 仓、交易后重排以及“重置双五档”时使用</small>
                <div className="t-plan-default-groups">
                  {T_PLAN_DEFAULT_GROUPS.map((group) => (
                    <section className="t-plan-default-group" key={group.key}>
                      <strong>{group.label}</strong>
                      <div className="t-plan-default-level is-head">
                        <span>档</span>
                        <span>{group.percentLabel}%</span>
                        <span>数量</span>
                      </div>
                      {settings.tPlanDefaults[group.key].map((level, index) => (
                        <div className="t-plan-default-level" key={index}>
                          <b>T{index + 1}</b>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={level.targetPercent}
                            onChange={(event) => {
                              updateTPlanDefault(
                                group.key,
                                index,
                                'targetPercent',
                                Number(event.target.value)
                              )
                            }}
                            aria-label={`${group.label} T${index + 1} ${group.percentLabel}`}
                          />
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={level.quantity}
                            onChange={(event) => {
                              updateTPlanDefault(
                                group.key,
                                index,
                                'quantity',
                                Number(event.target.value)
                              )
                            }}
                            aria-label={`${group.label} T${index + 1} 数量`}
                          />
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </fieldset>
              <label className="setting-row setting-row-input t-floating-profit-alert-default-setting">
                <span>
                  <strong>浮动盈亏提醒默认值</strong>
                  <small>新建交易批次默认提醒 ±该金额，当前批次可单独修改</small>
                </span>
                <span className="number-input-wrap">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={settings.tFloatingProfitAlertDefaultThreshold}
                    onChange={(event) => {
                      const value = Math.max(1, Number(event.target.value) || 1)
                      onChange({ ...settings, tFloatingProfitAlertDefaultThreshold: value })
                    }}
                    aria-label="T仓浮动盈亏提醒默认金额"
                  />
                  <span>元</span>
                </span>
              </label>
            </>
          ) : null}

          {activeTab === 'system' ? (
            <>
              <label className="setting-row">
                <span>
                  <strong>任务栏行情</strong>
                  <small>显示已在“操作”列选中的股票</small>
                </span>
                <input
                  className="switch-input"
                  type="checkbox"
                  checked={settings.showTaskbarTicker}
                  onChange={(event) =>
                    onChange({ ...settings, showTaskbarTicker: event.target.checked })
                  }
                />
              </label>
              <label className="setting-row setting-row-position">
                <span>
                  <strong>任务栏横向位置</strong>
                  <small>拖动滑块，避开任务栏已有内容</small>
                </span>
                <span className="position-slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={settings.taskbarPositionPercent}
                    onChange={(event) => {
                      onChange({ ...settings, taskbarPositionPercent: Number(event.target.value) })
                    }}
                    aria-label="任务栏行情横向位置"
                  />
                  <span className="position-slider-labels">
                    <span>最左</span>
                    <output>{settings.taskbarPositionPercent}%</output>
                    <span>最右</span>
                  </span>
                </span>
              </label>
              <label className="setting-row">
                <span>
                  <strong>开机自动启动</strong>
                  <small>登录 Windows 后自动运行</small>
                </span>
                <input
                  className="switch-input"
                  type="checkbox"
                  checked={settings.startWithWindows}
                  onChange={(event) =>
                    onChange({ ...settings, startWithWindows: event.target.checked })
                  }
                />
              </label>
              <label className="setting-row">
                <span>
                  <strong>关闭后驻留</strong>
                  <small>继续在任务栏直接显示行情并后台刷新</small>
                </span>
                <input
                  className="switch-input"
                  type="checkbox"
                  checked={settings.minimizeToTray}
                  onChange={(event) =>
                    onChange({ ...settings, minimizeToTray: event.target.checked })
                  }
                />
              </label>
            </>
          ) : null}

          {activeTab === 'data' ? (
            <>
              <div className="trading-calendar-setting">
                <span>
                  <strong>交易日历</strong>
                  <small>每年首次启动时自动从上交所更新，失败时可手动重试</small>
                  <small>
                    已覆盖至 {settings.tradingCalendar.coveredThroughYear} 年 · 最近刷新：
                    {formatCalendarRefreshTime(settings.tradingCalendar.lastRefreshedAt)}
                  </small>
                  {settings.tradingCalendar.lastError ? (
                    <small className="is-error">
                      最近尝试 {formatCalendarRefreshTime(settings.tradingCalendar.lastAttemptedAt)}{' '}
                      失败：
                      {settings.tradingCalendar.lastError}
                    </small>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={onRefreshTradingCalendar}
                  disabled={calendarRefreshing}
                >
                  <RefreshCw size={14} className={calendarRefreshing ? 'is-spinning' : ''} />
                  {calendarRefreshing ? '刷新中' : '手动刷新'}
                </button>
              </div>
              <div className={`fundamental-data-setting is-${fundamentalDataState.status}`}>
                <span>
                  <strong>基本面财务数据</strong>
                  <small>
                    {fundamentalDataState.periodLabel ?? '等待首次获取'} ·
                    {fundamentalDataState.recordCount > 0
                      ? ` ${fundamentalDataState.recordCount.toLocaleString('zh-CN')} 家公司`
                      : ' 暂无公司数据'}
                  </small>
                  <small>
                    状态：{dataStatusLabel(fundamentalDataState)} · 最近生成：
                    {formatCalendarRefreshTime(fundamentalDataState.generatedAt)}
                  </small>
                  {fundamentalDataState.staleReason ? (
                    <small className="is-warning">{fundamentalDataState.staleReason}</small>
                  ) : null}
                  {fundamentalDataState.progressMessage ? (
                    <small>{fundamentalDataState.progressMessage}</small>
                  ) : null}
                  {fundamentalDataState.error ? (
                    <small className="is-error">{fundamentalDataState.error}</small>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={onUpdateFundamentalData}
                  disabled={
                    fundamentalDataState.status === 'queued' ||
                    fundamentalDataState.status === 'updating'
                  }
                >
                  <RefreshCw
                    size={14}
                    className={fundamentalDataState.status === 'updating' ? 'is-spinning' : ''}
                  />
                  {fundamentalDataState.status === 'queued'
                    ? '等待中'
                    : fundamentalDataState.status === 'updating'
                      ? '更新中'
                      : '立即更新'}
                </button>
              </div>
              <div className="cache-management">
                <span className="cache-management-heading">
                  <span>
                    <strong>缓存管理</strong>
                    <small>默认只清理行情临时缓存和诊断日志；清理后应用会自动重启</small>
                  </span>
                  <button type="button" onClick={onRefreshCacheSummary} disabled={cacheBusy}>
                    {cacheBusy ? '处理中…' : '刷新统计'}
                  </button>
                </span>
                <div className="cache-management-summary">
                  {cacheSummary ? (
                    <>
                      {cacheSummary.categories
                        .filter((category) => category.group === 'default')
                        .map((category) => (
                          <span key={category.id}>
                            {category.label} {formatCacheSize(category.sizeBytes)}
                          </span>
                        ))}
                    </>
                  ) : (
                    <span>正在读取缓存占用…</span>
                  )}
                </div>
                <div className="cache-management-actions">
                  <button
                    type="button"
                    onClick={() => onClearCaches(defaultCacheIds)}
                    disabled={cacheBusy || defaultCacheIds.length === 0}
                  >
                    {cacheBusy ? '清理中…' : '清理临时缓存和日志'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCacheAdvancedOpen((open) => !open)}
                    disabled={cacheBusy || !cacheSummary}
                  >
                    {cacheAdvancedOpen ? '收起高级清理' : '高级清理'}
                  </button>
                </div>
                {cacheAdvancedOpen ? (
                  <div className="cache-advanced-panel">
                    <small>以下数据按股票或模块保存，清理后相关页面需要重新获取。</small>
                    {advancedCacheCategories.map((category) => (
                      <label key={category.id} className="cache-category-option">
                        <input
                          type="checkbox"
                          checked={selectedCacheIds.includes(category.id)}
                          onChange={(event) =>
                            toggleCacheSelection(category.id, event.target.checked)
                          }
                          disabled={cacheBusy}
                        />
                        <span>
                          <strong>
                            {category.label}
                            {category.group === 'separate' ? ' · 需单独确认' : ''}
                          </strong>
                          <small>
                            {category.description} · {formatCacheSize(category.sizeBytes)}
                          </small>
                        </span>
                      </label>
                    ))}
                    <button
                      type="button"
                      className="cache-advanced-clear-button"
                      onClick={() => onClearCaches(selectedCacheIds)}
                      disabled={cacheBusy || selectedCacheIds.length === 0}
                    >
                      清理选中数据
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="config-management">
                <span>
                  <strong>用户数据备份</strong>
                  <small>
                    备份自选、追踪、持仓、交易、设置、AI 数据和 API Key；文件暂未加密，请妥善保管
                  </small>
                </span>
                <span className="config-management-actions">
                  <button type="button" onClick={onImportConfig} disabled={configBusy}>
                    <Upload size={15} />
                    导入用户数据
                  </button>
                  <button type="button" onClick={onExportConfig} disabled={configBusy}>
                    <Download size={15} />
                    导出用户数据
                  </button>
                </span>
              </div>
              <div className="github-sync-management">
                <span className="github-sync-heading">
                  <span className="github-sync-heading-copy">
                    <span className="github-sync-title">
                      <strong>GitHub Gist 同步</strong>
                      <GitHubIcon size={16} />
                      {githubSyncSettings.connected ? (
                        <span className="github-connection-summary">
                          （已连接 {githubSyncSettings.accountLogin ?? 'GitHub 账号'} ·{' '}
                          <button
                            type="button"
                            onClick={onDisconnectGitHub}
                            disabled={githubControlsDisabled}
                          >
                            断开
                          </button>
                          ）
                        </span>
                      ) : null}
                    </span>
                    <small>使用本机同步密码加密后保存到 Secret Gist</small>
                  </span>
                </span>
                {!githubSyncSettings.connected ? (
                  <button
                    className="github-connect-button"
                    type="button"
                    onClick={onConnectGitHub}
                    disabled={githubSyncBusy || !githubSyncSettings.oauthAvailable}
                  >
                    <GitHubIcon size={15} />
                    {githubSyncBusy ? '等待网页授权…' : '连接 GitHub'}
                  </button>
                ) : (
                  <div className="github-connected-panel">
                    <div className="github-gist-target">
                      {githubGistLoading ? (
                        '正在自动查找 Gist…'
                      ) : githubSyncSettings.gistId ? (
                        <>
                          <strong>Secret Gist 已绑定</strong> ·{' '}
                          {githubSyncSettings.requiresRemoteRestore
                            ? '远程版本与本机同步记录不一致，上传时会提示覆盖风险'
                            : `Gist ${githubSyncSettings.gistId.slice(0, 10)} · jianzhang-user-data.json`}
                        </>
                      ) : (
                        <>
                          <strong>尚未创建同步 Gist</strong> · 首次上传时自动创建，无需填写 Gist
                          链接
                        </>
                      )}
                    </div>
                    {githubSyncError ? (
                      <small className="github-sync-error">{githubSyncError}</small>
                    ) : null}
                  </div>
                )}
                {githubDeviceAuthorization ? (
                  <div className="github-device-code">
                    <span>请在已打开的 GitHub 网页输入验证码</span>
                    <span className="github-device-code-value">
                      <strong>{githubDeviceAuthorization.userCode}</strong>
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(githubDeviceAuthorization.userCode)
                        }
                        aria-label="复制 GitHub 设备验证码"
                        title="复制验证码"
                      >
                        <Copy size={15} />
                      </button>
                    </span>
                    <small>验证码已复制，完成授权后应用会自动继续</small>
                  </div>
                ) : null}
                {!githubSyncSettings.connected && githubSyncError ? (
                  <small className="github-sync-error">{githubSyncError}</small>
                ) : null}
                {!githubSyncSettings.oauthAvailable ? (
                  <small className="github-oauth-unavailable">
                    当前构建未配置 GitHub OAuth App Client ID，暂时不能发起网页授权
                  </small>
                ) : null}
                {githubSyncSettings.connected || githubSyncSettings.hasStoredPassword ? (
                  <div className="github-password-panel">
                    <span className="github-password-heading">
                      <span>
                        <KeyRound size={15} />
                        <strong>同步密码</strong>
                        {githubSyncSettings.syncPasswordReady && !githubPasswordEditing ? (
                          <small>已绑定本机；本地显示和使用不需要再次验证</small>
                        ) : null}
                      </span>
                      {githubSyncSettings.connected &&
                      githubSyncSettings.syncPasswordReady &&
                      !githubPasswordEditing ? (
                        <button
                          type="button"
                          onClick={editGitHubPassword}
                          disabled={githubControlsDisabled}
                        >
                          更换
                        </button>
                      ) : null}
                    </span>
                    {githubSyncSettings.syncPasswordReady && !githubPasswordEditing ? (
                      <div className="github-password-value">
                        <input
                          type={githubPasswordVisible ? 'text' : 'password'}
                          value={githubSyncPassword ?? ''}
                          readOnly
                          aria-label="本机保存的 GitHub Gist 同步密码"
                        />
                        <button
                          type="button"
                          onClick={() => setGitHubPasswordVisible((visible) => !visible)}
                          disabled={githubControlsDisabled}
                          aria-label={githubPasswordVisible ? '隐藏同步密码' : '显示同步密码'}
                          title={githubPasswordVisible ? '隐藏同步密码' : '显示同步密码'}
                        >
                          {githubPasswordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (githubSyncPassword) {
                              void navigator.clipboard.writeText(githubSyncPassword)
                            }
                          }}
                          disabled={githubControlsDisabled}
                          aria-label="复制同步密码"
                          title="复制同步密码"
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    ) : githubSyncSettings.connected ? (
                      <div className="github-password-editor">
                        <label>
                          <span>同步密码</span>
                          <input
                            type={githubPasswordVisible ? 'text' : 'password'}
                            value={githubPasswordDraft}
                            onChange={(event) => setGitHubPasswordDraft(event.target.value)}
                            disabled={githubControlsDisabled}
                            placeholder="由你设置，或使用安全密钥生成器"
                            autoComplete="new-password"
                          />
                        </label>
                        <label>
                          <span>确认密码</span>
                          <input
                            type={githubPasswordVisible ? 'text' : 'password'}
                            value={githubPasswordConfirmation}
                            onChange={(event) => setGitHubPasswordConfirmation(event.target.value)}
                            disabled={githubControlsDisabled}
                            placeholder="再次输入同步密码"
                            autoComplete="new-password"
                          />
                        </label>
                        <span className="github-password-editor-actions">
                          <button
                            type="button"
                            onClick={() => setGitHubPasswordVisible((visible) => !visible)}
                            disabled={githubControlsDisabled}
                          >
                            {githubPasswordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                            {githubPasswordVisible ? '隐藏' : '显示'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateGitHubPassword()}
                            disabled={githubControlsDisabled}
                          >
                            <Sparkles size={14} />
                            生成安全密钥
                          </button>
                          {githubSyncSettings.syncPasswordReady ? (
                            <button
                              type="button"
                              onClick={() => {
                                setGitHubPasswordEditing(false)
                                setGitHubPasswordMessage('')
                              }}
                              disabled={githubControlsDisabled}
                            >
                              取消
                            </button>
                          ) : null}
                          <button
                            className="is-primary"
                            type="button"
                            onClick={() => void saveGitHubPassword()}
                            disabled={githubControlsDisabled}
                          >
                            {githubSyncPasswordSaving ? '保存中…' : '保存并绑定本机'}
                          </button>
                        </span>
                        {githubPasswordMessage ? (
                          <small className="github-password-message">{githubPasswordMessage}</small>
                        ) : githubPasswordDraft && githubPasswordDraft.length < 12 ? (
                          <small className="github-password-warning">
                            密码较短，Gist 链接泄露后更容易被离线破解
                          </small>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {githubSyncSettings.connected ? (
                  <div className="github-sync-actions">
                    <button
                      type="button"
                      onClick={onDownloadUserDataFromGitHub}
                      disabled={
                        githubControlsDisabled ||
                        !githubSyncSettings.gistId ||
                        !githubSyncSettings.syncPasswordReady
                      }
                    >
                      {githubSyncDownloading ? (
                        <RefreshCw size={15} className="is-spinning" />
                      ) : (
                        <CloudDownload size={15} />
                      )}
                      {githubSyncDownloading ? '恢复中…' : '从 GitHub 恢复'}
                    </button>
                    <button
                      type="button"
                      onClick={onUploadUserDataToGitHub}
                      disabled={githubControlsDisabled || !githubSyncSettings.syncPasswordReady}
                    >
                      {githubSyncUploading ? (
                        <RefreshCw size={15} className="is-spinning" />
                      ) : (
                        <CloudUpload size={15} />
                      )}
                      {githubSyncUploading ? '上传中…' : '上传到 Gist'}
                    </button>
                  </div>
                ) : null}
                {githubSyncSettings.localDataUpdatedAt || githubSyncSettings.remoteDataUpdatedAt ? (
                  <small className="github-sync-status">
                    <span>
                      本地版本：
                      {githubSyncSettings.localDataUpdatedAt
                        ? formatCalendarRefreshTime(githubSyncSettings.localDataUpdatedAt)
                        : '暂无数据'}
                    </span>
                    <span>
                      远程版本：
                      {githubSyncSettings.remoteDataUpdatedAt
                        ? formatCalendarRefreshTime(githubSyncSettings.remoteDataUpdatedAt)
                        : '暂无备份'}
                    </span>
                  </small>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </details>
  )
}
