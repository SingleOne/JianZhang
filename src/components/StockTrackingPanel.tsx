import { Binoculars, Play } from 'lucide-react'
import { useMemo } from 'react'
import { initialTrackingPrice } from '../lib/stock-tracking'
import type {
  KlineBar,
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  WatchStock
} from '../shared/types'
import { StockTrackingEditor, type StockTrackingPerformance } from './StockTrackingEditor'
import { useStockTrackingMarketData } from './useStockTrackingMarketData'

interface StockTrackingPanelProps {
  stock: WatchStock
  quote?: StockQuote
  profile?: StockTrackingProfile
  onStartTracking: (quoteId: string) => void
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
}

function dateKey(value: string): string {
  return value.replaceAll('-', '').replaceAll('/', '').slice(0, 8)
}

function calculatePerformance(
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

  if (baseline && baseline > 0) {
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

export function StockTrackingPanel({
  stock,
  quote,
  profile,
  onStartTracking,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking
}: StockTrackingPanelProps) {
  const profileQuoteId = profile?.quoteId
  const marketData = useStockTrackingMarketData(profileQuoteId ? stock.quoteId : undefined)

  const performance = useMemo(
    () => (profile ? calculatePerformance(profile, quote, marketData.dailyBars) : undefined),
    [marketData.dailyBars, profile, quote]
  )

  if (!profile) {
    return (
      <div className="stock-tracking-empty" role="tabpanel">
        <Binoculars size={32} />
        <strong>尚未追踪这只股票</strong>
        <span>开始后可以记录来源、标签、选股逻辑和持续复盘内容。</span>
        <button
          className="primary-button"
          type="button"
          onClick={() => onStartTracking(stock.quoteId)}
        >
          <Play size={15} />
          开始追踪
        </button>
      </div>
    )
  }

  return (
    <div className="stock-tracking-tab" role="tabpanel">
      <StockTrackingEditor
        key={`${profile.quoteId}:${profile.updatedAt}`}
        profile={profile}
        quote={quote}
        performance={performance}
        marketData={marketData}
        onUpdateProfile={onUpdateProfile}
        onStopTracking={onStopTracking}
        onRestartTracking={onRestartTracking}
      />
    </div>
  )
}
