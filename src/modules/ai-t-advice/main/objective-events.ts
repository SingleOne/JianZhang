import type { IndicatorValue, MarketInsightSnapshot } from '../../market-insight/shared/types'
import { formatPercent, formatPrice } from '../../../lib/format'
import type { AiTAdviceTradingContext } from '../shared/types'

export type AiTAdviceObjectiveEventCategory =
  | 'price'
  | 'intraday'
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'order-book'
  | 'relative-strength'
  | 'position'
  | 't-plan'

export interface AiTAdviceObjectiveEvent {
  id: string
  category: AiTAdviceObjectiveEventCategory
  significance: 'notable' | 'strong'
  title: string
  facts: string[]
  sourceIds: string[]
}

type EventDraft = Omit<AiTAdviceObjectiveEvent, 'significance'> & {
  significance?: AiTAdviceObjectiveEvent['significance']
}

function indicatorMap(snapshot: MarketInsightSnapshot): Map<string, IndicatorValue> {
  const indicators = snapshot.indicators
  return new Map(
    [
      ...indicators.intraday,
      ...indicators.trend,
      ...indicators.momentum,
      ...indicators.volatility,
      ...indicators.orderBook,
      ...indicators.relativeStrength
    ].map((item) => [item.id, item])
  )
}

function value(indicators: Map<string, IndicatorValue>, id: string): number | null {
  const current = indicators.get(id)?.value
  return current !== null && current !== undefined && Number.isFinite(current) ? current : null
}

function ratioText(value: number): string {
  return value.toFixed(2)
}

function amountText(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (absolute >= 10_000) return `${(value / 10_000).toFixed(2)}万`
  return value.toFixed(0)
}

function deviationPercent(latest: number, baseline: number): number | null {
  return baseline === 0 ? null : (latest / baseline - 1) * 100
}

function add(events: AiTAdviceObjectiveEvent[], event: EventDraft): void {
  events.push({ ...event, significance: event.significance ?? 'notable' })
}

function addQuoteEvents(events: AiTAdviceObjectiveEvent[], context: AiTAdviceTradingContext): void {
  const quote = context.quote
  if (!quote || quote.latest === null) return
  const latest = quote.latest
  if (quote.changePercent !== null && Math.abs(quote.changePercent) >= 2) {
    add(events, {
      id: 'daily-price-change',
      category: 'price',
      significance: Math.abs(quote.changePercent) >= 5 ? 'strong' : 'notable',
      title: `当前价格较昨收${quote.changePercent > 0 ? '明显上涨' : '明显下跌'}`,
      facts: [
        `最新价 ${formatPrice(latest)}`,
        `涨跌幅 ${formatPercent(quote.changePercent)}`,
        ...(quote.low === null || quote.high === null
          ? []
          : [`当日区间 ${formatPrice(quote.low)} 至 ${formatPrice(quote.high)}`])
      ],
      sourceIds: ['quote.latest', 'quote.changePercent', 'quote.high', 'quote.low']
    })
  }
  if (quote.open !== null && quote.previousClose !== null) {
    const gap = deviationPercent(quote.open, quote.previousClose)
    if (gap !== null && Math.abs(gap) >= 1) {
      add(events, {
        id: 'opening-gap',
        category: 'price',
        significance: Math.abs(gap) >= 3 ? 'strong' : 'notable',
        title: `开盘价较昨收${gap > 0 ? '高开' : '低开'}`,
        facts: [
          `开盘价 ${formatPrice(quote.open)}`,
          `昨收 ${formatPrice(quote.previousClose)}`,
          `开盘缺口 ${formatPercent(gap)}`
        ],
        sourceIds: ['quote.open', 'quote.previousClose']
      })
    }
  }
}

function addBollingerEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>,
  context: AiTAdviceTradingContext
): void {
  const latest = context.quote?.latest
  const upper = value(indicators, 'bollinger-upper')
  const middle = value(indicators, 'bollinger-middle')
  const lower = value(indicators, 'bollinger-lower')
  if (latest === null || latest === undefined || upper === null || lower === null) return
  const upperDeviation = deviationPercent(latest, upper)!
  const lowerDeviation = deviationPercent(latest, lower)!
  const facts = [
    `最新价 ${formatPrice(latest)}`,
    `布林上轨 ${formatPrice(upper)}，相对上轨 ${formatPercent(upperDeviation)}`,
    ...(middle === null
      ? []
      : [
          `布林中轨 ${formatPrice(middle)}，相对中轨 ${formatPercent(deviationPercent(latest, middle)!)}`
        ]),
    `布林下轨 ${formatPrice(lower)}，相对下轨 ${formatPercent(lowerDeviation)}`
  ]
  if (latest > upper) {
    add(events, {
      id: 'bollinger-above-upper',
      category: 'volatility',
      significance: 'strong',
      title: '当前价格位于布林上轨上方',
      facts,
      sourceIds: ['quote.latest', 'bollinger-upper', 'bollinger-middle', 'bollinger-lower']
    })
    return
  }
  if (latest < lower) {
    add(events, {
      id: 'bollinger-below-lower',
      category: 'volatility',
      significance: 'strong',
      title: '当前价格位于布林下轨下方',
      facts,
      sourceIds: ['quote.latest', 'bollinger-upper', 'bollinger-middle', 'bollinger-lower']
    })
    return
  }

  const high = context.quote?.high
  const low = context.quote?.low
  if (high !== null && high !== undefined && high > upper) {
    add(events, {
      id: 'bollinger-high-exceeded-upper',
      category: 'volatility',
      title: '当日最高价越过布林上轨，但当前价已回到轨道内',
      facts: [`当日最高价 ${formatPrice(high)}`, ...facts],
      sourceIds: ['quote.high', 'quote.latest', 'bollinger-upper']
    })
  }
  if (low !== null && low !== undefined && low < lower) {
    add(events, {
      id: 'bollinger-low-breached-lower',
      category: 'volatility',
      title: '当日最低价跌破布林下轨，但当前价已回到轨道内',
      facts: [`当日最低价 ${formatPrice(low)}`, ...facts],
      sourceIds: ['quote.low', 'quote.latest', 'bollinger-lower']
    })
  }
  if (Math.abs(upperDeviation) <= 0.5) {
    add(events, {
      id: 'bollinger-near-upper',
      category: 'volatility',
      title: '当前价格接近布林上轨',
      facts,
      sourceIds: ['quote.latest', 'bollinger-upper', 'bollinger-middle', 'bollinger-lower']
    })
  } else if (Math.abs(lowerDeviation) <= 0.5) {
    add(events, {
      id: 'bollinger-near-lower',
      category: 'volatility',
      title: '当前价格接近布林下轨',
      facts,
      sourceIds: ['quote.latest', 'bollinger-upper', 'bollinger-middle', 'bollinger-lower']
    })
  }
}

function addIntradayEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>,
  context: AiTAdviceTradingContext
): void {
  const latest = context.quote?.latest
  if (latest === null || latest === undefined) return

  const vwapDeviation = value(indicators, 'vwap-deviation')
  const vwap = value(indicators, 'vwap')
  if (vwapDeviation !== null && Math.abs(vwapDeviation) >= 0.5) {
    add(events, {
      id: 'vwap-position',
      category: 'intraday',
      significance: Math.abs(vwapDeviation) >= 1.5 ? 'strong' : 'notable',
      title: `当前价格明显位于 VWAP ${vwapDeviation > 0 ? '上方' : '下方'}`,
      facts: [
        `相对 VWAP ${formatPercent(vwapDeviation)}`,
        ...(vwap === null ? [] : [`VWAP ${formatPrice(vwap)}`])
      ],
      sourceIds: ['vwap-deviation', 'vwap']
    })
  }

  const returns = [1, 3, 5, 15].flatMap((minutes) => {
    const current = value(indicators, `return-${minutes}m`)
    return current === null ? [] : [{ minutes, value: current }]
  })
  const allPositive = returns.length >= 3 && returns.every((item) => item.value > 0)
  const allNegative = returns.length >= 3 && returns.every((item) => item.value < 0)
  const largestReturn = returns.reduce(
    (largest, item) => Math.max(largest, Math.abs(item.value)),
    0
  )
  if ((allPositive || allNegative) && largestReturn >= 0.5) {
    add(events, {
      id: 'aligned-short-returns',
      category: 'intraday',
      significance: largestReturn >= 1.5 ? 'strong' : 'notable',
      title: `多个短周期收益一致为${allPositive ? '正' : '负'}`,
      facts: returns.map((item) => `${item.minutes} 分钟收益 ${formatPercent(item.value)}`),
      sourceIds: returns.map((item) => `return-${item.minutes}m`)
    })
  } else if (largestReturn >= 1) {
    add(events, {
      id: 'short-return-divergence',
      category: 'intraday',
      title: '短周期收益出现明显波动或方向分化',
      facts: returns.map((item) => `${item.minutes} 分钟收益 ${formatPercent(item.value)}`),
      sourceIds: returns.map((item) => `return-${item.minutes}m`)
    })
  }

  const intradayPosition = value(indicators, 'intraday-position')
  if (intradayPosition !== null && (intradayPosition >= 90 || intradayPosition <= 10)) {
    add(events, {
      id: intradayPosition >= 90 ? 'near-intraday-high' : 'near-intraday-low',
      category: 'intraday',
      significance: intradayPosition >= 97 || intradayPosition <= 3 ? 'strong' : 'notable',
      title: `当前价格接近当日区间${intradayPosition >= 90 ? '高位' : '低位'}`,
      facts: [`当前位于当日高低区间 ${intradayPosition.toFixed(1)}% 位置`],
      sourceIds: ['intraday-position']
    })
  }

  const aboveRanges: string[] = []
  const belowRanges: string[] = []
  for (const minutes of [15, 30] as const) {
    const high = value(indicators, `opening-range-${minutes}-high`)
    const low = value(indicators, `opening-range-${minutes}-low`)
    if (high !== null && latest > high)
      aboveRanges.push(`高于开盘 ${minutes} 分钟高点 ${formatPrice(high)}`)
    if (low !== null && latest < low)
      belowRanges.push(`低于开盘 ${minutes} 分钟低点 ${formatPrice(low)}`)
  }
  if (aboveRanges.length > 0 || belowRanges.length > 0) {
    const facts = aboveRanges.length > 0 ? aboveRanges : belowRanges
    add(events, {
      id: aboveRanges.length > 0 ? 'above-opening-range' : 'below-opening-range',
      category: 'intraday',
      significance: facts.length === 2 ? 'strong' : 'notable',
      title: `当前价格${aboveRanges.length > 0 ? '站在开盘区间上方' : '位于开盘区间下方'}`,
      facts: [`最新价 ${formatPrice(latest)}`, ...facts],
      sourceIds: [
        'quote.latest',
        ...(aboveRanges.length > 0
          ? ['opening-range-15-high', 'opening-range-30-high']
          : ['opening-range-15-low', 'opening-range-30-low'])
      ]
    })
  }

  const volumeRatio = value(indicators, 'volume-ratio-5m')
  if (volumeRatio !== null && (volumeRatio >= 1.5 || volumeRatio <= 0.5)) {
    const priceVolumeState = indicators.get('price-volume-state')?.state ?? 'unknown'
    add(events, {
      id: volumeRatio >= 1.5 ? 'short-volume-expansion' : 'short-volume-contraction',
      category: 'intraday',
      significance: volumeRatio >= 2.3 ? 'strong' : 'notable',
      title: `最近 5 分钟成交量${volumeRatio >= 1.5 ? '明显放大' : '明显缩小'}`,
      facts: [
        `成交量为此前窗口中位数的 ${ratioText(volumeRatio)} 倍`,
        `量价状态 ${priceVolumeState}`
      ],
      sourceIds: ['volume-ratio-5m', 'price-volume-state']
    })
  }
}

function addTrendEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>,
  context: AiTAdviceTradingContext
): void {
  const latest = context.quote?.latest
  if (latest === null || latest === undefined) return
  const movingAverages = [5, 10, 20, 60].flatMap((period) => {
    const current = value(indicators, `ma${period}`)
    return current === null ? [] : [{ id: `ma${period}`, label: `MA${period}`, value: current }]
  })
  if (movingAverages.length >= 2) {
    const above = movingAverages.filter((item) => latest > item.value)
    const below = movingAverages.filter((item) => latest < item.value)
    const aligned = above.length === movingAverages.length || below.length === movingAverages.length
    add(events, {
      id: aligned
        ? above.length > 0
          ? 'above-all-moving-averages'
          : 'below-all-moving-averages'
        : 'mixed-moving-average-position',
      category: 'trend',
      significance: aligned && movingAverages.length >= 3 ? 'strong' : 'notable',
      title: aligned
        ? `当前价格位于全部可用均线${above.length > 0 ? '上方' : '下方'}`
        : '当前价格相对长短期均线位置分化',
      facts: movingAverages.map(
        (item) =>
          `${item.label} ${formatPrice(item.value)}，当前价相对该均线 ${formatPercent(deviationPercent(latest, item.value)!)}`
      ),
      sourceIds: ['quote.latest', ...movingAverages.map((item) => item.id)]
    })
  }

  const ema12 = value(indicators, 'ema12')
  const ema26 = value(indicators, 'ema26')
  if (ema12 !== null && ema26 !== null) {
    const gap = deviationPercent(ema12, ema26)!
    if (Math.abs(gap) >= 0.2) {
      add(events, {
        id: ema12 > ema26 ? 'ema12-above-ema26' : 'ema12-below-ema26',
        category: 'trend',
        title: `EMA12 位于 EMA26 ${ema12 > ema26 ? '上方' : '下方'}`,
        facts: [
          `EMA12 ${formatPrice(ema12)}`,
          `EMA26 ${formatPrice(ema26)}`,
          `两者偏离 ${formatPercent(gap)}`
        ],
        sourceIds: ['ema12', 'ema26']
      })
    }
  }

  const macd = value(indicators, 'macd')
  const signal = value(indicators, 'macd-signal')
  const histogram = value(indicators, 'macd-histogram')
  if (macd !== null && signal !== null && histogram !== null && histogram !== 0) {
    add(events, {
      id: histogram > 0 ? 'macd-above-signal' : 'macd-below-signal',
      category: 'trend',
      title: `MACD 位于信号线${histogram > 0 ? '上方' : '下方'}`,
      facts: [
        `MACD ${macd.toFixed(4)}`,
        `信号线 ${signal.toFixed(4)}`,
        `MACD 柱 ${histogram.toFixed(4)}`
      ],
      sourceIds: ['macd', 'macd-signal', 'macd-histogram']
    })
  }

  for (const [id, label] of [
    ['daily-volume-percentile-20', '成交量'],
    ['daily-turnover-percentile-20', '换手率']
  ] as const) {
    const percentile = value(indicators, id)
    if (percentile !== null && (percentile >= 80 || percentile <= 20)) {
      add(events, {
        id: `${id}-extreme`,
        category: 'trend',
        significance: percentile >= 95 || percentile <= 5 ? 'strong' : 'notable',
        title: `最近已完成交易日${label}处于 20 日${percentile >= 80 ? '高' : '低'}分位`,
        facts: [`20 日分位 ${percentile.toFixed(1)}%`],
        sourceIds: [id]
      })
    }
  }
}

function addMomentumEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>
): void {
  for (const [id, label] of [
    ['rsi6', 'RSI6'],
    ['rsi14', 'RSI14']
  ] as const) {
    const current = value(indicators, id)
    if (current !== null && (current >= 70 || current <= 30)) {
      add(events, {
        id: `${id}-${current >= 70 ? 'high' : 'low'}`,
        category: 'momentum',
        significance: current >= 80 || current <= 20 ? 'strong' : 'notable',
        title: `${label} 进入${current >= 70 ? '高值' : '低值'}区间`,
        facts: [`${label} ${current.toFixed(2)}`, `客观阈值 ${current >= 70 ? '≥ 70' : '≤ 30'}`],
        sourceIds: [id]
      })
    }
  }

  const k = value(indicators, 'kdj-k')
  const d = value(indicators, 'kdj-d')
  const j = value(indicators, 'kdj-j')
  if (k === null || d === null || j === null) return
  const high = k >= 80 && d >= 80
  const low = k <= 20 && d <= 20
  const jExtreme = j >= 100 || j <= 0
  if (high || low || jExtreme) {
    add(events, {
      id: high ? 'kdj-high-zone' : low ? 'kdj-low-zone' : 'kdj-j-extreme',
      category: 'momentum',
      significance: high || low ? 'strong' : 'notable',
      title: high
        ? 'KDJ 的 K、D 同时进入高值区间'
        : low
          ? 'KDJ 的 K、D 同时进入低值区间'
          : `KDJ J 值越过${j >= 100 ? ' 100' : ' 0'}边界`,
      facts: [
        `K ${k.toFixed(2)}`,
        `D ${d.toFixed(2)}`,
        `J ${j.toFixed(2)}`,
        `K-D ${(k - d).toFixed(2)}`
      ],
      sourceIds: ['kdj-k', 'kdj-d', 'kdj-j']
    })
  }
}

function addVolatilityEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>,
  context: AiTAdviceTradingContext
): void {
  const latest = context.quote?.latest
  const atr = value(indicators, 'atr14')
  if (latest !== null && latest !== undefined && atr !== null && latest > 0) {
    const atrPercent = (atr / latest) * 100
    if (atrPercent >= 3) {
      add(events, {
        id: 'atr-relative-range',
        category: 'volatility',
        significance: atrPercent >= 5 ? 'strong' : 'notable',
        title: 'ATR 占当前价格比例较高',
        facts: [`ATR14 ${formatPrice(atr)}`, `ATR14 占最新价 ${formatPercent(atrPercent)}`],
        sourceIds: ['atr14', 'quote.latest']
      })
    }
  }
  const realizedVolatility = value(indicators, 'realized-volatility-20')
  if (realizedVolatility !== null && realizedVolatility >= 50) {
    add(events, {
      id: 'high-realized-volatility',
      category: 'volatility',
      significance: realizedVolatility >= 80 ? 'strong' : 'notable',
      title: '20 日年化实现波动率处于较高数值',
      facts: [`20 日年化实现波动率 ${realizedVolatility.toFixed(2)}%`],
      sourceIds: ['realized-volatility-20']
    })
  }
}

function addOrderBookEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>
): void {
  const imbalance = value(indicators, 'order-book-imbalance')
  const change = value(indicators, 'order-book-imbalance-change')
  const hasImbalance = imbalance !== null && Math.abs(imbalance) >= 0.2
  const hasChange = change !== null && Math.abs(change) >= 0.2
  if (!hasImbalance && !hasChange) return
  const bidVolume = value(indicators, 'bid-volume')
  const askVolume = value(indicators, 'ask-volume')
  add(events, {
    id: hasImbalance
      ? imbalance! > 0
        ? 'visible-bid-imbalance'
        : 'visible-ask-imbalance'
      : 'order-book-imbalance-change',
    category: 'order-book',
    significance:
      (hasImbalance && Math.abs(imbalance!) >= 0.4) || (hasChange && Math.abs(change!) >= 0.35)
        ? 'strong'
        : 'notable',
    title: hasImbalance
      ? `五档可见委托量明显偏向${imbalance! > 0 ? '买方' : '卖方'}`
      : '五档委托不平衡较上一快照明显变化',
    facts: [
      ...(imbalance === null ? [] : [`当前委托不平衡 ${ratioText(imbalance)}`]),
      ...(change === null ? [] : [`较上一快照变化 ${change >= 0 ? '+' : ''}${ratioText(change)}`]),
      ...(bidVolume === null ? [] : [`买五档委托量 ${amountText(bidVolume)} 手`]),
      ...(askVolume === null ? [] : [`卖五档委托量 ${amountText(askVolume)} 手`])
    ],
    sourceIds: ['order-book-imbalance', 'order-book-imbalance-change', 'bid-volume', 'ask-volume']
  })
}

