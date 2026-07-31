import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { stockApi } from '../lib/api'
import { calculateChipDistribution } from '../lib/chip-distribution'
import type { KlineBar } from '../shared/types'

interface ChipDistributionPanelProps {
  quoteId: string
  quoteName: string
  bars: KlineBar[]
  dataStatus: 'loading' | 'failed' | 'missing-turnover' | 'empty' | 'ready'
  statusDetail?: string
  isAutoRange: boolean
  onRestoreAutoRange: () => void
}

function formatChipPrice(value: number): string {
  return value.toFixed(2)
}

function formatChipPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

export function ChipDistributionPanel({
  quoteId,
  quoteName,
  bars,
  dataStatus,
  statusDetail,
  isAutoRange,
  onRestoreAutoRange
}: ChipDistributionPanelProps) {
  const distribution = useMemo(() => calculateChipDistribution(bars), [bars])

  useEffect(() => {
    if (!distribution) return
    const timer = window.setTimeout(() => {
      void stockApi.saveChipDistributionCache({
        ...distribution,
        quoteId,
        name: quoteName,
        calculatedAt: new Date().toISOString()
      }).catch(() => undefined)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [distribution, quoteId, quoteName])

  return (
    <aside className="chip-distribution-panel" aria-label="筹码分布">
      <header>
        <div>
          <strong>筹码分布</strong>
          <span>{isAutoRange ? '100%换手自动范围' : '当前可视范围'}</span>
        </div>
        <button
          type="button"
          onClick={onRestoreAutoRange}
          disabled={isAutoRange}
          aria-label="恢复100%换手自动范围"
          title="恢复100%换手自动范围"
        >
          <RotateCcw size={15} />
        </button>
      </header>

      {distribution ? (
        <>
          <div className="chip-range-meta">
            <span>{distribution.startDate} 至 {distribution.endDate}</span>
            <strong className={distribution.cumulativeTurnover >= 100 ? 'is-complete' : ''}>
              {distribution.barCount}日 · 累计换手 {formatChipPercent(distribution.cumulativeTurnover)}
            </strong>
          </div>

          <div className="chip-summary-grid">
            <span>
              <small>平均成本</small>
              <strong>{formatChipPrice(distribution.averageCost)}</strong>
            </span>
            <span>
              <small>获利筹码</small>
              <strong className={distribution.profitPercent === 0 ? 'is-flat' : 'is-up'}>
                {formatChipPercent(distribution.profitPercent)}
              </strong>
            </span>
            <span title={`70%筹码集中度 ${formatChipPercent(distribution.cost70.concentration)}`}>
              <small>70%成本</small>
              <strong>{formatChipPrice(distribution.cost70.low)}–{formatChipPrice(distribution.cost70.high)}</strong>
            </span>
            <span title={`90%筹码集中度 ${formatChipPercent(distribution.cost90.concentration)}`}>
              <small>90%成本</small>
              <strong>{formatChipPrice(distribution.cost90.low)}–{formatChipPrice(distribution.cost90.high)}</strong>
            </span>
          </div>

          <ChipDistributionChart
            buckets={distribution.buckets}
            currentPrice={distribution.currentPrice}
            averageCost={distribution.averageCost}
          />

          <footer>基于可视日K价格与换手率估算</footer>
        </>
      ) : (
        <ChipDistributionStatus
          status={dataStatus}
          detail={statusDetail}
          bars={bars}
        />
      )}
    </aside>
  )
}

interface ChipDistributionStatusProps {
  status: ChipDistributionPanelProps['dataStatus']
  detail?: string
  bars: KlineBar[]
}

function ChipDistributionStatus({ status, detail, bars }: ChipDistributionStatusProps) {
  let title = '暂时无法计算筹码分布'
  let description = detail || '当前范围没有形成有效的筹码数据。'

  if (status === 'loading') {
    title = '正在获取日 K 数据…'
    description = '正在检查本地缓存；无可用缓存时尝试东方财富，失败后切换腾讯备用行情。'
  } else if (status === 'failed') {
    title = '日 K 数据读取失败'
    description = detail || '行情接口暂时不可用，请稍后重试。'
  } else if (status === 'missing-turnover') {
    title = '日 K 已读取，但换手率不完整'
    description = detail || '部分交易日缺少换手率，无法确定累计换手 100% 的计算范围。'
  } else if (status === 'empty') {
    title = '没有可用的日 K 数据'
    description = detail || '行情接口未返回可用于计算筹码分布的日 K。'
  } else if (bars.length > 0 && bars.every((bar) => bar.turnoverRate === 0)) {
    title = '当前范围的换手率均为 0'
    description = '没有形成可用于估算的有效筹码数据。'
  }

  return (
    <div className={`chip-distribution-empty is-${status}`} title={description}>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

interface ChipDistributionChartProps {
  buckets: Array<{ price: number; percent: number }>
  currentPrice: number
  averageCost: number
}

function ChipDistributionChart({
  buckets,
  currentPrice,
  averageCost
}: ChipDistributionChartProps) {
  const width = 260
  const height = 150
  const top = 9
  const bottom = 137
  const left = 50
  const right = 253
  const chartHeight = bottom - top
  const maxPercent = Math.max(...buckets.map((bucket) => bucket.percent))
  const minPrice = buckets[0]?.price ?? 0
  const maxPrice = buckets.at(-1)?.price ?? 0
  const priceSpan = Math.max(0.01, maxPrice - minPrice)
  const yForPrice = (price: number) => bottom - (price - minPrice) / priceSpan * chartHeight
  const bucketHeight = Math.max(0.7, chartHeight / buckets.length * 0.74)
  const currentY = yForPrice(currentPrice)
  const averageY = yForPrice(averageCost)

  return (
    <div className="chip-distribution-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="价格筹码分布图">
        <text x="0" y={top + 4}>{formatChipPrice(maxPrice)}</text>
        <text x="0" y={bottom + 4}>{formatChipPrice(minPrice)}</text>
        <line className="chip-price-axis" x1={left} y1={top} x2={left} y2={bottom} />
        {buckets.map((bucket, index) => {
          const y = bottom - index / Math.max(1, buckets.length - 1) * chartHeight
          const barWidth = maxPercent === 0 ? 0 : bucket.percent / maxPercent * (right - left)
          return (
            <rect
              className={bucket.price <= currentPrice ? 'is-profit-chip' : 'is-loss-chip'}
              x={left}
              y={y - bucketHeight / 2}
              width={barWidth}
              height={bucketHeight}
              key={index}
            >
              <title>价格 {formatChipPrice(bucket.price)} · 筹码 {formatChipPercent(bucket.percent)}</title>
            </rect>
          )
        })}
        <line className="chip-current-line" x1={left} y1={currentY} x2={right} y2={currentY} />
        <line className="chip-average-line" x1={left} y1={averageY} x2={right} y2={averageY} />
      </svg>
      <div className="chip-chart-legend" aria-label="筹码图图例">
        <span className="is-profit-chip">获利</span>
        <span className="is-loss-chip">套牢</span>
        <span className="is-current-price">现价 {formatChipPrice(currentPrice)}</span>
        <span className="is-average-cost">均价</span>
      </div>
    </div>
  )
}
