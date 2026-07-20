import type { WatchEvent } from '../../shared/types'
import type { WatchEventDraft } from './detect'

export function deduplicateEventDrafts(drafts: readonly WatchEventDraft[]): WatchEventDraft[] {
  const seen = new Set<string>()
  return drafts.filter((draft) => {
    if (seen.has(draft.fingerprint)) return false
    seen.add(draft.fingerprint)
    return true
  })
}

export function hasEventFingerprint(events: readonly WatchEvent[], fingerprint: string): boolean {
  return events.some((event) => event.fingerprint === fingerprint && event.status !== 'expired')
}
