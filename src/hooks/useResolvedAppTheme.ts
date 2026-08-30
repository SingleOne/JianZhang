import { useEffect, useState } from 'react'
import {
  APP_THEME_CHANGED_EVENT,
  getResolvedAppTheme,
  type AppThemeChangeDetail,
  type ResolvedAppTheme
} from '../lib/theme'

export function useResolvedAppTheme(): ResolvedAppTheme {
  const [theme, setTheme] = useState<ResolvedAppTheme>(getResolvedAppTheme)

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setTheme((event as CustomEvent<AppThemeChangeDetail>).detail.resolvedTheme)
    }
    window.addEventListener(APP_THEME_CHANGED_EVENT, handleThemeChange)
    return () => window.removeEventListener(APP_THEME_CHANGED_EVENT, handleThemeChange)
  }, [])

  return theme
}
