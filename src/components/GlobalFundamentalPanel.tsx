import { ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { stockApi } from '../lib/api'
import type {
  GlobalFinancialMetric,
  GlobalFinancialMetricId,
  GlobalFinancialPeriod,
  GlobalFundamentalSnapshot,
  WatchStock
} from '../shared/types'
import './GlobalFundamentalPanel.css'

const snapshotCache = new Map<string, GlobalFundamentalSnapshot>()
const CARD_METRICS: GlobalFinancialMetricId[] = [
  'revenue',
  'netIncome',
  'operatingCashFlow',
  'freeCashFlow',
  'grossMargin',
  'netMargin',
  'roe',
  'debtAssetRatio'
]
const TABLE_METRICS: Array<{ id: GlobalFinancialMetricId; label: string }> = [
  { id: 'revenue', label: '营业收入' },
  { id: 'netIncome', label: '净利润' },
  { id: 'operatingCashFlow', label: '经营现金流' },
  { id: 'freeCashFlow', label: '自由现金流' },
  { id: 'roe', label: 'ROE' },
  { id: 'debtAssetRatio', label: '资产负债率' }
]

function metricById(
  period: GlobalFinancialPeriod | undefined,
  id: GlobalFinancialMetricId
): GlobalFinancialMetric | undefined {
  return period?.metrics.find((metric) => metric.id === id)
}

function formatMetric(metric: GlobalFinancialMetric | undefined): string {
  if (!metric) return '--'
  if (metric.unit === 'percent') {
    return `${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
  }
  if (metric.unit === 'perShare') {
    return `${metric.currency ?? ''} ${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}`.trim()
  }
  const absolute = Math.abs(metric.value)
  const divisor = absolute >= 1_000_000_000 ? 1_000_000_000 : absolute >= 1_000_000 ? 1_000_000 : 1
  const unit = divisor === 1_000_000_000 ? '十亿' : divisor === 1_000_000 ? '百万' : ''
  return `${metric.currency ?? ''} ${(metric.value / divisor).toLocaleString('zh-CN', {
    maximumFractionDigits: 2
  })}${unit}`.trim()
}

function metricClass(metric: GlobalFinancialMetric | undefined): string {
  if (!metric || !['roe', 'netMargin', 'freeCashFlow', 'netIncome'].includes(metric.id)) return ''
  return metric.value > 0 ? 'is-positive' : metric.value < 0 ? 'is-negative' : 'is-zero'
}

function periodLabel(period: GlobalFinancialPeriod): string {
  if (period.periodType === 'ttm') return 'TTM'
  if (period.periodType === 'annual') return `${period.fiscalYear} 财年`
  return `${period.fiscalYear} ${period.fiscalPeriod}`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value))
}

export default function GlobalFundamentalPanel({ stock }: { stock: WatchStock }) {
  const [snapshot, setSnapshot] = useState<GlobalFundamentalSnapshot | null>(
    () => snapshotCache.get(stock.quoteId) ?? null
  )
  const [loading, setLoading] = useState(!snapshot)
  const [error, setError] = useState('')

  const loadSnapshot = useCallback(
    async (forceRefresh = false) => {
      setLoading(true)
      setError('')
      try {
        const result = await stockApi.getGlobalFundamentals(stock.quoteId, forceRefresh)
        snapshotCache.set(stock.quoteId, result)
        setSnapshot(result)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '官方财务数据获取失败')
      } finally {
        setLoading(false)
      }
    },
    [stock.quoteId]
  )

  useEffect(() => {
    const cached = snapshotCache.get(stock.quoteId)
    setSnapshot(cached ?? null)
    if (!cached) void loadSnapshot()
  }, [loadSnapshot, stock.quoteId])

  const latestPeriod = useMemo(
    () => snapshot?.periods.find((period) => period.periodType === 'ttm') ?? snapshot?.periods[0],
    [snapshot]
  )
  const cardMetrics = useMemo(
    () =>
      CARD_METRICS.flatMap((id) => {
        const metric = metricById(latestPeriod, id)
        return metric ? [metric] : []
      }),
    [latestPeriod]
  )

  const openSource = (url: string) => {
    void stockApi.openCompanyReport(url).catch((reason) => {
      setError(reason instanceof Error ? reason.message : '官方原文打开失败')
    })
  }

  return (
    <div className="global-fundamental-panel">
      <header className="global-fundamental-header">
        <span>
          <small>
            {stock.code} · {snapshot?.source.name ?? '官方财务数据'}
          </small>
          <strong>{stock.name}结构化财务概览</strong>
        </span>
        <button type="button" onClick={() => void loadSnapshot(true)} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'is-spinning' : ''} />
          {loading ? '更新中' : '更新数据'}
        </button>
      </header>

      {snapshot?.warning ? (
        <div className="global-fundamental-warning">
          <TriangleAlert size={16} />
          {snapshot.warning}
        </div>
      ) : null}
      {error ? (
        <div className="global-fundamental-error">
          <TriangleAlert size={16} />
          {error}
        </div>
      ) : null}

      {loading && !snapshot ? (
        <div className="global-fundamental-empty">
          <RefreshCw size={22} className="is-spinning" />
          正在读取官方财务数据…
        </div>
      ) : latestPeriod ? (
        <>
          <section className="global-fundamental-meta">
            <span>
              <small>当前口径</small>
              <strong>{periodLabel(latestPeriod)}</strong>
            </span>
            <span>
              <small>报告币种</small>
              <strong>{snapshot?.reportingCurrency ?? '--'}</strong>
            </span>
            <span>
              <small>会计准则</small>
              <strong>{snapshot?.accountingStandard ?? '--'}</strong>
            </span>
            <span>
              <small>期末日期</small>
              <strong>{latestPeriod.periodEnd}</strong>
            </span>
          </section>

          <section className="global-fundamental-cards">
            {cardMetrics.map((metric) => (
              <article key={metric.id}>
                <small>
                  {metric.label}
                  {metric.derivation === 'calculated' ? ' · 计算值' : ''}
                </small>
                <strong className={metricClass(metric)}>{formatMetric(metric)}</strong>
              </article>
            ))}
          </section>

          <div className="global-fundamental-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>报告期</th>
                  {TABLE_METRICS.map((metric) => (
                    <th key={metric.id}>{metric.label}</th>
                  ))}
                  <th>原文</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.periods.map((period) => (
                  <tr key={period.id}>
                    <td>
                      <strong>{periodLabel(period)}</strong>
                      <small>{period.periodEnd}</small>
                    </td>
                    {TABLE_METRICS.map(({ id }) => {
                      const metric = metricById(period, id)
                      return (
                        <td className={metricClass(metric)} key={id}>
                          {formatMetric(metric)}
                        </td>
                      )
                    })}
                    <td>
                      <button
                        type="button"
                        onClick={() => openSource(period.sourceUrl)}
                        title="打开官方原文"
                      >
                        <ExternalLink size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="global-fundamental-empty">
          暂无能够可靠标准化的财务指标，请前往“财报库”查看官方原文。
        </div>
      )}

      {snapshot ? (
        <footer className="global-fundamental-source">
          <span>来源：{snapshot.source.name}</span>
          <span>
            更新：{formatDate(snapshot.fetchedAt)}
            {snapshot.fromCache ? ' · 本地缓存' : ''}
          </span>
          <button type="button" onClick={() => openSource(snapshot.source.url)}>
            监管机构页面 <ExternalLink size={13} />
          </button>
        </footer>
      ) : null}
    </div>
  )
}
