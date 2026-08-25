import type {
  MarketTradeFeeSettings,
  StockCurrency,
  StockMarket,
  StockPosition,
  TTradeRecord,
  TTradeSide,
  TradeFeeItem,
  TradeFeeTemplateSnapshot,
  TradingCalendarSettings
} from '../shared/types'
import { marketTradingCalendar } from '../shared/types'
import { isMarketTradingDate, marketDateKey } from '../shared/market-hours'
import { sortTradeRecords } from './trade-records'
import { roundMoney, totalRecordedTradeFees } from './t-trading'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

export interface MarketSettlementRule extends TradeFeeTemplateSnapshot {
  settlementTradingDays: number
}

export const MARKET_SETTLEMENT_RULES: Record<StockMarket, readonly MarketSettlementRule[]> = {
  CN: [
    {
      id: 'cn-standard-settlement',
      version: '2026.1',
      label: 'A股 T+1',
      effectiveFrom: '1990-01-01',
      settlementTradingDays: 1
    }
  ],
  HK: [
    {
      id: 'hkex-standard-settlement',
      version: '2026.1',
      label: '港股 T+2',
      effectiveFrom: '1990-01-01',
      settlementTradingDays: 2
    }
  ],
  US: [
    {
      id: 'us-standard-settlement',
      version: 'legacy-t3',
      label: '美股 T+3',
      effectiveFrom: '1900-01-01',
      settlementTradingDays: 3
    },
    {
      id: 'us-standard-settlement',
      version: '2017.1',
      label: '美股 T+2',
      effectiveFrom: '2017-09-05',
      settlementTradingDays: 2
    },
    {
      id: 'us-standard-settlement',
      version: '2024.1',
      label: '美股 T+1',
      effectiveFrom: '2024-05-28',
      settlementTradingDays: 1
    }
  ]
}

export const MARKET_FEE_TEMPLATES: Record<'HK' | 'US', TradeFeeTemplateSnapshot> = {
  HK: {
    id: 'hkex-equity-fees',
    version: '2026.1',
    label: '港股官方费用参考',
    effectiveFrom: '2025-06-30'
  },
  US: {
    id: 'us-equity-regulatory-fees',
    version: '2026.1',
    label: '美股监管费用参考',
    effectiveFrom: '2026-04-04'
  }
}

export interface MarketTradeFeeOptions {
  stampDutyExempt?: boolean
}

export interface MarketLedgerMetrics {
  position?: StockPosition
  realizedProfit: number
  realizedProfitCny: number | null
  totalFees: number
  totalFeesCny: number | null
  error?: string
}

function feeItem(code: TradeFeeItem['code'], label: string, amount: number): TradeFeeItem | null {
  const rounded = roundMoney(amount)
  return rounded > 0 ? { code, label, amount: rounded } : null
}

function compactFees(items: Array<TradeFeeItem | null>): TradeFeeItem[] {
  return items.filter((item): item is TradeFeeItem => item !== null)
}

export function calculateMarketTradeFeeItems(
  market: StockMarket,
  amount: number,
  quantity: number,
  side: TTradeSide,
  settings: MarketTradeFeeSettings,
  options: MarketTradeFeeOptions = {}
): TradeFeeItem[] {
  if (market === 'HK') {
    const brokerageRate = settings.HK.brokerageRatePercent / 100
    const brokerage =
      brokerageRate > 0 ? Math.max(settings.HK.minimumBrokerage, amount * brokerageRate) : 0
    return compactFees([
      feeItem('brokerage', '券商佣金', brokerage),
      feeItem('platform', '平台费', settings.HK.platformFee),
      feeItem('sfc-levy', '证监会交易征费', amount * 0.000027),
      feeItem('afrc-levy', '财汇局交易征费', amount * 0.0000015),
      feeItem('hkex-trading', '港交所交易费', amount * 0.0000565),
      options.stampDutyExempt
        ? null
        : feeItem('stamp-duty', '股票印花税', Math.ceil(amount * 0.001)),
      settings.HK.includeSettlementFee ? feeItem('settlement', '交收费', amount * 0.000042) : null
    ])
  }

  if (market === 'US') {
    const commission =
      settings.US.commissionPerShare > 0
        ? Math.max(settings.US.minimumCommission, quantity * settings.US.commissionPerShare)
        : 0
    return compactFees([
      feeItem('brokerage', '券商佣金', commission),
      feeItem('platform', '平台费', settings.US.platformFee),
      side === 'sell' && settings.US.includeSecFee
        ? feeItem('sec-section-31', 'SEC Section 31', (amount * 20.6) / 1_000_000)
        : null,
      side === 'sell' && settings.US.includeFinraTaf
        ? feeItem('finra-taf', 'FINRA TAF', Math.min(9.79, quantity * 0.000195))
        : null
    ])
  }

  return []
}

