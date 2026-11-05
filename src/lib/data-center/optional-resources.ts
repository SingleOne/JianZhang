import { dataCenter } from '../api'
import type { AiSettings } from '../../modules/ai/shared/types'
import type { AiTAdviceSettings } from '../../modules/ai-t-advice/shared/types'
import type { MarketInsightSettings } from '../../modules/market-insight/shared/types'
import { normalizeMarketInsightSettings } from '../../modules/market-insight/shared/normalize'

const options = (category: string, quoteId = '', maxAge = 0) => ({ category, quoteId, maxAge })

export const aiStatusResource = () =>
  window.aiApi
    ? dataCenter.details.resource(
        'ai:status',
        () => window.aiApi!.getStatus(),
        options('ai-settings')
      )
    : undefined
export const aiSettingsResource = () =>
  window.aiApi
    ? dataCenter.details.resource(
        'ai:settings',
        () => window.aiApi!.getSettings(),
        options('ai-settings')
      )
    : undefined
export const shortAnalysisResource = (quoteId: string) =>
  window.aiApi
    ? dataCenter.details.resource(
        JSON.stringify(['ai:short', quoteId]),
        (force) =>
          force ? window.aiApi!.interpret(quoteId) : window.aiApi!.getLatestInterpretation(quoteId),
        options('ai-interpretations', quoteId)
      )
    : undefined
export const longAnalysisResource = (quoteId: string) =>
  window.aiApi
    ? dataCenter.details.resource(
        JSON.stringify(['ai:long', quoteId]),
        (force) =>
          force
            ? window.aiApi!.interpretLongTerm(quoteId)
            : window.aiApi!.getLatestLongTermInterpretation(quoteId),
        options('ai-interpretations', quoteId)
      )
    : undefined

let aiSettingsWrite = Promise.resolve()
export function saveAiSettings(settings: AiSettings) {
  const task = aiSettingsWrite.then(async () => {
    const saved = await window.aiApi!.saveSettings(settings)
    aiSettingsResource()!.update(saved)
    const status = aiStatusResource()!
    // Publish the enabled flag immediately, then reread provider/credential status.
    const current = status.getSnapshot().data
    if (current) status.update({ ...current, enabled: saved.enabled })
    await status.request(true)
    return saved
  })
  aiSettingsWrite = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

export const tAdviceSettingsResource = () =>
  window.aiTAdviceApi
    ? dataCenter.details.resource(
        'ai-t:settings',
        () => window.aiTAdviceApi!.getSettings(),
        options('ai-t-settings')
      )
    : undefined
export const tAdviceHistoryResource = (quoteId: string, accountId: string) =>
  window.aiTAdviceApi
    ? dataCenter.details.resource(
        JSON.stringify(['ai-t:history', quoteId, accountId]),
        () => window.aiTAdviceApi!.listHistory(quoteId, accountId),
        options('ai-t-history', quoteId)
      )
    : undefined
export async function saveTAdviceSettings(settings: AiTAdviceSettings) {
  const saved = await window.aiTAdviceApi!.saveSettings(settings)
  tAdviceSettingsResource()!.update(saved)
  return saved
}

// Optional renderer code stays lazy; production builds without the module never load fixtures.
async function insightApi() {
  if (window.marketInsightApi) return window.marketInsightApi
  return (await import('../../modules/market-insight/renderer/demo')).marketInsightDemoApi
}
export const insightSettingsResource = () =>
  dataCenter.details.resource(
    'insight:settings',
    async () => normalizeMarketInsightSettings(await (await insightApi()).getSettings()),
    options('market-insight-settings')
  )
export const insightStatusResource = () =>
  dataCenter.details.resource(
    'insight:status',
    async () => (await insightApi()).getStatus(),
    options('market-insight-status')
  )
const insightRefreshes = new Set<string>()
export const insightSnapshotResource = (quoteId: string) =>
  dataCenter.details.resource(
    JSON.stringify(['insight:snapshot', quoteId]),
    async (force) => {
      const api = await insightApi()
      if (!force) return api.getSnapshot(quoteId)
      insightRefreshes.add(quoteId)
      try {
        return await api.refresh(quoteId)
      } finally {
        insightRefreshes.delete(quoteId)
      }
    },
    options('market-insight', quoteId, Infinity)
  )

let insightSettingsWrite = Promise.resolve()
export function changeInsightSettings(
  change: (current: MarketInsightSettings) => MarketInsightSettings
) {
  const task = insightSettingsWrite.then(async () => {
    const resource = insightSettingsResource()
    const current = await resource.request()
    const next = normalizeMarketInsightSettings(change(current))
    await (await insightApi()).saveSettings(next)
    resource.update(next)
    insightStatusResource().invalidate()
    return next
  })
  insightSettingsWrite = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

export async function refreshInsight(quoteId: string) {
  await insightSnapshotResource(quoteId).request(true)
  insightStatusResource().invalidate()
}

let insightConsumers = 0
let insightSubscriptionVersion = 0
let unsubscribeInsight: (() => void) | undefined
export function retainInsightUpdates() {
  insightConsumers += 1
  if (insightConsumers === 1) {
    const version = ++insightSubscriptionVersion
    void insightApi().then((api) => {
      if (version !== insightSubscriptionVersion || !insightConsumers) return
      unsubscribeInsight = api.onUpdated((quoteId) => {
        if (!insightRefreshes.has(quoteId))
          dataCenter.details.invalidate(quoteId, ['market-insight'])
        insightStatusResource().invalidate()
      })
    })
  }
  return () => {
    insightConsumers -= 1
    if (!insightConsumers) {
      insightSubscriptionVersion += 1
      unsubscribeInsight?.()
      unsubscribeInsight = undefined
    }
  }
}
