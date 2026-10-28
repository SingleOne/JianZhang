export const MARKET_CHANGE_BUCKETS = [
  { label: '跌停', range: '跌停股票', keys: [-11], direction: 'down' },
  { label: '低于-8%', range: '低于 -8%，不含跌停', keys: [-10, -9], direction: 'down' },
  { label: '-8~-6%', range: '-8% 至 -6%，不含跌停', keys: [-8, -7], direction: 'down' },
  { label: '-6~-4%', range: '-6% 至 -4%，不含跌停', keys: [-6, -5], direction: 'down' },
  { label: '-4~-2%', range: '-4% 至 -2%，不含跌停', keys: [-4, -3], direction: 'down' },
  { label: '-2~0%', range: '-2% 至 0%，不含平盘、跌停', keys: [-2, -1], direction: 'down' },
  { label: '平盘', range: '涨跌幅为 0%', keys: [0], direction: 'flat' },
  { label: '0~2%', range: '0% 至 2%，不含平盘、涨停', keys: [1, 2], direction: 'up' },
  { label: '2~4%', range: '2% 至 4%，不含涨停', keys: [3, 4], direction: 'up' },
  { label: '4~6%', range: '4% 至 6%，不含涨停', keys: [5, 6], direction: 'up' },
  { label: '6~8%', range: '6% 至 8%，不含涨停', keys: [7, 8], direction: 'up' },
  { label: '高于8%', range: '高于 8%，不含涨停', keys: [9, 10], direction: 'up' },
  { label: '涨停', range: '涨停股票', keys: [11], direction: 'up' }
] as const

export interface EastmoneyMarketChangeData {
  qdate: number
  fenbu: Record<string, number>[]
}

export interface MarketChangeDistribution {
  fetchedAt: string
  tradingDate: string
  total: number
  rising: number
  falling: number
  flat: number
  limitUp: number
  limitDown: number
  counts: number[]
}

export function parseMarketChangeDistribution(
  data: EastmoneyMarketChangeData,
  fetchedAt: string
): MarketChangeDistribution {
  const buckets = new Map(data.fenbu.flatMap((bucket) => Object.entries(bucket)))
  const values = Array.from({ length: 23 }, (_, index) => buckets.get(String(index - 11)))
  if (values.some((count) => count === undefined || !Number.isInteger(count) || count < 0)) {
    throw new Error('涨跌分布数据不完整，请稍后刷新重试')
  }
  // The official page maps +/-11 to limit-up/down, not to +/-11% price changes.
  const count = (key: number) => buckets.get(String(key))!
  const rising = Array.from({ length: 11 }, (_, index) => count(index + 1)).reduce(
    (a, b) => a + b,
    0
  )
  const falling = Array.from({ length: 11 }, (_, index) => count(-index - 1)).reduce(
    (a, b) => a + b,
    0
  )
  const flat = count(0)
  const date = String(data.qdate)
  return {
    fetchedAt,
    tradingDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    total: rising + falling + flat,
    rising,
    falling,
    flat,
    limitUp: count(11),
    limitDown: count(-11),
    counts: MARKET_CHANGE_BUCKETS.map((bucket) =>
      bucket.keys.reduce<number>((sum, key) => sum + count(key), 0)
    )
  }
}
