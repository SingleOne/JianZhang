import { normalizeMarketInsightSettings } from '../shared/normalize'
import type { MarketInsightSettings } from '../shared/types'
import { marketInsightApi } from './api'

type SettingsListener = (settings: MarketInsightSettings) => void

const listeners = new Set<SettingsListener>()

export async function getMarketInsightSettings(): Promise<MarketInsightSettings> {
  return normalizeMarketInsightSettings(await marketInsightApi.getSettings())
}

export async function saveMarketInsightSettings(
  settings: MarketInsightSettings
): Promise<MarketInsightSettings> {
  const normalized = normalizeMarketInsightSettings(settings)
  await marketInsightApi.saveSettings(normalized)
  for (const listener of listeners) listener(normalized)
  return normalized
}

export function subscribeMarketInsightSettings(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
