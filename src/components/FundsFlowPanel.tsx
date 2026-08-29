import { AlertCircle, RefreshCw, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatSignedAmount } from '../lib/format'
import {
  FUNDS_FLOW_REFRESH_MILLISECONDS,
  isBeijingAutoRefreshTime,
  millisecondsUntilNextAutoRefreshWindow
} from '../shared/market-hours'
import type { FundsFlowResult, WatchStock } from '../shared/types'

const FundsFlowChart = lazy(() => import('./FundsFlowChart'))

interface FundsFlowCacheEntry {
  data: FundsFlowResult
  cachedAt: number
}

const fundsFlowCache = new Map<string, FundsFlowCacheEntry>()

interface FundsFlowPanelProps {
  stock: WatchStock
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

export function FundsFlowPanel({ stock }: FundsFlowPanelProps) {
  const [data, setData] = useState<FundsFlowResult | null>(
    () => fundsFlowCache.get(stock.quoteId)?.data ?? null
  )
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const cached = fundsFlowCache.get(stock.quoteId)
    const refreshMilliseconds = FUNDS_FLOW_REFRESH_MILLISECONDS
    let refreshTimer: number | undefined
    let active = true

    const scheduleRefresh = () => {
      refreshTimer = window.setTimeout(
        () => {
          if (isBeijingAutoRefreshTime()) {
            setRefreshVersion((current) => current + 1)
          } else {
            scheduleRefresh()
          }
        },
        isBeijingAutoRefreshTime() ? refreshMilliseconds : millisecondsUntilNextAutoRefreshWindow()
      )
    }

    if (refreshVersion === 0 && cached && Date.now() - cached.cachedAt < refreshMilliseconds) {
      setData(cached.data)
      setError('')
      setLoading(false)
      scheduleRefresh()
      return () => window.clearTimeout(refreshTimer)
    }

    if (!cached) setLoading(true)
    setError('')
    stockApi
      .getFundsFlow(stock.quoteId)
      .then((result) => {
        if (!active) return
        fundsFlowCache.set(stock.quoteId, { data: result, cachedAt: Date.now() })
        setData(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '资金流向加载失败')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
        scheduleRefresh()
      })

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
    }
  }, [refreshVersion, stock.quoteId])

  const latest = data?.points.at(-1)
  const summary = [
    ['主力净额', latest?.main],
    ['超大单净额', latest?.superLarge],
    ['大单净额', latest?.large],
    ['中单净额', latest?.medium],
    ['小单净额', latest?.small]
  ] as const
  const recentPoints = data?.points.slice(-8).reverse() ?? []

  if (loading && !data) {
    return (
      <div className="chart-loading">
        <TrendingUp size={28} />
        <span>正在加载资金流向…</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="chart-error">
        <AlertCircle size={18} />
        <span>{error}</span>
        <button
          className="secondary-button chart-retry-button"
          type="button"
          onClick={() => setRefreshVersion((current) => current + 1)}
        >
          <RefreshCw size={14} />
          重新获取
        </button>
      </div>
    )
  }

  return (
    <div className="funds-flow-panel">
      {error && data ? (
        <div className="funds-flow-warning">
          <AlertCircle size={14} />
          <span>资金流刷新失败，当前显示最近一次数据</span>
          <button type="button" onClick={() => setRefreshVersion((current) => current + 1)}>
            重试
          </button>
        </div>
      ) : null}
      <div className="funds-flow-heading">
        <div>
          <strong>当日资金流向</strong>
          <span>{data?.tradingDate || '最近交易日'} · 分钟累计净额</span>
        </div>
        <span className="funds-flow-legend">主力资金净额</span>
      </div>
      <div className="funds-flow-summary">
        {summary.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong className={valueClass(value)}>{formatSignedAmount(value)}</strong>
          </div>
        ))}
      </div>
      {data && data.points.length > 0 ? (
        <div className="funds-flow-content">
          <div className="funds-flow-chart-panel">
            <Suspense fallback={<div className="chart-loading compact">正在初始化资金流图表…</div>}>
              <FundsFlowChart points={data.points} />
            </Suspense>
          </div>
          <div className="funds-flow-table-wrap">
            <table className="funds-flow-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>主力</th>
                  <th>超大单</th>
                  <th>大单</th>
                  <th>中单</th>
                  <th>小单</th>
                </tr>
              </thead>
              <tbody>
                {recentPoints.map((point) => (
                  <tr key={point.time}>
                    <td>{point.time.slice(11, 16)}</td>
                    <td className={valueClass(point.main)}>{formatSignedAmount(point.main)}</td>
                    <td className={valueClass(point.superLarge)}>
                      {formatSignedAmount(point.superLarge)}
                    </td>
                    <td className={valueClass(point.large)}>{formatSignedAmount(point.large)}</td>
                    <td className={valueClass(point.medium)}>{formatSignedAmount(point.medium)}</td>
                    <td className={valueClass(point.small)}>{formatSignedAmount(point.small)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="chart-loading">最近交易日暂无资金流向数据</div>
      )}
    </div>
  )
}
