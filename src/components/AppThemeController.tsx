import { useEffect } from 'react'
import { getInitialBootstrap, stockApi } from '../lib/api'
import { applyAppThemePreference, readCachedAppThemePreference } from '../lib/theme'

export function AppThemeController() {
  useEffect(() => {
    let active = true
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      const preference = readCachedAppThemePreference()
      if (preference === 'system') applyAppThemePreference(preference)
    }
    const unsubscribeState = stockApi.onStateUpdated((state) => {
      applyAppThemePreference(state.settings.theme)
    })

    media.addEventListener('change', handleSystemThemeChange)
    void getInitialBootstrap().then((bootstrap) => {
      if (active) applyAppThemePreference(bootstrap.state.settings.theme)
    })

    return () => {
      active = false
      media.removeEventListener('change', handleSystemThemeChange)
      unsubscribeState()
    }
  }, [])

  return null
}
