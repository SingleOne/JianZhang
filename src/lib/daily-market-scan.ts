import type {
  DailyMarketScanRow,
  DailyMarketScanSignalType,
  KlineBar,
  StockQuote
} from '../shared/types'

export const DAILY_MARKET_SCAN_MINIMUM_AMOUNT = 50_000_000
export const DAILY_MARKET_SCAN_KLINE_LIMIT = 21

export function dailyMarketScanBoardLabel(code: string): '创业板' | '科创板' | null {
  if (/^30[01]/.test(code)) return '创业板'
  if (/^68[89]/.test(code)) return '科创板'
  return null
}

function marketLabel(code: string, quoteId: string): string {
  const boardLabel = dailyMarketScanBoardLabel(code)
  if (boardLabel) return boardLabel
  if (quoteId.startsWith('1.')) return '沪A'
  if (/^(4|8|92)/.test(code)) return '北A'
  return '深A'
}

function percentageReturn(current: number, previous: number): number {
  return previous === 0 ? 0 : (current / previous - 1) * 100
}

export function createDailyMarketScanRow(
  quote: StockQuote,
  bars: readonly KlineBar[]
): DailyMarketScanRow | null {
  if (
    quote.latest === null ||
    quote.changePercent === null ||
    quote.amount === null ||
    quote.volume === null
  ) {
    return null
  }

  const orderedBars = [...bars].sort((left, right) => left.time.localeCompare(right.time))
  if (orderedBars.length < DAILY_MARKET_SCAN_KLINE_LIMIT) return null

  const recentBars = orderedBars.slice(-DAILY_MARKET_SCAN_KLINE_LIMIT)
  const todayBar = recentBars.at(-1)!
  const previous20Bars = recentBars.slice(0, -1)
  const averageVolume20d =
    previous20Bars.reduce((total, bar) => total + bar.volume, 0) / previous20Bars.length
  if (averageVolume20d <= 0) return null

  const volumeRatio = quote.volume / averageVolume20d
  const previousHigh = Math.max(...previous20Bars.map((bar) => bar.high))
  const previousLow = Math.min(...previous20Bars.map((bar) => bar.low))
  const breakoutPercent =
    todayBar.close > previousHigh ? percentageReturn(todayBar.close, previousHigh) : null
  const breakdownPercent =
    todayBar.close < previousLow ? percentageReturn(todayBar.close, previousLow) : null

  const closes = recentBars.map((bar) => bar.close)
  const returns = closes.slice(1).map((close, index) => percentageReturn(close, closes[index]))
  const previousFiveReturns = returns.slice(-6, -1)
  const previousFiveDayReturn = previousFiveReturns.reduce((total, value) => total + value, 0)
  const declineDays = previousFiveReturns.filter((value) => value < 0).length
  const todayReturn = returns.at(-1) ?? 0

  const signals: DailyMarketScanSignalType[] = []
  if (volumeRatio > 2.5) signals.push('volumeSurge')
  if (quote.changePercent > 5 && quote.changePercent < 9.5 && volumeRatio > 1.5) {
    signals.push('strongGain')
  }
  if (quote.changePercent < -5 && quote.changePercent > -9.5 && volumeRatio > 1.5) {
    signals.push('strongLoss')
  }
  if (breakoutPercent !== null) signals.push('breakout20d')
  if (breakdownPercent !== null) signals.push('breakdown20d')
  if (declineDays >= 4 && previousFiveDayReturn < -5 && todayReturn > 1) {
    signals.push('reversal')
  }

  if (signals.length === 0) return null
  return {
    code: quote.code,
    name: quote.name,
    quoteId: quote.quoteId,
    marketLabel: marketLabel(quote.code, quote.quoteId),
    tradingDate: todayBar.time.slice(0, 10),
    latest: quote.latest,
    changePercent: quote.changePercent,
    amount: quote.amount,
    volume: quote.volume,
    averageVolume20d,
    volumeRatio,
    breakoutPercent,
    breakdownPercent,
    previousFiveDayReturn,
    declineDays,
    signals
  }
}

export function dailyMarketScanTradingDate(rows: readonly DailyMarketScanRow[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.tradingDate, (counts.get(row.tradingDate) ?? 0) + 1)
  return (
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))
      .at(0)?.[0] ?? ''
  )
}
