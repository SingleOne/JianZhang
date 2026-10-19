import type { AppSettings } from '../shared/types'
import { AppButton } from './AppButton'
import { FloatingTickerSettings } from './FloatingTickerSettings'

const DISPLAY_OPTIONS = [
  { value: 'stock', label: '单股行情' },
  { value: 'profit', label: '今日收益' },
  { value: 'icon', label: '仅图标' }
] as const

export function MenuBarSettings({
  settings,
  onChange
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}) {
  return (
    <>
      <div className="setting-row">
        <span>
          <strong>菜单栏展示内容</strong>
          <small>今日收益为所选股票合计，统一折算人民币</small>
        </span>
        <div className="theme-option-group" role="radiogroup" aria-label="菜单栏展示内容">
          {DISPLAY_OPTIONS.map((option) => (
            <AppButton
              key={option.value}
              variant="plain"
              role="radio"
              aria-checked={settings.menuBarDisplayMode === option.value}
              className={settings.menuBarDisplayMode === option.value ? 'is-selected' : ''}
              onClick={() => onChange({ ...settings, menuBarDisplayMode: option.value })}
            >
              {option.label}
            </AppButton>
          ))}
        </div>
      </div>
      {settings.menuBarDisplayMode === 'stock' ? (
        <div className="setting-row">
          <span>
            <strong>股票轮播</strong>
            <small>关闭时固定显示一只；右键菜单栏图标可选择股票</small>
          </span>
          <div className="theme-option-group" role="radiogroup" aria-label="菜单栏股票轮播间隔">
            {[0, 5, 10, 15, 30].map((seconds) => (
              <AppButton
                key={seconds}
                variant="plain"
                role="radio"
                aria-checked={settings.menuBarRotationSeconds === seconds}
                className={settings.menuBarRotationSeconds === seconds ? 'is-selected' : ''}
                onClick={() => onChange({ ...settings, menuBarRotationSeconds: seconds })}
              >
                {seconds === 0 ? '关闭' : `${seconds} 秒`}
              </AppButton>
            ))}
          </div>
        </div>
      ) : null}
      <FloatingTickerSettings settings={settings} onChange={onChange} />
    </>
  )
}