function addRelativeStrengthEvents(
  events: AiTAdviceObjectiveEvent[],
  indicators: Map<string, IndicatorValue>
): void {
  const relativeFacts: string[] = []
  const sourceIds: string[] = []
  let strongest = 0
  for (const [id, label] of [
    ['relative-sector', '相对行业'],
    ['relative-index', '相对大盘']
  ] as const) {
    const current = value(indicators, id)
    if (current === null || Math.abs(current) < 0.5) continue
    relativeFacts.push(`${label} ${formatPercent(current)}`)
    sourceIds.push(id)
    strongest = Math.max(strongest, Math.abs(current))
  }
  if (relativeFacts.length > 0) {
    add(events, {
      id: 'relative-strength-deviation',
      category: 'relative-strength',
      significance: strongest >= 2 ? 'strong' : 'notable',
      title: '个股相对行业或大盘出现明显偏离',
      facts: relativeFacts,
      sourceIds
    })
  }

  const funds = value(indicators, 'funds-main-net')
  const slope = value(indicators, 'funds-main-slope')
  if (funds !== null && slope !== null && (funds !== 0 || slope !== 0)) {
    const aligned = Math.sign(funds) === Math.sign(slope)
    add(events, {
      id: aligned ? 'funds-flow-aligned' : 'funds-flow-divergent',
      category: 'relative-strength',
      title: aligned ? '主力资金净额与短窗变化方向一致' : '主力资金净额与短窗变化方向分化',
      facts: [`当前主力资金净额 ${amountText(funds)}`, `短窗变化 ${amountText(slope)}`],
      sourceIds: ['funds-main-net', 'funds-main-slope']
    })
  }
}

function addPositionAndPlanEvents(
  events: AiTAdviceObjectiveEvent[],
  snapshot: MarketInsightSnapshot,
  context: AiTAdviceTradingContext
): void {
  const latest = context.quote?.latest
  if (latest === null || latest === undefined) return
  const positionCost = context.position?.cost
  if (positionCost !== undefined && positionCost > 0) {
    const deviation = deviationPercent(latest, positionCost)!
    if (Math.abs(deviation) >= 2) {
      add(events, {
        id: 'position-cost-deviation',
        category: 'position',
        significance: Math.abs(deviation) >= 5 ? 'strong' : 'notable',
        title: `当前价格位于持仓成本${deviation > 0 ? '上方' : '下方'}`,
        facts: [
          `持仓成本 ${formatPrice(positionCost)}`,
          `最新价相对持仓成本 ${formatPercent(deviation)}`
        ],
        sourceIds: ['position.cost', 'quote.latest']
      })
    }
  }

  const nearest = [...snapshot.existingTPlanDistances]
    .filter((item) => item.side !== 'position' && item.distancePercent !== null)
    .sort((left, right) => Math.abs(left.distancePercent!) - Math.abs(right.distancePercent!))[0]
  if (
    nearest?.distancePercent !== null &&
    nearest !== undefined &&
    Math.abs(nearest.distancePercent) <= 1
  ) {
    add(events, {
      id: 'near-t-plan-level',
      category: 't-plan',
      significance: Math.abs(nearest.distancePercent) <= 0.5 ? 'strong' : 'notable',
      title: '当前价格接近已有 T 计划档位',
      facts: [
        `${nearest.label} ${formatPrice(nearest.price)}`,
        `当前价相对该档位 ${formatPercent(nearest.distancePercent)}`,
        ...(nearest.quantity === null ? [] : [`档位数量 ${nearest.quantity} 股`])
      ],
      sourceIds: [`existingTPlanDistances.${nearest.id}`, 'quote.latest']
    })
  }
}

export function buildAiTAdviceObjectiveEvents(
  snapshot: MarketInsightSnapshot,
  context: AiTAdviceTradingContext
): AiTAdviceObjectiveEvent[] {
  const events: AiTAdviceObjectiveEvent[] = []
  const indicators = indicatorMap(snapshot)
  addQuoteEvents(events, context)
  addBollingerEvents(events, indicators, context)
  addIntradayEvents(events, indicators, context)
  addTrendEvents(events, indicators, context)
  addMomentumEvents(events, indicators)
  addVolatilityEvents(events, indicators, context)
  addOrderBookEvents(events, indicators)
  addRelativeStrengthEvents(events, indicators)
  addPositionAndPlanEvents(events, snapshot, context)
  return events.sort(
    (left, right) =>
      Number(right.significance === 'strong') - Number(left.significance === 'strong')
  )
}
