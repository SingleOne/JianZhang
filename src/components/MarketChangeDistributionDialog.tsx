import { ChartColumn, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stockApi } from '../lib/api'
import {
  MARKET_CHANGE_BUCKETS,
  type MarketChangeDistribution
} from '../shared/market-change-distribution'
import { AppButton } from './AppButton'
import { Tooltip } from './Tooltip'
import './MarketChangeDistributionDialog.css'

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export default function MarketChangeDistributionDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MarketChangeDistribution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const result = await stockApi.getMarketChangeDistribution(forceRefresh)
      if (aliveRef.current) setData(result)
    } catch (reason) {
      if (aliveRef.current)
        setError(reason instanceof Error ? reason.message : '全市场行情加载失败')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void load()
    return () => {
      aliveRef.current = false
    }
  }, [load])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  const maximum = Math.max(1, ...(data?.counts ?? []))
  const validCount = data?.total ?? 0
  return createPortal(
    <div
      className="market-distribution-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="market-distribution-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-distribution-title"
      >
        <header className="market-distribution-header">
          <ChartColumn size={23} />
          <span>
            <h2 id="market-distribution-title">涨跌幅分布</h2>
            <small>A 股市场 · 东方财富页面统计口径</small>
          </span>
          <AppButton variant="secondary" disabled={loading} onClick={() => void load(true)}>
            <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
            {loading ? '加载中' : '刷新'}
          </AppButton>
          <AppButton variant="icon" ref={closeRef} aria-label="关闭涨跌幅分布" onClick={onClose}>
            <X size={19} />
          </AppButton>
        </header>
        <div className="market-distribution-body" aria-busy={loading}>
          {error ? (
            <p className="market-distribution-error" role="alert">
              {error}
              {data ? '，下方保留上次获取的数据。' : '，请点击刷新重试。'}
            </p>
          ) : null}
          {data ? (
            <>
              <div className="market-distribution-summary">
                <span>
                  <small>上涨</small>
                  <strong className="is-up">
                    {data.rising.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
                <span>
                  <small>平盘</small>
                  <strong className="is-flat">
                    {data.flat.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
                <span>
                  <small>下跌</small>
                  <strong className="is-down">
                    {data.falling.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
                <span>
                  <small>涨停</small>
                  <strong className="is-up">
                    {data.limitUp.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
                <span>
                  <small>跌停</small>
                  <strong className="is-down">
                    {data.limitDown.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
                <span>
                  <small>统计样本</small>
                  <strong>
                    {data.total.toLocaleString()}
                    <small>只</small>
                  </strong>
                </span>
              </div>
              <div className="market-distribution-chart-scroll">
                <div className="market-distribution-chart" aria-label="A 股涨跌幅区间及股票数量">
                  {MARKET_CHANGE_BUCKETS.map((bucket, index) => {
                    const count = data.counts[index]
                    const share = validCount ? ((count / validCount) * 100).toFixed(1) : '0.0'
                    return (
                      <Tooltip
                        key={bucket.label}
                        content={`${bucket.range}：${count} 只，占 ${share}%`}
                      >
                        <div
                          className={`market-distribution-column is-${bucket.direction}`}
                          tabIndex={0}
                          aria-label={`${bucket.range}，${count} 只，占 ${share}%`}
                        >
                          <div className="market-distribution-bar-area">
                            <div
                              className="market-distribution-bar"
                              style={{ height: `${(count / maximum) * 100}%` }}
                            >
                              <strong>{count}</strong>
                            </div>
                          </div>
                          <span>{bucket.label}</span>
                        </div>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
              <footer className="market-distribution-note">
                <span>
                  来源：东方财富涨停板行情 · 数据日期：{data.tradingDate} · 获取于{' '}
                  {formatTime(data.fetchedAt)}（北京时间）
                </span>
                <span>
                  涨跌停单列，其余区间不含涨跌停，区间边界沿用数据源口径；上涨、下跌总数包含对应涨跌停。
                </span>
                <span>休市时展示数据源最近统计；悬停柱条可查看区间与占比。</span>
              </footer>
            </>
          ) : (
            <p className="market-distribution-empty" role="status">
              {loading ? '正在获取 A 股市场涨跌分布，请稍候…' : '暂无市场涨跌分布数据'}
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}
