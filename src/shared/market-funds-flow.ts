import { marketDateKey } from './market-hours'

const FUNDS_FLOW_QUOTE_IDS = ['1.000001', '0.399001']
export const A_SHARE_TURNOVER_QUOTE_IDS = ['1.000002', '0.399107'] as const
export const EASTMONEY_MARKET_OVERVIEW_QUOTE_IDS = [
  ...FUNDS_FLOW_QUOTE_IDS,
  ...A_SHARE_TURNOVER_QUOTE_IDS
]

export interface EastmoneyMarketFundsFlowItem {
  f5?: number | '-'
  f6?: number | '-'
  f12?: string
  f13?: number
  f62?: number | '-'
  f64?: number | '-'
  f65?: number | '-'
  f70?: number | '-'
  f71?: number | '-'
  f124?: number | '-'
}

export interface MarketFundsFlow {
  fetchedAt: string
  dataAt: string
  tradingDate: string
  totalVolumeLots: number | null
  totalTurnoverAmount: number | null
  mainInflow: number
  mainOutflow: number
  mainNetInflow: number
}

export const MARKET_TURNOVER_RANGES = [20, 60] as const

export interface MarketTurnoverPoint {
  date: string
  amount: number
}

export interface MarketTurnoverHistory {
  fetchedAt: string
  source: 'eastmoney-primary' | 'eastmoney-mirror' | 'tencent'
  points: MarketTurnoverPoint[]
}

function readAmount(value: number | '-' | undefined, signed = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0)) {
    throw new Error('主力资金数据不完整，请稍后刷新重试')
  }
  return value
}

function readQuoteDate(timestamp: EastmoneyMarketFundsFlowItem['f124']): Date | null {
  if (typeof timestamp !== 'number' || timestamp <= 0) return null
  const date = new Date(timestamp * 1000)
  return Number.isFinite(date.getTime()) ? date : null
}

function sumTurnoverField(
  quotes: (EastmoneyMarketFundsFlowItem | undefined)[],
  field: 'f5' | 'f6'
): number | null {
  let total = 0
  for (const quote of quotes) {
    const value = quote?.[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
    total += value
  }
  return total
}

export function parseMarketFundsFlow(
  items: EastmoneyMarketFundsFlowItem[],
  fetchedAt: string
): MarketFundsFlow {
  const quotes = new Map(items.map((item) => [`${item.f13}.${item.f12}`, item]))
  // Match the official Shanghai/Shenzhen page, without double-counting
  // constituent indices. Main funds comprise super-large and large orders; amounts are yuan.
  // Source: https://data.eastmoney.com/zjlx/dpzjlx.html
  const markets = FUNDS_FLOW_QUOTE_IDS.map((quoteId) => {
    const item = quotes.get(quoteId)
    if (!item) throw new Error('沪深资金数据不完整，请稍后刷新重试')
    const date = readQuoteDate(item.f124)
    if (!date) throw new Error('主力资金数据时间无效，请稍后刷新重试')
    return {
      timestamp: date.getTime(),
      tradingDate: marketDateKey(date, 'CN'),
      inflow: readAmount(item.f64) + readAmount(item.f70),
      outflow: readAmount(item.f65) + readAmount(item.f71),
      netInflow: readAmount(item.f62, true)
    }
  })
  if (markets[0].tradingDate !== markets[1].tradingDate) {
    throw new Error('沪深资金数据日期不一致，请稍后刷新重试')
  }
  const tradingDate = markets[0].tradingDate
  // Use the same Shanghai/Shenzhen A-share quotes for f5 (lots) and f6 (yuan).
  const turnoverQuotes = A_SHARE_TURNOVER_QUOTE_IDS.map((quoteId) => {
    const item = quotes.get(quoteId)
    const date = readQuoteDate(item?.f124)
    return date && marketDateKey(date, 'CN') === tradingDate ? item : undefined
  })
  return {
    fetchedAt,
    dataAt: new Date(Math.min(...markets.map((market) => market.timestamp))).toISOString(),
    tradingDate,
    totalVolumeLots: sumTurnoverField(turnoverQuotes, 'f5'),
    totalTurnoverAmount: sumTurnoverField(turnoverQuotes, 'f6'),
    mainInflow: markets.reduce((sum, market) => sum + market.inflow, 0),
    mainOutflow: markets.reduce((sum, market) => sum + market.outflow, 0),
    mainNetInflow: markets.reduce((sum, market) => sum + market.netInflow, 0)
  }
}
