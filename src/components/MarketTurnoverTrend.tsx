import { ColorType, createChart, LineSeries } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResolvedAppTheme } from '../hooks/useResolvedAppTheme'
import { getChartThemeColors } from '../lib/theme'
import { MARKET_TURNOVER_RANGES, type MarketTurnoverHistory } from '../shared/market-funds-flow'
import { AppButton } from './AppButton'

const SOURCE_LABELS: Record<MarketTurnoverHistory['source'], string> = {
  'eastmoney-primary': '东方财富历史行情',
  'eastmoney-mirror': '东方财富历史行情（使用镜像节点）',
  tencent: '腾讯近五日分时'
}

interface MarketTurnoverTrendProps {
  history: MarketTurnoverHistory | null
  loading: boolean
  error: string | null
}

export default function MarketTurnoverTrend({ history, loading, error }: MarketTurnoverTrendProps) {
  const [days, setDays] = useState<number>(MARKET_TURNOVER_RANGES[0])
  const containerRef = useRef<HTMLDivElement>(null)
  const resolvedTheme = useResolvedAppTheme()
  const points = useMemo(() => history?.points.slice(-days) ?? [], [history, days])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !points.length) return
    const theme = getChartThemeColors(resolvedTheme)
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.text,
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 12
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid }
      },
      rightPriceScale: { borderColor: theme.border },
      timeScale: { borderColor: theme.border },
      localization: { dateFormat: 'yyyy-MM-dd', locale: 'zh-CN' }
    })
    const series = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      pointMarkersVisible: points.length === 1,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: false
    })
    series.setData(points.map(({ date, amount }) => ({ time: date, value: amount / 100_000_000 })))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [points, resolvedTheme])

  return (
    <section
      className="market-funds-section"
      aria-labelledby="market-turnover-title"
      aria-busy={loading}
    >
      <div className="market-distribution-section-heading">
        <h3 id="market-turnover-title">沪深 A 股成交额趋势</h3>
        <span>亿元 · 已收盘交易日</span>
        <div className="market-turnover-ranges" role="group" aria-label="成交额趋势区间">
          {MARKET_TURNOVER_RANGES.map((range) => (
            <AppButton
              key={range}
              variant={days === range ? 'primary' : 'secondary'}
              aria-pressed={days === range}
              onClick={() => setDays(range)}
            >
              近 {range} 日
            </AppButton>
          ))}
        </div>
      </div>
      {error ? (
        <p className="market-distribution-error" role="alert">
          成交额趋势加载失败。{history ? '下方为上次获取的数据。' : '请点击刷新重试。'}
        </p>
      ) : null}
      {history ? (
        <>
          <div
            className="market-turnover-chart"
            ref={containerRef}
            role="img"
            aria-label="沪深 A 股日成交额折线图"
          />
          <div className="market-turnover-source">
            来源：{SOURCE_LABELS[history.source]} · 当前显示 {points.length} 个交易日
          </div>
        </>
      ) : loading ? (
        <p className="market-distribution-empty" role="status">
          正在获取沪深 A 股历史成交额…
        </p>
      ) : null}
    </section>
  )
}
