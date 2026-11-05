import { useEffect } from 'react'
import { dataCenter } from '../api'
import type { OptionalModulesState } from '../../shared/types'
import { useDetailResource } from './detail-hooks'
import { EMPTY_GITHUB_SETTINGS } from './runtime-resources'

const INITIAL_MODULES: OptionalModulesState = {
  marketInsight: {
    status: __JIANZHANG_MARKET_INSIGHT_ENABLED__ ? 'initializing' : 'disabled',
    error: null
  },
  ai: { status: __JIANZHANG_AI_MODULE_ENABLED__ ? 'initializing' : 'disabled', error: null },
  aiTAdvice: {
    status: __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__ ? 'initializing' : 'disabled',
    error: null
  }
}
const EMPTY_NOTIFICATIONS: import('../../shared/types').AppCompletionNotification[] = []

export function useOptionalModulesState() {
  useEffect(() => dataCenter.runtime.retainModules(), [])
  return useDetailResource(dataCenter.runtime.modules).data ?? INITIAL_MODULES
}
export function useCacheSummary(enabled = true) {
  useEffect(() => {
    if (enabled) dataCenter.runtime.refreshCache()
  }, [enabled])
  return useDetailResource(dataCenter.runtime.cache, enabled).data ?? null
}
export function useGitHubSyncSettings(enabled = true) {
  useEffect(() => {
    if (enabled) void dataCenter.runtime.github.request(true).catch(() => undefined)
  }, [enabled])
  return useDetailResource(dataCenter.runtime.github, enabled).data ?? EMPTY_GITHUB_SETTINGS
}
export function useCompletionNotifications() {
  useEffect(() => dataCenter.completionNotifications.retain(), [])
  return useDetailResource(dataCenter.completionNotifications.resource).data ?? EMPTY_NOTIFICATIONS
}
