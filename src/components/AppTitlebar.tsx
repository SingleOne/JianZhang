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
  markets: readonly StockMarket[]
  tradingCalendar: TradingCalendarSettings
}

function marketState(
  date: Date,
  markets: readonly StockMarket[],
  tradingCalendar: TradingCalendarSettings
): { open: boolean; label: string; detail: string } {
  const states = [...new Set(markets)].map((market) => {
    const calendar = tradingCalendar.markets[market]
    const open = isMarketOpen(market, date, calendar)
    const nextOpen = new Date(
      date.getTime() + millisecondsUntilNextMarketOpen(market, date, calendar)
    )
    return {
      market,
      open,
      nextOpenLabel: new Intl.DateTimeFormat('zh-CN', {
        timeZone: STOCK_MARKET_TIME_ZONES[market],
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(nextOpen)
    }
  })
  return {
    open: states.some((state) => state.open),
    label: states
      .map((state) => `${STOCK_MARKET_LABELS[state.market]}${state.open ? '交易中' : '已休市'}`)
      .join(' · '),
    detail: states
      .map((state) =>
        state.open
          ? `${STOCK_MARKET_LABELS[state.market]}正在自动刷新`
          : `${STOCK_MARKET_LABELS[state.market]}下次开市 ${state.nextOpenLabel}`
      )
      .join('；')
  }
}

export function MarketTradingState({ markets, tradingCalendar }: MarketTradingStateProps) {
  const [now, setNow] = useState(() => new Date())
  const market = marketState(now, markets, tradingCalendar)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className={`market-state ${market.open ? 'is-open' : ''}`} title={market.detail}>
      <Activity size={13} />
      <span>{market.label}</span>
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
