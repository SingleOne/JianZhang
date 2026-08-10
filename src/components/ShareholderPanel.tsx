import { Building2, Database, RefreshCw, TriangleAlert, UserRound, UsersRound } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import { formatAmount, formatSignedAmount } from '../lib/format'
import type { ShareholderHolding, ShareholderSnapshot, WatchStock } from '../shared/types'

const ShareholderCountChart = lazy(() => import('./ShareholderCountChart'))
const shareholderCache = new Map<string, ShareholderSnapshot>()

type HoldingList = 'all' | 'free'

function percentText(value: number | null, signed = false): string {
  if (value === null) return '--'
  return `${signed && value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fetchedTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function changeText(item: ShareholderHolding): string {
  if (item.changeLabel) return item.changeLabel
  if (item.changeShares === null) return '--'
  return `${formatSignedAmount(item.changeShares)}股`
}

function changeClass(item: ShareholderHolding): string {
  const value = item.changeShares ?? item.changeRatio
  if (value === null) return 'is-zero'
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-zero'
}

function HoldingTable({ rows }: { rows: ShareholderHolding[] }) {
  if (rows.length === 0) {
    return <div className="shareholder-holding-empty">当前报告期暂无股东明细</div>
  }
  return (
    <div className="shareholder-table-wrap">
      <table className="shareholder-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>股东名称</th>
            <th>股东类型</th>
            <th>股份类型</th>
            <th>持股数量</th>
            <th>持股比例</th>
            <th>本期变化</th>
            <th>变化比例</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={`${item.rank}:${item.name}`}>
              <td>{item.rank}</td>
              <td title={item.name}>{item.name}</td>
              <td>{item.holderType ?? '--'}</td>
              <td>{item.sharesType ?? '--'}</td>
              <td>{formatAmount(item.holdingShares)}股</td>
              <td>{percentText(item.holdingRatio)}</td>
              <td className={changeClass(item)}>{changeText(item)}</td>
              <td className={changeClass(item)}>{percentText(item.changeRatio, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ShareholderPanel({ stock }: { stock: WatchStock }) {
  const [snapshot, setSnapshot] = useState<ShareholderSnapshot | null>(
    () => shareholderCache.get(stock.quoteId) ?? null
  )
  const [loading, setLoading] = useState(!snapshot)
  const [error, setError] = useState('')
  const [activeList, setActiveList] = useState<HoldingList>('all')

  useEffect(() => {
    let active = true
    const cached = shareholderCache.get(stock.quoteId) ?? null
    setSnapshot(cached)
    setLoading(!cached)
    setError('')
    void stockApi
      .getShareholderSnapshot(stock.quoteId)
      .then((result) => {
        if (!active) return
        shareholderCache.set(stock.quoteId, result)
        setSnapshot(result)
      })
      .catch((reason) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '股东信息获取失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [stock.quoteId])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await stockApi.getShareholderSnapshot(stock.quoteId, true)
      shareholderCache.set(stock.quoteId, result)
      setSnapshot(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '股东信息更新失败')
    } finally {
      setLoading(false)
    }
  }, [stock.quoteId])

  const holdings = useMemo(
    () => (activeList === 'all' ? snapshot?.topShareholders : snapshot?.topFreeShareholders) ?? [],
    [activeList, snapshot]
  )

  return (
    <div className="shareholder-panel" role="tabpanel">
      <header className="shareholder-header">
        <span className="shareholder-header-icon">
          <UsersRound size={24} />
        </span>
        <span>
          <small>{stock.code} · 上市公司股东结构</small>
          <strong>{stock.name}股东信息</strong>
        </span>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'is-spinning' : ''} />
          {loading ? '更新中' : '更新数据'}
        </button>
      </header>

      {snapshot?.warning ? (
        <div className="shareholder-warning">
          <TriangleAlert size={16} />
          {snapshot.warning}
        </div>
      ) : null}
      {error ? (
        <div className="shareholder-error">
          <TriangleAlert size={16} />
          {error}
        </div>
      ) : null}

      {loading && !snapshot ? (
        <div className="shareholder-empty">
          <RefreshCw size={22} className="is-spinning" />
          <span>正在查询股东信息…</span>
        </div>
      ) : !snapshot ? (
        <div className="shareholder-empty">
          <Database size={24} />
          <span>暂无可展示的股东信息</span>
          <button type="button" onClick={() => void refresh()}>
            重新查询
          </button>
        </div>
      ) : (
        <>
          <section className="shareholder-summary-grid">
            <article className="shareholder-controller-card">
              <span>
                <Building2 size={17} />
                实际控制人
              </span>
              <strong>{snapshot.controller?.name ?? '--'}</strong>
              <small>
                {snapshot.controller?.holdingRatio === null || !snapshot.controller
                  ? '公开数据未披露持股比例'
                  : `持股比例 ${percentText(snapshot.controller.holdingRatio)}`}
              </small>
            </article>
            <article>
              <span>
                <UsersRound size={17} />
                股东户数
              </span>
              <strong>{formatAmount(snapshot.latestSummary?.holderCount)}户</strong>
              <small>
                较上期 {percentText(snapshot.latestSummary?.changePercent ?? null, true)}
              </small>
            </article>
            <article>
              <span>
                <UserRound size={17} />
                户均流通股
              </span>
              <strong>{formatAmount(snapshot.latestSummary?.averageFreeShares)}股</strong>
              <small>
                较上期{' '}
                {percentText(snapshot.latestSummary?.averageFreeSharesChangePercent ?? null, true)}
              </small>
            </article>
            <article>
              <span>
                <Database size={17} />
                户均持股市值
              </span>
              <strong>{formatAmount(snapshot.latestSummary?.averageHoldingAmount)}元</strong>
              <small>{snapshot.latestSummary?.concentration ?? '暂无集中度评价'}</small>
            </article>
            <article>
              <span>
                <UsersRound size={17} />
                前十持股比例
              </span>
              <strong>{percentText(snapshot.latestSummary?.topTenHoldingRatio ?? null)}</strong>
              <small>
                流通前十 {percentText(snapshot.latestSummary?.topTenFreeHoldingRatio ?? null)}
              </small>
            </article>
          </section>

          <section className="shareholder-section">
            <div className="shareholder-section-title">
              <strong>股东户数趋势</strong>
              <small>近 {snapshot.holderHistory.length} 个公开报告期</small>
            </div>
            {snapshot.holderHistory.length > 1 ? (
              <Suspense fallback={<div className="shareholder-chart-loading">趋势图加载中…</div>}>
                <ShareholderCountChart points={snapshot.holderHistory} />
              </Suspense>
            ) : (
              <div className="shareholder-holding-empty">报告期数量不足，暂不绘制趋势</div>
            )}
          </section>

          <section className="shareholder-section">
            <div className="shareholder-holding-heading">
              <div className="shareholder-list-tabs" role="tablist" aria-label="股东明细类型">
                <button
                  className={activeList === 'all' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={activeList === 'all'}
                  onClick={() => setActiveList('all')}
                >
                  十大股东
                </button>
                <button
                  className={activeList === 'free' ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={activeList === 'free'}
                  onClick={() => setActiveList('free')}
                >
                  十大流通股东
                </button>
              </div>
              <small>报告期 {snapshot.reportDate || '--'}</small>
            </div>
            <HoldingTable rows={holdings} />
          </section>

          <footer className="shareholder-source">
            <span>数据来源：东方财富 F10</span>
            <span>报告期：{snapshot.reportDate || '--'}</span>
            <span>获取时间：{fetchedTime(snapshot.fetchedAt)}</span>
            {snapshot.fromCache ? <span>本地持久化数据</span> : <span>实时更新后已保存</span>}
          </footer>
        </>
      )}
    </div>
  )
}
