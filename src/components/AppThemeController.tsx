import { useEffect } from 'react'

import { applyAppThemePreference, readCachedAppThemePreference } from '../lib/theme'

export function AppThemeController() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const handleSystemThemeChange = () => {
      const preference = readCachedAppThemePreference()

      if (preference === 'system') {
        applyAppThemePreference(preference)
      }
    }

    media.addEventListener('change', handleSystemThemeChange)
    return () => media.removeEventListener('change', handleSystemThemeChange)
  }, [])

  return null
}
