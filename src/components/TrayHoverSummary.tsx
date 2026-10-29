import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { getInitialBootstrap, initialState, stockApi } from '../lib/api'
import {
  formatCost,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatSigned,
  formatShares
} from '../lib/format'
import { getTraySummaryStocks, getTrayTodayProfitTotal } from '../lib/tray-summary'
import { getMenuBarQuoteStatus } from '../lib/menu-bar'
import { applyAppThemePreference } from '../lib/theme'
import { observeContentHeight } from '../lib/observe-content-height'
import { createMenuBarDisclosureAnimator } from '../lib/menu-bar-disclosure-animation'
import type { AppState, StockQuote } from '../shared/types'
import { AppButton } from './AppButton'
import { MenuBarStockRow } from './MenuBarStockRow'
import { StockQuoteDetails } from './TaskbarStockTooltip'

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function TrayHoverSummary({ interactive = false }: { interactive?: boolean }) {
  const [state, setState] = useState<AppState>(initialState)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null)
  const [, setStatusTick] = useState(0)
  const panelRef = useRef<HTMLElement>(null)
  const disclosureAnimator = useRef<ReturnType<typeof createMenuBarDisclosureAnimator> | null>(null)

  useEffect(() => {
    applyAppThemePreference(state.settings.theme)
  }, [state.settings.theme])

  useEffect(() => {
    if (!interactive) return
    setExpandedQuoteId((current) =>
      state.watchlist.some((stock) => stock.quoteId === current && stock.showInTaskbar)
        ? current
        : null
    )
  }, [interactive, state.watchlist])

  useEffect(() => {
    let active = true
    let receivedQuotes = false
    let receivedState = false
    const unsubscribeQuotes = stockApi.onQuotesUpdated((nextQuotes) => {
      receivedQuotes = true
      setQuotes(nextQuotes)
    })
    const unsubscribeState = stockApi.onStateUpdated((nextState) => {
      receivedState = true
      setState(nextState)
    })

    void getInitialBootstrap()
      .then((bootstrap) => {
        if (!active) return
        if (!receivedState) setState(bootstrap.state)
        if (!receivedQuotes) setQuotes(bootstrap.quotes)
        setLoading(false)
      })
      .catch(() => {
        if (active) {
          setLoading(false)
          setError('行情读取失败，请重新刷新')
        }
      })

    return () => {
      active = false
      unsubscribeQuotes()
      unsubscribeState()
    }
  }, [])

  useLayoutEffect(() => {
    if (!interactive || !panelRef.current) return
    const animator = createMenuBarDisclosureAnimator(panelRef.current)
    disclosureAnimator.current = animator
    const stopObserving = observeContentHeight(panelRef.current, (height) => {
      void stockApi.resizeMenuBarPanel(height)
    })
    return () => {
      stopObserving()
      animator.cancel()
      disclosureAnimator.current = null
    }
  }, [interactive])

  useEffect(() => {
    if (!interactive) return
    const resetExpandedStock = () => {
      if (document.hidden) {
        disclosureAnimator.current?.cancel()
        setExpandedQuoteId(null)
      }
    }
    document.addEventListener('visibilitychange', resetExpandedStock)
    const timer = window.setInterval(() => setStatusTick((tick) => tick + 1), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', resetExpandedStock)
      window.clearInterval(timer)
    }
  }, [interactive])

  const selectedStocks = useMemo(() => getTraySummaryStocks(state, quotes), [state, quotes])
  const todayProfitTotal = getTrayTodayProfitTotal(selectedStocks)

  const toggleStock = (quoteId: string) => {
    const update = () =>
      flushSync(() => {
        setExpandedQuoteId((current) => (current === quoteId ? null : quoteId))
      })
    if (disclosureAnimator.current) disclosureAnimator.current.transition(update)
    else update()
  }

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      const bootstrap = await stockApi.getBootstrap()
      setState(bootstrap.state)
      setQuotes(await stockApi.refreshQuotes())
    } catch {
      setError('刷新失败，当前显示上次行情')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside ref={panelRef} className={`tray-summary-panel${interactive ? ' is-interactive' : ''}`}>
      <header>
        <span>{interactive ? '行情概览' : '今日收益与 T 仓概览'}</span>
        <span
          className="tray-summary-total"
          title={interactive ? '所选股票今日收益合计（人民币）' : undefined}
        >
          {interactive ? '今日合计' : '今日收益合计'}
          <b className={valueClass(todayProfitTotal)}>
            {formatMoneyProfit(todayProfitTotal, 'CNY')}
          </b>
        </span>
      </header>
      {interactive && !state.settings.showTaskbarTicker ? (
        <p className="menu-bar-hint">菜单栏文字行情已关闭，仍可在此查看所选股票。</p>
      ) : null}
      {interactive && (loading || selectedStocks.length === 0) ? (
        <p className="menu-bar-empty">
          {loading ? '正在读取行情…' : '在自选列表的操作列中，选择要在菜单栏展示的股票。'}
        </p>
      ) : null}
      <div className="tray-summary-list">
        {selectedStocks.map((summary) => {
          const { stock, quote, positionMetrics, tSummaries } = summary
          if (interactive) {
            return (
              <MenuBarStockRow
                key={stock.quoteId}
                summary={summary}
                status={getMenuBarQuoteStatus(state, quote)}
                expanded={expandedQuoteId === stock.quoteId}
                onToggle={() => toggleStock(stock.quoteId)}
              >
                {expandedQuoteId === stock.quoteId ? (
                  <StockQuoteDetails
                    key={stock.quoteId}
                    quoteId={stock.quoteId}
                    state={state}
                    quotes={quotes}
                    embedded
                  />
                ) : null}
              </MenuBarStockRow>
            )
          }
          const hasPosition = (stock.position?.quantity ?? 0) > 0
          const displayedTotalProfit = hasPosition
            ? positionMetrics.totalProfit
            : state.portfolioPerformanceCache?.cumulativeProfitByQuoteId[stock.quoteId]
          const displayedProfitCurrency = hasPosition ? positionMetrics.currency : 'CNY'
          return (
            <section className="tray-summary-item" key={stock.quoteId}>
              <div className="tray-summary-heading">
                <div className="tray-summary-stock">
                  <strong>{stock.name}</strong>
                  <b className={valueClass(quote?.change)}>
                    {formatPrice(quote?.latest)}（{formatSigned(quote?.change)}）
                  </b>
                </div>
                <span>
                  今日
                  <b className={valueClass(positionMetrics.todayProfit)}>
                    {formatMoneyProfit(positionMetrics.todayProfit, positionMetrics.currency)}
                  </b>
                  <b className={valueClass(positionMetrics.todayProfitPercent)}>
                    {formatPercent(positionMetrics.todayProfitPercent)}
                  </b>
                </span>
              </div>
              <div className="tray-summary-profit">
                <span>
                  持仓 <b>{formatMoney(positionMetrics.marketValue, positionMetrics.currency)}</b>
                </span>
                <span>
                  {hasPosition ? null : '累计收益'}
                  <b className={valueClass(displayedTotalProfit)}>
                    {formatMoneyProfit(displayedTotalProfit, displayedProfitCurrency)}
                  </b>
                  {hasPosition ? (
                    <b className={valueClass(positionMetrics.profitPercent)}>
                      {formatPercent(positionMetrics.profitPercent)}
                    </b>
                  ) : null}
                </span>
              </div>
              {tSummaries.length ? (
                tSummaries.map(({ account: owner, metrics: tMetrics }) => (
                  <div className="tray-summary-t" key={owner.accountId}>
                    <span>
                      {tMetrics.direction === 'reverse' ? '反T' : '正T'}{' '}
                      {formatShares(tMetrics.remainingQuantity)}
                    </span>
                    <span>
                      {tMetrics.direction === 'reverse' ? '基准' : '成本'}{' '}
                      {formatCost(tMetrics.averageCost)}
                    </span>
                    <span className={valueClass(tMetrics.floatingProfit)}>
                      浮动 {formatMoneyProfit(tMetrics.floatingProfit, positionMetrics.currency)}
                      {tMetrics.floatingProfitRate === null ? null : (
                        <small className="tray-summary-floating-rate">
                          ({formatPercent(tMetrics.floatingProfitRate)})
                        </small>
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className="tray-summary-t is-empty">暂无进行中的 T 仓</div>
              )}
            </section>
          )
        })}
      </div>
      {interactive ? (
        <footer className="menu-bar-footer">
          {error ? (
            <span role="status" className="menu-bar-error">
              {error}
            </span>
          ) : null}
          <div>
            <AppButton variant="plain" onClick={() => void stockApi.showMainWindow()}>
              打开见涨
            </AppButton>
            <AppButton variant="plain" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? '刷新中…' : '立即刷新'}
            </AppButton>
            <AppButton variant="plain" onClick={() => void stockApi.closeMenuBarPanel()}>
              收起
            </AppButton>
          </div>
        </footer>
      ) : null}
    </aside>
  )
}
