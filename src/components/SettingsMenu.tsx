import { Download, Settings2, Upload } from 'lucide-react'
import { MARKET_INDEX_OPTIONS, type AppSettings, type MarketIndexId } from '../shared/types'

interface SettingsMenuProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onImportConfig: () => void
  onExportConfig: () => void
  configBusy: boolean
}

export function SettingsMenu({
  settings,
  onChange,
  onImportConfig,
  onExportConfig,
  configBusy
}: SettingsMenuProps) {
  const toggleMarketIndex = (indexId: MarketIndexId, selected: boolean) => {
    const selectedIds = new Set(settings.marketIndexIds)
    if (selected) selectedIds.add(indexId)
    else selectedIds.delete(indexId)
    onChange({
      ...settings,
      marketIndexIds: MARKET_INDEX_OPTIONS
        .filter((index) => selectedIds.has(index.id))
        .map((index) => index.id)
    })
  }

  const updateTradingFee = (
    key: keyof AppSettings['tTradingFees'],
    value: number
  ) => {
    onChange({
      ...settings,
      tTradingFees: {
        ...settings.tTradingFees,
        [key]: Math.max(0, value || 0)
      }
    })
  }

  return (
    <details className="settings-menu">
      <summary className="secondary-button">
        <Settings2 size={17} />
        设置
      </summary>
      <div className="settings-popover">
        <div className="settings-heading">
          <strong>应用设置</strong>
          <span>修改后立即生效</span>
        </div>
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
        <fieldset className="trading-fee-setting">
          <legend>做T费用</legend>
          <small>佣金按净佣金计算，佣金、经手费和证管费合计最低 5 元</small>
          <div className="trading-fee-grid">
            <label>
              <span>佣金</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={settings.tTradingFees.commissionRatePerTenThousand}
                onChange={(event) => updateTradingFee('commissionRatePerTenThousand', Number(event.target.value))}
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
                onChange={(event) => updateTradingFee('minimumCommissionBundle', Number(event.target.value))}
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
                onChange={(event) => updateTradingFee('handlingRatePerTenThousand', Number(event.target.value))}
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
                onChange={(event) => updateTradingFee('regulatoryRatePerTenThousand', Number(event.target.value))}
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
                onChange={(event) => updateTradingFee('transferRatePerTenThousand', Number(event.target.value))}
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
                onChange={(event) => updateTradingFee('stampDutyRatePerTenThousand', Number(event.target.value))}
              />
              <em>万分</em>
            </label>
          </div>
        </fieldset>
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
        <label className="setting-row">
          <span>
            <strong>任务栏行情</strong>
            <small>显示已在“操作”列选中的股票</small>
          </span>
          <input
            className="switch-input"
            type="checkbox"
            checked={settings.showTaskbarTicker}
            onChange={(event) => onChange({ ...settings, showTaskbarTicker: event.target.checked })}
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
            onChange={(event) => onChange({ ...settings, startWithWindows: event.target.checked })}
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
            onChange={(event) => onChange({ ...settings, minimizeToTray: event.target.checked })}
          />
        </label>
        <div className="config-management">
          <span>
            <strong>配置管理</strong>
            <small>备份或恢复自选、持仓、排序与应用设置</small>
          </span>
          <span className="config-management-actions">
            <button type="button" onClick={onImportConfig} disabled={configBusy}>
              <Upload size={15} />
              导入配置
            </button>
            <button type="button" onClick={onExportConfig} disabled={configBusy}>
              <Download size={15} />
              导出配置
            </button>
          </span>
        </div>
      </div>
    </details>
  )
}
