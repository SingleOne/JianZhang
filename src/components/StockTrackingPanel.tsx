import { Binoculars, Play } from 'lucide-react'
import { useMemo } from 'react'
import { calculateStockTrackingPerformance } from '../lib/stock-tracking-performance'
import type { MarketCalendarDates } from '../shared/market-calendar'
import type {
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  WatchStock
} from '../shared/types'
import { StockTrackingEditor } from './StockTrackingEditor'
import { useStockTrackingMarketData } from './useStockTrackingMarketData'

interface StockTrackingPanelProps {
  stock: WatchStock
  quote?: StockQuote
  profile?: StockTrackingProfile
  marketCalendar: MarketCalendarDates
  onStartTracking: (quoteId: string) => void
  onUpdateProfile: (profile: StockTrackingProfile) => void
  onStopTracking: (quoteId: string, result: StockTrackingConclusionResult, summary: string) => void
  onRestartTracking: (quoteId: string) => void
}

export function StockTrackingPanel({
  stock,
  quote,
  profile,
  marketCalendar,
  onStartTracking,
  onUpdateProfile,
  onStopTracking,
  onRestartTracking
}: StockTrackingPanelProps) {
  const profileQuoteId = profile?.quoteId
  const marketData = useStockTrackingMarketData(
    profileQuoteId ? stock.quoteId : undefined,
    marketCalendar
  )

  const performance = useMemo(
    () =>
      profile ? calculateStockTrackingPerformance(profile, quote, marketData.dailyBars) : undefined,
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
