import type { StockInstrumentType, StockMarket } from '../shared/stock-market'

export interface TPlanPriceRule {
  market: StockMarket
  instrumentType?: StockInstrumentType
}

interface HongKongSpreadBand {
  upper: number
  tick: number
}

// HKEX spread table 01, phase 2 effective 2026-08-03.
// https://www.hkex.com.hk/Services/Trading/Securities/Overview/Trading-Mechanism/Reduction-of-Minimum-Spreads
const HK_STOCK_BANDS: readonly HongKongSpreadBand[] = [
  { upper: 0.25, tick: 0.001 },
  { upper: 10, tick: 0.005 },
  { upper: 20, tick: 0.01 },
  { upper: 50, tick: 0.02 },
  { upper: 100, tick: 0.05 },
  { upper: 200, tick: 0.1 },
  { upper: 500, tick: 0.2 },
  { upper: 1000, tick: 0.5 },
  { upper: 2000, tick: 1 },
  { upper: 5000, tick: 2 },
  { upper: 9995, tick: 5 }
]

// HKEX ETP spread table, which applies unless a product uses an approved exception.
// https://www.hkex.com.hk/Products/Securities/Exchange-Traded-Products/Investors
const HK_ETF_BANDS: readonly HongKongSpreadBand[] = [
  { upper: 0.25, tick: 0.001 },
  { upper: 0.5, tick: 0.005 },
  { upper: 1, tick: 0.01 },
  { upper: 5, tick: 0.002 },
  { upper: 10, tick: 0.005 },
  { upper: 20, tick: 0.01 },
  { upper: 100, tick: 0.02 },
  { upper: 200, tick: 0.05 },
  { upper: 500, tick: 0.1 },
  { upper: 1000, tick: 0.2 },
  { upper: 2000, tick: 0.5 },
  { upper: 5000, tick: 1 },
  { upper: 9999, tick: 5 }
]

function hongKongPlanPrice(
  rawPrice: number,
  side: 'buy' | 'sell',
  instrumentType: StockInstrumentType
): number | null {
  const bands = instrumentType === 'etf' ? HK_ETF_BANDS : HK_STOCK_BANDS
  const rawUnits = rawPrice * 1000
  if (rawUnits < 10 || rawUnits > bands[bands.length - 1].upper * 1000) return null

  let lowerUnits = 0
  let floorUnits: number | null = null
  for (const band of bands) {
    const upperUnits = Math.round(band.upper * 1000)
    const stepUnits = Math.round(band.tick * 1000)
    const firstUnits = Math.max(10, Math.ceil((lowerUnits + 1) / stepUnits) * stepUnits)
    const lastUnits = Math.floor(upperUnits / stepUnits) * stepUnits
    if (side === 'sell') {
      const candidate = Math.max(firstUnits, Math.ceil((rawUnits - 1e-8) / stepUnits) * stepUnits)
      if (candidate <= lastUnits) return candidate / 1000
    } else {
      const candidate = Math.min(lastUnits, Math.floor((rawUnits + 1e-8) / stepUnits) * stepUnits)
      if (candidate >= firstUnits) floorUnits = candidate
      if (rawUnits <= upperUnits) return floorUnits === null ? null : floorUnits / 1000
    }
    lowerUnits = upperUnits
  }
  return null
}

export function tPlanTradablePrice(
  rawPrice: number,
  side: 'buy' | 'sell',
  rule?: TPlanPriceRule
): number | null {
  if (!Number.isFinite(rawPrice)) return null
  if (rawPrice <= 0 && (rule?.market === 'HK' || rule?.market === 'US')) return null
  if (rule?.market === 'HK') {
    return hongKongPlanPrice(rawPrice, side, rule.instrumentType ?? 'stock')
  }
  return rawPrice
}
