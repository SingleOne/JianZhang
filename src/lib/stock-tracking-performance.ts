import type { KlineBar, StockQuote, StockTrackingProfile } from '../shared/types'
import { initialTrackingPrice } from './stock-tracking'

export interface StockTrackingPerformance {
  trackingReturn: number | null
  maximumGain: number | null
  maximumDrawdown: number | null
  trackingDays: number
}

function dateKey(value: string): string {
  return value.replaceAll('-', '').replaceAll('/', '').slice(0, 8)
}

export function calculateStockTrackingPerformance(
  profile: StockTrackingProfile,
  quote: StockQuote | undefined,
  bars: KlineBar[]
): StockTrackingPerformance {
  const startedKey = dateKey(profile.startedAt)
  const stoppedKey = profile.stoppedAt ? dateKey(profile.stoppedAt) : null
  const trackingBars = bars.filter((bar) => {
    const barKey = dateKey(bar.time)
    return barKey >= startedKey && (!stoppedKey || barKey <= stoppedKey)
  })
  const baseline = initialTrackingPrice(profile) ?? trackingBars[0]?.close ?? null
  const stoppedPrice =
    profile.status === 'stopped'
      ? profile.entries.find((entry) => entry.createdAt === profile.stoppedAt)?.quoteSnapshot
          ?.latest
      : undefined
  const current = stoppedPrice ?? quote?.latest ?? trackingBars.at(-1)?.close ?? null
  let maximumGain: number | null = null
  let maximumDrawdown: number | null = null

  if (baseline && baseline > 0 && trackingBars.length > 0) {
    let peak = baseline
    maximumGain = 0
    maximumDrawdown = 0
    for (const bar of trackingBars) {
      maximumGain = Math.max(maximumGain, (bar.high / baseline - 1) * 100)
      peak = Math.max(peak, bar.high)
      maximumDrawdown = Math.min(maximumDrawdown, (bar.low / peak - 1) * 100)
    }
  }

  return {
    trackingReturn: baseline && current ? (current / baseline - 1) * 100 : null,
    maximumGain,
    maximumDrawdown,
    trackingDays: Math.max(
      1,
      Math.floor(
        ((profile.stoppedAt ? new Date(profile.stoppedAt).getTime() : Date.now()) -
          new Date(profile.startedAt).getTime()) /
          86_400_000
      ) + 1
    )
  }
}
