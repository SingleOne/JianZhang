import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatUpdateTime } from '../lib/format'

function marketState(date: Date): { open: boolean; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  const weekday = part('weekday')
  const minutes = Number(part('hour')) * 60 + Number(part('minute'))
  const weekdayOpen = weekday !== 'Sat' && weekday !== 'Sun'
  const sessionOpen = (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900)
  const open = weekdayOpen && sessionOpen
  return { open, label: open ? 'A股交易中' : 'A股已休市' }
}

interface AppTitlebarProps {
  lastUpdated?: string
}

export function AppTitlebar({ lastUpdated }: AppTitlebarProps) {
  const [now, setNow] = useState(() => new Date())
  const market = marketState(now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="titlebar">
      <div className="brand-mark" aria-hidden="true">
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
      <div className="titlebar-spacer" />
      <div className="titlebar-update">更新于 {formatUpdateTime(lastUpdated)}</div>
    </header>
  )
}
