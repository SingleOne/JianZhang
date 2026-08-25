export type StockMarket = 'CN' | 'HK' | 'US'
export type StockExchange = 'SSE' | 'SZSE' | 'BSE' | 'HKEX' | 'NASDAQ' | 'NYSE' | 'AMEX'
export type StockCurrency = 'CNY' | 'HKD' | 'USD'
export type StockInstrumentType = 'stock' | 'etf'
export type StockVolumeUnit = 'lot' | 'share'

export interface StockMarketIdentity {
  market: StockMarket
  exchange: StockExchange
  currency: StockCurrency
  instrumentType: StockInstrumentType
  volumeUnit: StockVolumeUnit
}

export interface StockMarketCapabilities {
  position: boolean
  tTrading: boolean
  profitAlert: boolean
  radar: boolean
  sector: boolean
  fundamentals: boolean
  dividendFinancing: boolean
  companyReports: boolean
  shareholders: boolean
  fundsFlow: boolean
  marketInsight: boolean
  aiAnalysis: boolean
  aiTAdvice: boolean
  orderBook: boolean
  chipDistribution: boolean
}

export const STOCK_MARKET_LABELS: Record<StockMarket, string> = {
  CN: 'A股',
  HK: '港股',
  US: '美股'
}

export const STOCK_MARKET_TIME_ZONES: Record<StockMarket, string> = {
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  US: 'America/New_York'
}

export const STOCK_CURRENCY_SYMBOLS: Record<StockCurrency, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: 'US$'
}

const A_STOCK_CAPABILITIES: StockMarketCapabilities = {
  position: true,
  tTrading: true,
  profitAlert: true,
  radar: true,
  sector: true,
  fundamentals: true,
  dividendFinancing: true,
  companyReports: true,
  shareholders: true,
  fundsFlow: true,
  marketInsight: true,
  aiAnalysis: true,
  aiTAdvice: true,
  orderBook: true,
  chipDistribution: true
}

const GLOBAL_MARKET_CAPABILITIES: StockMarketCapabilities = {
  position: true,
  tTrading: false,
  profitAlert: true,
  radar: false,
  sector: false,
  fundamentals: false,
  dividendFinancing: false,
  companyReports: false,
  shareholders: false,
  fundsFlow: false,
  marketInsight: false,
  aiAnalysis: false,
  aiTAdvice: false,
  orderBook: false,
  chipDistribution: false
}

export const STOCK_MARKET_CAPABILITIES: Record<StockMarket, StockMarketCapabilities> = {
  CN: A_STOCK_CAPABILITIES,
  HK: GLOBAL_MARKET_CAPABILITIES,
  US: GLOBAL_MARKET_CAPABILITIES
}

export function marketFromQuoteId(quoteId: string): StockMarket {
  const marketId = quoteId.split('.')[0]
  if (marketId === '116') return 'HK'
  if (marketId === '105' || marketId === '106' || marketId === '107') return 'US'
  return 'CN'
}

export function exchangeFromQuoteId(quoteId: string): StockExchange {
  const [marketId, code = ''] = quoteId.split('.')
  if (marketId === '116') return 'HKEX'
  if (marketId === '105') return 'NASDAQ'
  if (marketId === '106') return 'NYSE'
  if (marketId === '107') return 'AMEX'
  if (marketId === '1') return 'SSE'
  return /^(4|8|92)/.test(code) ? 'BSE' : 'SZSE'
}

export function currencyForMarket(market: StockMarket): StockCurrency {
  if (market === 'HK') return 'HKD'
  if (market === 'US') return 'USD'
  return 'CNY'
}

export function volumeUnitForMarket(market: StockMarket): StockVolumeUnit {
  return market === 'CN' ? 'lot' : 'share'
}

export function marketLabelForQuoteId(quoteId: string): string {
  const exchange = exchangeFromQuoteId(quoteId)
  if (exchange === 'HKEX') return '港股'
  if (exchange === 'NASDAQ') return '纳斯达克'
  if (exchange === 'NYSE') return '纽交所'
  if (exchange === 'AMEX') return '美交所'
  if (exchange === 'SSE') return '沪A'
  if (exchange === 'BSE') return '北交所'
  return '深A'
}

export function stockMarketIdentity(
  quoteId: string,
  instrumentType: StockInstrumentType = 'stock'
): StockMarketIdentity {
  const market = marketFromQuoteId(quoteId)
  return {
    market,
    exchange: exchangeFromQuoteId(quoteId),
    currency: currencyForMarket(market),
    instrumentType,
    volumeUnit: volumeUnitForMarket(market)
  }
}

export function isAStockQuoteId(quoteId: string): boolean {
  return marketFromQuoteId(quoteId) === 'CN'
}

export function marketCapabilitiesForQuoteId(quoteId: string): StockMarketCapabilities {
  return STOCK_MARKET_CAPABILITIES[marketFromQuoteId(quoteId)]
}
