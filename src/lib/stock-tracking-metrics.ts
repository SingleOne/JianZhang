import type { KlineBar, StockTrackingMetricSnapshot, StockTrackingProfile } from '../shared/types'

export const STOCK_TRACKING_VOLUME_RATIO_METRICS = {
  5: 'volumeRatio5d',
  10: 'volumeRatio10d',
  20: 'volumeRatio20d'
} as const

export type StockTrackingVolumeRatioPeriod = keyof typeof STOCK_TRACKING_VOLUME_RATIO_METRICS

const VOLUME_RATIO_PERIODS = Object.keys(STOCK_TRACKING_VOLUME_RATIO_METRICS).map(
  Number
) as StockTrackingVolumeRatioPeriod[]

function dateKey(value: string): string {
  return value.slice(0, 10)
}

export function calculateStockTrackingVolumeRatios(
  bars: readonly KlineBar[],
  startedAt: string,
  stoppedAt?: string,
  capturedAt = new Date().toISOString()
): StockTrackingMetricSnapshot[] {
  const orderedBars = [...bars].sort((left, right) => left.time.localeCompare(right.time))
  const startedDate = dateKey(startedAt)
  const stoppedDate = stoppedAt ? dateKey(stoppedAt) : null
  const snapshots: StockTrackingMetricSnapshot[] = []

  for (let index = 20; index < orderedBars.length; index += 1) {
    const current = orderedBars[index]
    const tradingDate = dateKey(current.time)
    if (tradingDate < startedDate || (stoppedDate && tradingDate > stoppedDate)) continue
    if (current.volume < 0) continue

    const metrics: Record<string, number> = {}
    for (const period of VOLUME_RATIO_PERIODS) {
      const previousBars = orderedBars.slice(index - period, index)
      const averageVolume =
        previousBars.reduce((total, bar) => total + bar.volume, 0) / previousBars.length
      if (averageVolume > 0) {
        metrics[STOCK_TRACKING_VOLUME_RATIO_METRICS[period]] = current.volume / averageVolume
      }
    }
    if (Object.keys(metrics).length > 0) snapshots.push({ tradingDate, capturedAt, metrics })
  }

  return snapshots
}

function sameMetrics(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left)
  const rightKeys = Object.keys(right)
  return (
    leftEntries.length === rightKeys.length &&
    leftEntries.every(([metricId, value]) => right[metricId] === value)
  )
}

export function mergeStockTrackingMetricSnapshots(
  profile: StockTrackingProfile,
  incoming: readonly StockTrackingMetricSnapshot[]
): StockTrackingProfile {
  if (incoming.length === 0) return profile
  const byDate = new Map(
    profile.metricSnapshots.map((snapshot) => [snapshot.tradingDate, snapshot])
  )
  let changed = false

  for (const snapshot of incoming) {
    const current = byDate.get(snapshot.tradingDate)
    const metrics = { ...current?.metrics, ...snapshot.metrics }
    if (current && sameMetrics(current.metrics, metrics)) continue
    byDate.set(snapshot.tradingDate, {
      tradingDate: snapshot.tradingDate,
      capturedAt: snapshot.capturedAt,
      metrics
    })
    changed = true
  }

  if (!changed) return profile
  return {
    ...profile,
    metricSnapshots: [...byDate.values()].sort((left, right) =>
      left.tradingDate.localeCompare(right.tradingDate)
    )
  }
}

export function latestStockTrackingMetric(
  snapshots: readonly StockTrackingMetricSnapshot[],
  metricId: string
): number | null {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const value = snapshots[index].metrics[metricId]
    if (value !== undefined) return value
  }
  return null
}
