import { useState } from 'react'
import { stockApi } from '../lib/api'
import type { AppSettings } from '../shared/types'
import { AppButton } from './AppButton'

const FLOATING_TICKER_OPTIONS = [
  {
    key: 'showFloatingTicker',
    title: '独立行情浮窗',
    detail: '展示菜单栏所选股票，拖动标题栏可移动'
  },
  { key: 'floatingTickerAlwaysOnTop', title: '浮窗置顶', detail: '在普通应用窗口上方持续显示' },
  {
    key: 'floatingTickerAllWorkspaces',
    title: '所有桌面显示浮窗',
    detail: '跨桌面显示，避开其他应用的全屏内容'
  }
] as const

export function FloatingTickerSettings({
  settings,
  onChange
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}) {
  const [error, setError] = useState('')

  return (
    <>
      {FLOATING_TICKER_OPTIONS.filter(
        (option) => option.key === 'showFloatingTicker' || settings.showFloatingTicker
      ).map((option) => (
        <div className="setting-row" key={option.key}>
          <span>
            <strong>{option.title}</strong>
            <small>{option.detail}</small>
          </span>
          <div
            className="theme-option-group floating-ticker-setting-options"
            role="radiogroup"
            aria-label={option.title}
          >
            {[true, false].map((enabled) => (
              <AppButton
                key={String(enabled)}
                variant="plain"
                role="radio"
                aria-checked={settings[option.key] === enabled}
                className={settings[option.key] === enabled ? 'is-selected' : ''}
                onClick={() => onChange({ ...settings, [option.key]: enabled })}
              >
                {enabled ? '开启' : '关闭'}
              </AppButton>
            ))}
          </div>
        </div>
      ))}
      {settings.showFloatingTicker ? (
        <div className="setting-row">
          <span>
            <strong>浮窗位置</strong>
            <small>{error || '位置在本机保存，外接屏断开时自动移回可见区域'}</small>
          </span>
          <AppButton
            onClick={() => {
              setError('')
              void stockApi
                .resetFloatingTickerPosition()
                .catch(() => setError('重置位置失败，请重试'))
            }}
          >
            重置位置
          </AppButton>
        </div>
      ) : null}
    </>
  )
}
