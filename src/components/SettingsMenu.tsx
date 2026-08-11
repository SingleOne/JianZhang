import {
  CloudDownload,
  CloudUpload,
  Download,
  Github,
  RefreshCw,
  Save,
  Settings2,
  Upload
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import {
  MARKET_INDEX_OPTIONS,
  type AppSettings,
  type DataSnapshotRuntimeState,
  type GitHubSyncSettings,
  type GitHubSyncSettingsInput,
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
  githubSyncBusy: boolean
  onSaveGitHubSyncSettings: (input: GitHubSyncSettingsInput) => void
  onUploadUserDataToGitHub: (input: GitHubSyncSettingsInput) => void
  onDownloadUserDataFromGitHub: (input: GitHubSyncSettingsInput) => void
  onRefreshTradingCalendar: () => void
  calendarRefreshing: boolean
  fundamentalDataState: DataSnapshotRuntimeState
  onUpdateFundamentalData: () => void
}

const T_PLAN_DEFAULT_GROUPS = [
  { key: 'buyLevels', label: '买入五档', percentLabel: '跌幅' },
  { key: 'sellLevels', label: '卖出五档', percentLabel: '涨幅' }
] as const

type SettingsTab = 'market' | 'trading' | 'system'

const SETTINGS_TABS = [
  { id: 'market', label: '行情' },
  { id: 'trading', label: '做T' },
  { id: 'system', label: '系统与数据' }
] as const satisfies readonly { id: SettingsTab; label: string }[]

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

export function SettingsMenu({
  settings,
  onChange,
  onImportConfig,
  onExportConfig,
  configBusy,
  githubSyncSettings,
  githubSyncBusy,
  onSaveGitHubSyncSettings,
  onUploadUserDataToGitHub,
  onDownloadUserDataFromGitHub,
  onRefreshTradingCalendar,
  calendarRefreshing,
  fundamentalDataState,
  onUpdateFundamentalData
}: SettingsMenuProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('market')
  const [githubSyncInput, setGitHubSyncInput] = useState<GitHubSyncSettingsInput>({
    owner: githubSyncSettings.owner,
    repository: githubSyncSettings.repository,
    branch: githubSyncSettings.branch,
    filePath: githubSyncSettings.filePath,
    token: ''
  })

  useEffect(() => {
    setGitHubSyncInput({
      owner: githubSyncSettings.owner,
      repository: githubSyncSettings.repository,
      branch: githubSyncSettings.branch,
      filePath: githubSyncSettings.filePath,
      token: ''
    })
  }, [githubSyncSettings])

  const updateGitHubSyncInput = (key: keyof GitHubSyncSettingsInput, value: string) => {
    setGitHubSyncInput((current) => ({ ...current, [key]: value }))
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
                  <Github size={16} />
                  <span>
                    <strong>GitHub 私有仓库同步</strong>
                    <small>上传同一份未加密备份；请使用仅授权目标仓库 Contents 读写的 Token</small>
                  </span>
                </span>
                <div className="github-sync-fields">
                  <label>
                    <span>所有者</span>
                    <input
                      value={githubSyncInput.owner}
                      onChange={(event) => updateGitHubSyncInput('owner', event.target.value)}
                      placeholder="GitHub 用户名"
                    />
                  </label>
                  <label>
                    <span>仓库</span>
                    <input
                      value={githubSyncInput.repository}
                      onChange={(event) => updateGitHubSyncInput('repository', event.target.value)}
                      placeholder="私有仓库名"
                    />
                  </label>
                  <label>
                    <span>分支</span>
                    <input
                      value={githubSyncInput.branch}
                      onChange={(event) => updateGitHubSyncInput('branch', event.target.value)}
                      placeholder="main"
                    />
                  </label>
                  <label>
                    <span>同步路径</span>
                    <input
                      value={githubSyncInput.filePath}
                      onChange={(event) => updateGitHubSyncInput('filePath', event.target.value)}
                      placeholder=".jianzhang-sync/user-data.json"
                    />
                  </label>
                  <label className="github-sync-token-field">
                    <span>Personal Access Token</span>
                    <input
                      type="password"
                      value={githubSyncInput.token}
                      onChange={(event) => updateGitHubSyncInput('token', event.target.value)}
                      placeholder={
                        githubSyncSettings.tokenConfigured
                          ? `已配置 ····${githubSyncSettings.tokenMaskedSuffix ?? ''}`
                          : '输入 Fine-grained Token'
                      }
                    />
                  </label>
                </div>
                <div className="github-sync-actions">
                  <button
                    type="button"
                    onClick={() => onSaveGitHubSyncSettings(githubSyncInput)}
                    disabled={githubSyncBusy}
                  >
                    <Save size={15} />
                    保存连接
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadUserDataFromGitHub(githubSyncInput)}
                    disabled={githubSyncBusy}
                  >
                    <CloudDownload size={15} />从 GitHub 恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => onUploadUserDataToGitHub(githubSyncInput)}
                    disabled={githubSyncBusy}
                  >
                    <CloudUpload size={15} />
                    上传到 GitHub
                  </button>
                </div>
                {githubSyncSettings.lastUploadedAt || githubSyncSettings.lastDownloadedAt ? (
                  <small className="github-sync-status">
                    {githubSyncSettings.lastUploadedAt
                      ? `最近上传：${formatCalendarRefreshTime(githubSyncSettings.lastUploadedAt)}`
                      : ''}
                    {githubSyncSettings.lastUploadedAt && githubSyncSettings.lastDownloadedAt
                      ? ' · '
                      : ''}
                    {githubSyncSettings.lastDownloadedAt
                      ? `最近恢复：${formatCalendarRefreshTime(githubSyncSettings.lastDownloadedAt)}`
                      : ''}
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
