import { Activity } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { isMarketOpen } from '../shared/market-hours'
import { STOCK_MARKET_LABELS, type StockMarket } from '../shared/stock-market'

interface AppTitlebarProps {
  children?: ReactNode
  markets: readonly StockMarket[]
  tradingCalendarClosedDates: readonly string[]
}

function marketState(
  date: Date,
  markets: readonly StockMarket[],
  tradingCalendarClosedDates: readonly string[]
): { open: boolean; label: string } {
  const states = [...new Set(markets)].map((market) => ({
    market,
    open: isMarketOpen(market, date, market === 'CN' ? tradingCalendarClosedDates : [])
  }))
  return {
    open: states.some((state) => state.open),
    label: states
      .map((state) => `${STOCK_MARKET_LABELS[state.market]}${state.open ? '交易中' : '已休市'}`)
      .join(' · ')
  }
}

export function AppTitlebar({ children, markets, tradingCalendarClosedDates }: AppTitlebarProps) {
  const [now, setNow] = useState(() => new Date())
  const market = marketState(now, markets, tradingCalendarClosedDates)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="titlebar">
      <div className={`brand-mark is-${__JIANZHANG_ICON_VARIANT__}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M4 17.5 9 13l3 2.5L19.5 7" />
          <path d="M15.5 7h4v4" />
        </svg>
      </div>
      <div className="brand-name">见涨</div>
      <div className={`market-state ${market.open ? 'is-open' : ''}`}>
        <Activity size={13} />
        <span>{market.label}</span>
      </div>
      {children ? <div className="titlebar-command-slot">{children}</div> : null}
    </header>
  )
}
