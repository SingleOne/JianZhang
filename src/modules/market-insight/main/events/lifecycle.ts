import type { WatchEvent, WatchEventType } from '../../shared/types'
import { deduplicateEventDrafts, hasEventFingerprint } from './deduplicate'
import type { WatchEventDraft } from './detect'

export function reconcileWatchEvents(
  existing: readonly WatchEvent[],
  drafts: readonly WatchEventDraft[],
  cooldownMinutes: number,
  now: string,
  activeContinuousFingerprints: readonly string[] = []
): WatchEvent[] {
  const timestamp = new Date(now).getTime()
  const activeFingerprints = new Set(activeContinuousFingerprints)
  const continuousTypes = new Set<WatchEventType>([
    'vwap_cross',
    'opening_range_break',
    'volume_spike',
    'intraday_extreme'
  ])
  const active = existing.map((event) =>
    (new Date(event.expiresAt).getTime() <= timestamp ||
      (continuousTypes.has(event.type) && !activeFingerprints.has(event.fingerprint))) &&
    event.status !== 'expired'
      ? { ...event, status: 'expired' as const }
      : event
  )
  const additions = deduplicateEventDrafts(drafts)
    .filter((item) => !hasEventFingerprint(active, item.fingerprint))
    .filter(
      (item) =>
        !active.some((event) => {
          const sameEvent = event.quoteId === item.quoteId && event.fingerprint === item.fingerprint
          const inCooldown =
            timestamp - new Date(event.occurredAt).getTime() < cooldownMinutes * 60_000
          return sameEvent && event.status !== 'expired' && inCooldown
        })
    )
    .map((item): WatchEvent => ({
      ...item,
      id: `${item.fingerprint}:${item.occurredAt}`,
      status: 'active'
    }))
  return [...additions, ...active].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt)
  )
}

export function acknowledgeWatchEvent(
  events: readonly WatchEvent[],
  eventId: string
): WatchEvent[] {
  return events.map((event) =>
    event.id === eventId && event.status === 'active'
      ? { ...event, status: 'acknowledged' as const }
      : event
  )
}

export function pruneWatchEvents(
  events: readonly WatchEvent[],
  maxPerQuote: number,
  now: string
): WatchEvent[] {
  const cutoff = new Date(now).getTime() - 30 * 24 * 60 * 60_000
  const counts = new Map<string, number>()
  return [...events]
    .filter((event) => event.status !== 'expired' || new Date(event.expiresAt).getTime() >= cutoff)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .filter((event) => {
      const count = counts.get(event.quoteId) ?? 0
      if (count >= maxPerQuote) return false
      counts.set(event.quoteId, count + 1)
      return true
    })
}
