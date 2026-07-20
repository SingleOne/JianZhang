import type { MarketInsightSettings, MarketInsightSnapshot, WatchEvent } from '../../shared/types'
import { detectWatchEvents } from './detect'
import { pruneWatchEvents, reconcileWatchEvents } from './lifecycle'

export function replayMarketInsightHistory(
  snapshots: readonly MarketInsightSnapshot[],
  settings: MarketInsightSettings,
  maxEventsPerStock = 200
): WatchEvent[] {
  let events: WatchEvent[] = []
  let previous: MarketInsightSnapshot | null = null
  for (const snapshot of snapshots) {
    const detection = detectWatchEvents(previous, snapshot, settings)
    events = pruneWatchEvents(
      reconcileWatchEvents(
        events,
        detection.drafts,
        settings.eventCooldownMinutes,
        snapshot.generatedAt,
        detection.activeContinuousFingerprints
      ),
      maxEventsPerStock,
      snapshot.generatedAt
    )
    previous = snapshot
  }
  return events
}
