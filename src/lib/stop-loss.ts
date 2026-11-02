import { stockApi } from './api'
import type { StopLossSnapshot } from '../shared/stop-loss'

/** Subscribe before reading so the initial request cannot overwrite a newer event. */
export function subscribeStopLoss(
  callback: (snapshots: StopLossSnapshot[]) => void,
  onError?: (reason: unknown) => void
): () => void {
  let active = true
  let receivedUpdate = false
  const unsubscribe = stockApi.onStopLossUpdated((snapshots) => {
    receivedUpdate = true
    if (active) callback(snapshots)
  })
  void stockApi
    .getStopLossSnapshots()
    .then((snapshots) => {
      if (active && !receivedUpdate) callback(snapshots)
    })
    .catch((reason) => {
      if (active) onError?.(reason)
    })
  return () => {
    active = false
    unsubscribe()
  }
}
