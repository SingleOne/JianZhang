import { useCallback, useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import type {
  FundamentalPeerComparison,
  FundamentalScreeningEvaluation
} from '../lib/fundamental-screening'
import {
  createStockTrackingSource,
  startStockTracking,
  stopStockTracking
} from '../lib/stock-tracking'
import { stockMarketIdentity } from '../shared/stock-market'
import type {
  CorporateActionRecord,
  CorporateActionRecords,
  DailyKlineIndicator,
  DailyMarketScanRow,
  DividendFinancingRankingItem,
  ExchangeRateSettings,
  StockPosition,
  StockQuote,
  StockTrackingConclusionResult,
  StockTrackingProfile,
  TTradingAccount,
  TradingCalendarSettings,
  WatchStock
} from '../shared/types'
import { ExpandedStockDetails } from './ExpandedStockDetails'

interface DailyMarketScanStockDetailsProps {
  row: DailyMarketScanRow
  generatedAt: string
  dividendFinancing?: DividendFinancingRankingItem
  dividendFinancingSnapshotDate?: string
  fundamentalScreening?: FundamentalScreeningEvaluation
  fundamentalPeerComparison?: FundamentalPeerComparison
  fundamentalSnapshotDate?: string
  fundamentalGeneratedAt?: string
  fundamentalStaleReason?: string | null
  refreshSeconds: number
  initialChipDistributionEnabled: boolean
  initialBollingerBandsEnabled: boolean
  initialDailyKlineIndicator: DailyKlineIndicator
  tradingCalendar: TradingCalendarSettings
  exchangeRates: ExchangeRateSettings
}

function quoteFromScanRow(row: DailyMarketScanRow, generatedAt: string): StockQuote {
  const ratio = 1 + row.changePercent / 100
  const previousClose = ratio > 0 ? row.latest / ratio : null
  return {
    code: row.code,
    name: row.name,
    quoteId: row.quoteId,
    ...stockMarketIdentity(row.quoteId),
    latest: row.latest,
    change: previousClose === null ? null : row.latest - previousClose,
    changePercent: row.changePercent,
    open: null,
    high: null,
    low: null,
    previousClose,
    volume: row.volume,
    amount: row.amount,
    turnoverRate: row.turnoverRate ?? null,
    updatedAt: generatedAt,
    dataAt: generatedAt
  }
}

export function DailyMarketScanStockDetails({
  row,
  generatedAt,
  dividendFinancing,
  dividendFinancingSnapshotDate,
  fundamentalScreening,
  fundamentalPeerComparison,
  fundamentalSnapshotDate,
  fundamentalGeneratedAt,
  fundamentalStaleReason,
  refreshSeconds,
  initialChipDistributionEnabled,
  initialBollingerBandsEnabled,
  initialDailyKlineIndicator,
  tradingCalendar,
  exchangeRates
}: DailyMarketScanStockDetailsProps) {
  const initialStock = useMemo<WatchStock>(
    () => ({
      code: row.code,
      name: row.name,
      quoteId: row.quoteId,
      marketLabel: row.marketLabel,
      ...stockMarketIdentity(row.quoteId),
      showInTaskbar: false,
      isPriority: false,
      showRadarSignals: true
    }),
    [row.code, row.marketLabel, row.name, row.quoteId]
  )
  const [stock, setStock] = useState(initialStock)
  const [quote, setQuote] = useState<StockQuote>(() => quoteFromScanRow(row, generatedAt))
  const [tradingAccount, setTradingAccount] = useState<TTradingAccount>()
  const [corporateActionRecords, setCorporateActionRecords] = useState<CorporateActionRecords>({})
  const [trackingProfile, setTrackingProfile] = useState<StockTrackingProfile>()
  const [chipDistributionEnabled, setChipDistributionEnabled] = useState(
    initialChipDistributionEnabled
  )
  const [bollingerBandsEnabled, setBollingerBandsEnabled] = useState(initialBollingerBandsEnabled)
  const [dailyKlineIndicator, setDailyKlineIndicator] = useState(initialDailyKlineIndicator)

  useEffect(() => {
    let active = true
    void stockApi
      .refreshQuote(row.quoteId)
      .then((quotes) => {
        const refreshed = quotes.find((item) => item.quoteId === row.quoteId)
        if (active && refreshed) setQuote(refreshed)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [row.quoteId])

  const startTracking = useCallback(() => {
    setTrackingProfile((current) =>
      startStockTracking(
        current,
        stock,
        createStockTrackingSource('dailyScan', {
          tradingDate: row.tradingDate,
          signals: row.signals,
          startPrice: quote.latest ?? undefined,
          changePercent: row.changePercent,
          volumeRatio: row.volumeRatio
        }),
        quote
      )
    )
  }, [quote, row.changePercent, row.signals, row.tradingDate, row.volumeRatio, stock])

  const stopTracking = useCallback(
    (_quoteId: string, result: StockTrackingConclusionResult, summary: string) => {
      setTrackingProfile((current) =>
        current ? stopStockTracking(current, result, summary, quote) : current
      )
    },
    [quote]
  )

  const applyCorporateAction = useCallback(
    (
      account: TTradingAccount,
      position: StockPosition | undefined,
      record: CorporateActionRecord
    ) => {
      setTradingAccount(account)
      setStock((current) => ({ ...current, position }))
      setCorporateActionRecords((current) => ({ ...current, [record.id]: record }))
    },
    []
  )

  const updateCorporateActionRecord = useCallback((record: CorporateActionRecord) => {
    setCorporateActionRecords((current) => ({ ...current, [record.id]: record }))
  }, [])

  return (
    <div className="daily-scan-temporary-details">
      <div className="daily-scan-temporary-note">临时查看：此处产生的状态不会写入主表或保存。</div>
      <ExpandedStockDetails
        stock={stock}
        cacheScope="daily-scan"
        quote={quote}
        dividendFinancing={dividendFinancing}
        dividendFinancingSnapshotDate={dividendFinancingSnapshotDate}
        fundamentalScreening={fundamentalScreening}
        fundamentalPeerComparison={fundamentalPeerComparison}
        fundamentalSnapshotDate={fundamentalSnapshotDate}
        fundamentalGeneratedAt={fundamentalGeneratedAt}
        fundamentalStaleReason={fundamentalStaleReason}
        detailNavigationRequest={null}
        onDetailNavigationHandled={() => undefined}
        refreshSeconds={refreshSeconds}
        autoRefreshOrderBook={false}
        chipDistributionEnabled={chipDistributionEnabled}
        bollingerBandsEnabled={bollingerBandsEnabled}
        dailyKlineIndicator={dailyKlineIndicator}
        tradingCalendar={tradingCalendar}
        exchangeRates={exchangeRates}
        tradingAccount={tradingAccount}
        corporateActionRecords={corporateActionRecords}
        onApplyCorporateAction={applyCorporateAction}
        onUpdateCorporateActionRecord={updateCorporateActionRecord}
        trackingProfile={trackingProfile}
        onStartTracking={startTracking}
        onUpdateTracking={setTrackingProfile}
        onStopTracking={stopTracking}
        onRestartTracking={startTracking}
        onChipDistributionEnabledChange={setChipDistributionEnabled}
        onBollingerBandsEnabledChange={setBollingerBandsEnabled}
        onDailyKlineIndicatorChange={setDailyKlineIndicator}
      />
    </div>
  )
}
