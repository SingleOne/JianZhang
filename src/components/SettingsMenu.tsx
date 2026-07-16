import { Download, Settings2, Upload } from 'lucide-react'
import type { AppSettings } from '../shared/types'

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