export function totalTradeFeeItems(items: readonly TradeFeeItem[] | undefined): number {
  return roundMoney((items ?? []).reduce((total, item) => total + item.amount, 0))
}

export function settlementRuleForTradeDate(
  market: StockMarket,
  tradeDate: string
): MarketSettlementRule {
  const rules = MARKET_SETTLEMENT_RULES[market]
  return [...rules].reverse().find((rule) => rule.effectiveFrom <= tradeDate) ?? rules[0]
}

export function estimateSettlementDate(
  market: StockMarket,
  tradeDate: string,
  settings: TradingCalendarSettings
): string {
  const rule = settlementRuleForTradeDate(market, tradeDate)
  const calendar = marketTradingCalendar(settings, market)
  const start = new Date(`${tradeDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return ''
  let tradingDays = 0
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = new Date(start.getTime() + offset * DAY_MILLISECONDS)
      .toISOString()
      .slice(0, 10)
    if (!isMarketTradingDate(market, candidate, calendar)) continue
    tradingDays += 1
    if (tradingDays === rule.settlementTradingDays) return candidate
  }
  return ''
}

export function marketTradeQuantityError(
  market: StockMarket,
  quantity: number
): string | undefined {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    return '成交数量必须是正整数股'
  }
  if (market === 'CN' && quantity % 100 !== 0) {
    return 'A股成交数量必须是 100 股的整数倍'
  }
  return undefined
}

function tradeRate(record: TTradeRecord, currency: StockCurrency): number | null {
  if (currency === 'CNY') return 1
  return record.exchangeRate && record.exchangeRate > 0 ? record.exchangeRate : null
}

export function calculateMarketLedgerMetrics(
  records: readonly TTradeRecord[],
  market: StockMarket,
  currency: StockCurrency
): MarketLedgerMetrics {
  let quantity = 0
  let nativeCostBasis = 0
  let cnyCostBasis = 0
  let hasCompleteCnyBasis = true
  let realizedProfit = 0
  let realizedProfitCny = 0
  let totalFees = 0
  let totalFeesCny = 0
  let hasCompleteCnyFees = true
  let openedOn: string | undefined

  for (const record of sortTradeRecords(records, 'ascending')) {
    const fees = totalRecordedTradeFees(record)
    const amount = record.price * record.quantity
    const rate = tradeRate(record, currency)
    totalFees += fees
    if (rate === null) hasCompleteCnyFees = false
    else totalFeesCny += fees * rate

    if (record.side === 'buy') {
      quantity += record.quantity
      nativeCostBasis += amount + fees
      if (rate === null) hasCompleteCnyBasis = false
      else cnyCostBasis += (amount + fees) * rate
      openedOn ??= record.marketDate ?? record.tradedAt.slice(0, 10)
      continue
    }

    if (record.quantity > quantity) {
      return {
        realizedProfit: roundMoney(realizedProfit),
        realizedProfitCny: hasCompleteCnyBasis ? roundMoney(realizedProfitCny) : null,
        totalFees: roundMoney(totalFees),
        totalFeesCny: hasCompleteCnyFees ? roundMoney(totalFeesCny) : null,
        error: '卖出数量不能超过交易流水中的可用持仓数量'
      }
    }

    const averageNativeCost = quantity > 0 ? nativeCostBasis / quantity : 0
    const allocatedNativeCost = averageNativeCost * record.quantity
    const averageCnyCost = quantity > 0 ? cnyCostBasis / quantity : 0
    const allocatedCnyCost = averageCnyCost * record.quantity
    realizedProfit += amount - fees - allocatedNativeCost
    if (rate === null || !hasCompleteCnyBasis) hasCompleteCnyBasis = false
    else realizedProfitCny += (amount - fees) * rate - allocatedCnyCost
    quantity -= record.quantity
    nativeCostBasis -= allocatedNativeCost
    cnyCostBasis -= allocatedCnyCost
  }

  const position =
    quantity > 0
      ? {
          quantity,
          cost: nativeCostBasis / quantity,
          openedToday: openedOn === marketDateKey(new Date(), market),
          openedOn,
          currency,
          costExchangeRate:
            hasCompleteCnyBasis && nativeCostBasis > 0 ? cnyCostBasis / nativeCostBasis : undefined,
          costExchangeRateDate: sortTradeRecords(records)[0]?.exchangeRateDate
        }
      : undefined

  return {
    position,
    realizedProfit: roundMoney(realizedProfit),
    realizedProfitCny: hasCompleteCnyBasis ? roundMoney(realizedProfitCny) : null,
    totalFees: roundMoney(totalFees),
    totalFeesCny: hasCompleteCnyFees ? roundMoney(totalFeesCny) : null
  }
}
