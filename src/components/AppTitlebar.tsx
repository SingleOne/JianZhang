import { Activity } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { isMarketOpen, millisecondsUntilNextMarketOpen } from '../shared/market-hours'
import {
  STOCK_MARKET_LABELS,
  STOCK_MARKET_TIME_ZONES,
  type StockMarket
} from '../shared/stock-market'
import type { TradingCalendarSettings } from '../shared/types'

interface AppTitlebarProps {
  children?: ReactNode
}

interface MarketTradingStateProps {
  tradingCalendar: TradingCalendarSettings
}

function marketState(
  date: Date,
  market: StockMarket,
  tradingCalendar: TradingCalendarSettings
): { market: StockMarket; open: boolean; label: string; detail: string } {
  const calendar = tradingCalendar.markets[market]
  const open = isMarketOpen(market, date, calendar)
  const nextOpen = new Date(
    date.getTime() + millisecondsUntilNextMarketOpen(market, date, calendar)
  )
  const nextOpenLabel = new Intl.DateTimeFormat('zh-CN', {
    timeZone: STOCK_MARKET_TIME_ZONES[market],
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(nextOpen)
  return {
    market,
    open,
    label: `${STOCK_MARKET_LABELS[market]}${open ? '交易中' : '已休市'}`,
    detail: open
      ? `${STOCK_MARKET_LABELS[market]}正在自动刷新`
      : `${STOCK_MARKET_LABELS[market]}下次开市 ${nextOpenLabel}`
  }
}

const STATUS_MARKETS = ['CN', 'HK', 'US'] as const

export function MarketTradingState({ tradingCalendar }: MarketTradingStateProps) {
  const [now, setNow] = useState(() => new Date())
  const markets = STATUS_MARKETS.map((market) => marketState(now, market, tradingCalendar))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="market-state-list" aria-label="市场交易状态">
      {markets.map((market) => (
        <div
          className={`market-state ${market.open ? 'is-open' : ''}`}
          title={market.detail}
          key={market.market}
        >
          <Activity size={13} />
          <span>{market.label}</span>
        </div>
      ))}
    </div>
  )
}

export function AppTitlebar({ children }: AppTitlebarProps) {
  return (
    <header className="titlebar">
      <div className={`brand-mark is-${__JIANZHANG_ICON_VARIANT__}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M4 17.5 9 13l3 2.5L19.5 7" />
          <path d="M15.5 7h4v4" />
        </svg>
      </div>
      <div className="brand-name">见涨</div>
      {children ? <div className="titlebar-command-slot">{children}</div> : null}
    </header>
  )
}
