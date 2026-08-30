import type { AppThemePreference } from '../shared/types'

export type ResolvedAppTheme = 'light' | 'dark'

export const APP_THEME_CHANGED_EVENT = 'jianzhang:theme-changed'

const THEME_STORAGE_KEY = 'jianzhang-theme-preference-v1'

export interface AppThemeChangeDetail {
  preference: AppThemePreference
  resolvedTheme: ResolvedAppTheme
}

export interface ChartThemeColors {
  background: string
  text: string
  grid: string
  border: string
  accent: string
  red: string
  green: string
  amber: string
  purple: string
}

function isThemePreference(value: string | null): value is AppThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readCachedAppThemePreference(): AppThemePreference {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isThemePreference(saved) ? saved : 'system'
}

export function resolveAppTheme(preference: AppThemePreference): ResolvedAppTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getResolvedAppTheme(): ResolvedAppTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function applyAppThemePreference(preference: AppThemePreference): void {
  const resolvedTheme = resolveAppTheme(preference)
  const previousTheme = getResolvedAppTheme()
  if (readCachedAppThemePreference() !== preference) {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  }
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.style.colorScheme = resolvedTheme
  if (previousTheme === resolvedTheme) return
  window.dispatchEvent(
    new CustomEvent<AppThemeChangeDetail>(APP_THEME_CHANGED_EVENT, {
      detail: { preference, resolvedTheme }
    })
  )
}

export function initializeAppTheme(): void {
  applyAppThemePreference(readCachedAppThemePreference())
}

export function getChartThemeColors(theme: ResolvedAppTheme): ChartThemeColors {
  if (theme === 'dark') {
    return {
      background: '#111827',
      text: '#98a6ba',
      grid: '#263449',
      border: '#34445d',
      accent: '#5b8cff',
      red: '#ff6b75',
      green: '#35c98b',
      amber: '#f3b85b',
      purple: '#a78bfa'
    }
  }
  return {
    background: '#ffffff',
    text: '#64748b',
    grid: '#eef2f7',
    border: '#cbd5e1',
    accent: '#2563eb',
    red: '#ef4444',
    green: '#16a085',
    amber: '#d97706',
    purple: '#7c3aed'
  }
}
