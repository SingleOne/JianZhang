import { useEffect, useState } from 'react'
import type { MarketInsightSettings } from '../shared/types'
import {
  getMarketInsightSettings,
  saveMarketInsightSettings,
  subscribeMarketInsightSettings
} from './settings-store'

export function MarketInsightSettingsToggle() {
  const [settings, setSettings] = useState<MarketInsightSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getMarketInsightSettings()
      .then((nextSettings) => {
        if (active) setSettings(nextSettings)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '市场观察设置读取失败')
      })
    const unsubscribe = subscribeMarketInsightSettings((nextSettings) => {
      if (active) setSettings(nextSettings)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const toggle = async (enabled: boolean) => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      await saveMarketInsightSettings({ ...settings, enabled })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '市场观察设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="setting-row market-insight-setting-row">
      <span>
        <strong>市场观察</strong>
        <small>{error || '启用确定性指标、客观观察事件以及公告和要闻查询'}</small>
      </span>
      <input
        className="switch-input"
        type="checkbox"
        checked={settings?.enabled ?? false}
        disabled={!settings || saving}
        onChange={(event) => void toggle(event.target.checked)}
        aria-label="市场观察"
      />
    </label>
  )
}
