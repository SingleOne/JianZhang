import { useState } from 'react'

import {
  insightSettingsResource,
  changeInsightSettings
} from '../../../lib/data-center/optional-resources'
import { useDetailResource } from '../../../lib/data-center/detail-hooks'

export function MarketInsightSettingsToggle() {
  const resource = useDetailResource(insightSettingsResource())
  const settings = resource.data
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = async (enabled: boolean) => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      await changeInsightSettings((current) => ({ ...current, enabled }))
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
        <small>{error || resource.error || '启用确定性指标、客观观察事件以及公告和要闻查询'}</small>
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
