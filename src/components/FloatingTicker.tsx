import { Pin, PinOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import { formatPercent, formatPrice } from '../lib/format'
import { getMenuBarQuoteStatus } from '../lib/menu-bar'
import { STOCK_QUOTE_DATA_STATE_LABELS } from '../lib/quote-state'
import { getTriggeredStockAlertDirection } from '../lib/stock-alerts'
import { getTraySummaryStocks } from '../lib/tray-summary'
import { applyAppThemePreference } from '../lib/theme'
import type { AppState, FloatingTickerPreferences, StockQuote } from '../shared/types'
import { AppButton } from './AppButton'
import { FiveLevelAlertBadges } from './FiveLevelAlertBadges'
import { TAlertBadges } from './TAlertBadges'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'

function directionClass(value: number | null | undefined): string {
  return value ? (value > 0 ? 'is-up' : 'is-down') : 'is-flat'
}

export function FloatingTicker() {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [, setStatusTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    applyAppThemePreference(state.settings.theme)
  }, [state.settings.theme])

  useEffect(() => {
    let active = true
    let receivedState = false
    let receivedQuotes = false
    const unsubscribeState = stockApi.onStateUpdated((next) => {
      receivedState = true
      setState(next)
    })
    const unsubscribeQuotes = stockApi.onQuotesUpdated((next) => {
      receivedQuotes = true
      setQuotes(next)
    })
    void getInitialBootstrap()
      .then((bootstrap) => {
        if (!active) return
        if (!receivedState) setState(bootstrap.state)
        if (!receivedQuotes) setQuotes(bootstrap.quotes)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setLoading(false)
        setError('行情读取失败，请从菜单栏刷新')
      })
    const timer = window.setInterval(() => setStatusTick((tick) => tick + 1), 30_000)
    return () => {
      active = false
      unsubscribeState()
      unsubscribeQuotes()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const content = contentRef.current!
    const observer = new ResizeObserver(() => {
      void stockApi.resizeFloatingTicker(Math.ceil(content.getBoundingClientRect().height))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const stocks = useMemo(() => getTraySummaryStocks(state, quotes), [state, quotes])
  const updatePreferences = async (preferences: Partial<FloatingTickerPreferences>) => {
    setSaving(true)
    setError('')
    try {
      await stockApi.updateFloatingTickerPreferences(preferences)
    } catch {
      setError('浮窗设置保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="floating-ticker-panel" ref={contentRef} aria-label="独立行情浮窗">
      <header className="floating-ticker-header">
        <span>见涨 · 行情浮窗</span>
        <div>
          <AppButton
            variant="plain"
            disabled={saving || loading}
            aria-label="窗口置顶"
            aria-pressed={state.settings.floatingTickerAlwaysOnTop}
            title={state.settings.floatingTickerAlwaysOnTop ? '取消置顶' : '窗口置顶'}
            onClick={() =>
              void updatePreferences({
                floatingTickerAlwaysOnTop: !state.settings.floatingTickerAlwaysOnTop
              })
            }
          >
            {state.settings.floatingTickerAlwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </AppButton>
          <AppButton
            variant="plain"
            disabled={saving}
            aria-label="关闭行情浮窗"
            title="关闭行情浮窗"
            onClick={() => void updatePreferences({ showFloatingTicker: false })}
          >
            <X size={15} />
          </AppButton>
        </div>
      </header>
      {loading || stocks.length === 0 ? (
        <div className="floating-ticker-empty">
          <p>{loading ? '正在读取行情…' : '请在自选列表中选择菜单栏展示股票'}</p>
          <AppButton variant="plain" onClick={() => void stockApi.showMainWindow()}>
            打开见涨
          </AppButton>
        </div>
      ) : (
        <div className="floating-ticker-list">
          {stocks.map(
            ({ stock, quote, alertBadges, floatingAlerts, tSummaries, positionMetrics }) => (
              <AppButton
                key={stock.quoteId}
                variant="plain"
                className={`floating-ticker-quote ${directionClass(quote?.changePercent)}`}
                onClick={() => void stockApi.showMainWindow(stock.quoteId)}
                title={`打开 ${stock.name}`}
              >
                <span className="floating-ticker-quote-main">
                  <strong className="floating-ticker-name">{stock.name}</strong>
                  <b>{formatPrice(quote?.latest)}</b>
                  <b>{formatPercent(quote?.changePercent)}</b>
                </span>
                <span className="floating-ticker-quote-meta">
                  <span>
                    {stock.code} ·{' '}
                    {STOCK_QUOTE_DATA_STATE_LABELS[getMenuBarQuoteStatus(state, quote)]}
                  </span>
                  <FiveLevelAlertBadges
                    alerts={tSummaries.length ? quote?.fiveLevelLargeOrders : undefined}
                  />
                  <TAlertBadges badges={alertBadges} />
                  {floatingAlerts.map((summary) => (
                    <TFloatingProfitAlertBadge
                      key={summary.account.accountId}
                      batch={summary.batch}
                      accountName={summary.account.accountName}
                      floatingProfit={summary.metrics.floatingProfit}
                      currency={positionMetrics.currency}
                    />
                  ))}
                  {getTriggeredStockAlertDirection(stock.alertRules) ? (
                    <span className="floating-ticker-alert">股价提醒</span>
                  ) : null}
                </span>
              </AppButton>
            )
          )}
        </div>
      )}
      {error ? (
        <p className="floating-ticker-error" role="status">
          {error}
        </p>
      ) : null}
    </section>
  )
}
