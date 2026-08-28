import { describe, expect, it } from 'vitest'
import type {
  ExchangeRateSettings,
  PortfolioLedgerEntry,
  StockQuote,
  TTradeFees,
  TTradingAccount,
  WatchStock
} from '../shared/types'
import { calculatePortfolioPerformanceReport } from './portfolio-performance'

const NO_FEES: TTradeFees = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function trade(
  id: string,
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  exchangeRate: number | undefined,
  fees: number
): PortfolioLedgerEntry {
  const tradedAt = side === 'buy' ? '2026-01-02T02:00:00.000Z' : '2026-03-02T02:00:00.000Z'
  return {
    id: `trade:${id}`,
    accountId: '116.00700',
    quoteId: '116.00700',
    occurredAt: tradedAt,
    marketDate: tradedAt.slice(0, 10),
    source: 'trade',
    currency: 'HKD',
    exchangeRate,
    kind: 'trade',
    record: {
      id,
      side,
      purpose: 'base',
      tradedAt,
      price,
      quantity,
      fees: { ...NO_FEES, commission: fees },
      market: 'HK',
      currency: 'HKD',
      exchangeRate,
      note: id
    }
  }
}

function cashEntry(
  kind: 'cashDividend' | 'withholdingTax' | 'corporateActionFee' | 'cashAdjustment',
  amount: number
): PortfolioLedgerEntry {
  const base = {
    id: `${kind}:${amount}`,
    accountId: '116.00700',
    quoteId: '116.00700',
    occurredAt: '2026-04-01T02:00:00.000Z',
    marketDate: '2026-04-01',
    source: 'corporateAction' as const,
    currency: 'HKD' as const,
    exchangeRate: 0.91
  }
  if (kind === 'cashDividend') {
    return { ...base, kind, amount, eligibleQuantity: 60, amountPerShare: amount / 60 }
  }
  if (kind === 'cashAdjustment') return { ...base, kind, amount, reason: 'capitalReturn' }
  return { ...base, kind, amount }
}

function account(entries: PortfolioLedgerEntry[]): TTradingAccount {
  return {
    quoteId: '116.00700',
    code: '00700',
    name: '腾讯控股',
    market: 'HK',
    currency: 'HKD',
    history: [],
    ledger: { schemaVersion: 1, entries },
    tradeRecords: entries.flatMap((entry) => (entry.kind === 'trade' ? [entry.record] : []))
  }
}

function stock(quantity = 60): WatchStock {
  return {
    quoteId: '116.00700',
    code: '00700',
    name: '腾讯控股',
    marketLabel: '港股',
    market: 'HK',
    currency: 'HKD',
    showInTaskbar: true,
    isPriority: true,
    showRadarSignals: true,
    position: { quantity, cost: 10, openedToday: false, currency: 'HKD' }
  }
}

function quote(latest = 12): StockQuote {
  return {
    quoteId: '116.00700',
    code: '00700',
    name: '腾讯控股',
    market: 'HK',
    currency: 'HKD',
    latest,
    change: 0,
    changePercent: 0,
    open: latest,
    high: latest,
    low: latest,
    previousClose: latest,
    volume: 0,
    amount: 0,
    turnoverRate: 0,
    updatedAt: '2026-05-01T02:00:00.000Z'
  }
}

function exchangeRates(hkd: number | null = 0.92): ExchangeRateSettings {
  return {
    baseCurrency: 'CNY',
    rates: { CNY: 1, HKD: hkd, USD: null },
    manualOverrides: {},
    rateDate: '2026-05-01',
    fetchedAt: '2026-05-01T01:00:00.000Z',
    lastCheckedDate: '2026-05-01',
    lastAttemptedAt: '2026-05-01T01:00:00.000Z',
    lastError: null,
    source: 'safe-cfets'
  }
}

describe('portfolio performance report', () => {
  it('separates profit categories and reconciles price and FX contribution', () => {
    const entries = [
      trade('buy', 'buy', 100, 10, 0.9, 5),
      trade('sell', 'sell', 40, 15, 0.95, 3),
      cashEntry('cashDividend', 100),
      cashEntry('withholdingTax', 10),
      cashEntry('corporateActionFee', 2),
      cashEntry('cashAdjustment', 20)
    ]
    const report = calculatePortfolioPerformanceReport(
      [stock()],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )
    const result = report.stocks[0]

    expect(result.native[0]).toMatchObject({
      currency: 'HKD',
      realizedProfit: 200,
      unrealizedProfit: 120,
      dividendIncome: 100,
      withholdingTax: 10,
      tradeFees: 8,
      corporateActionFees: 2,
      corporateActionIncome: 20,
      totalProfit: 420
    })
    expect(result.cny).toMatchObject({
      realizedProfit: 210,
      unrealizedProfit: 122.4,
      dividendIncome: 91,
      withholdingTax: 9.1,
      tradeFees: 7.35,
      corporateActionFees: 1.82,
      corporateActionIncome: 18.2,
      totalProfit: 423.33,
      priceContribution: 288,
      exchangeRateContribution: 44.4
    })
    expect((result.cny.realizedProfit ?? 0) + (result.cny.unrealizedProfit ?? 0)).toBe(
      (result.cny.priceContribution ?? 0) + (result.cny.exchangeRateContribution ?? 0)
    )
  })

  it('excludes a stock from CNY totals when its historical rate is missing', () => {
    const entries = [trade('buy', 'buy', 100, 10, undefined, 0)]
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(report.stocks[0].native[0].unrealizedProfit).toBe(200)
    expect(report.stocks[0].cny.totalProfit).toBeNull()
    expect(report.stocks[0].issues).toContain('missingHistoricalRate')
    expect(report.portfolioRow.includedStockCount).toBe(0)
    expect(report.portfolioRow.excludedStockCount).toBe(1)
    expect(report.portfolioRow.cny.totalProfit).toBeNull()
  })

  it('marks current FX and quote gaps instead of filling them with another value', () => {
    const entries = [trade('buy', 'buy', 100, 10, 0.9, 0)]
    const missingRate = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates(null)
    )
    const missingQuote = calculatePortfolioPerformanceReport(
      [stock(100)],
      [],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(missingRate.stocks[0].issues).toContain('missingCurrentRate')
    expect(missingRate.stocks[0].cny.unrealizedProfit).toBeNull()
    expect(missingQuote.stocks[0].issues).toContain('missingQuote')
    expect(missingQuote.stocks[0].native[0].unrealizedProfit).toBeNull()
  })

  it('uses a manual position adjustment as the new quantity and cost basis', () => {
    const adjustment: PortfolioLedgerEntry = {
      id: 'position-adjustment:manual',
      accountId: '116.00700',
      quoteId: '116.00700',
      occurredAt: '2026-04-02T02:00:00.000Z',
      marketDate: '2026-04-02',
      source: 'manual',
      currency: 'HKD',
      exchangeRate: 0.9,
      kind: 'positionAdjustment',
      quantityBefore: 100,
      quantityAfter: 80,
      costBefore: 10,
      costAfter: 11,
      openedOnAfter: '2026-01-02'
    }
    const report = calculatePortfolioPerformanceReport(
      [stock(80)],
      [quote()],
      { '116.00700': account([trade('buy', 'buy', 100, 10, 0.9, 0), adjustment]) },
      exchangeRates()
    )

    expect(report.stocks[0].native[0]).toMatchObject({
      realizedProfit: 0,
      unrealizedProfit: 80,
      totalProfit: 80
    })
    expect(report.stocks[0].issues).not.toContain('positionMismatch')
  })

  it('provides stock, market, default-account, currency and portfolio groups', () => {
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account([trade('buy', 'buy', 100, 10, 0.9, 0)]) },
      exchangeRates()
    )

    expect(report.stockRows.map((row) => row.label)).toEqual(['腾讯控股'])
    expect(report.marketRows.map((row) => row.label)).toEqual(['港股'])
    expect(report.accountRows.map((row) => row.label)).toEqual(['默认账户'])
    expect(report.currencyRows.map((row) => row.label)).toEqual(['HKD'])
    expect(report.portfolioRow.label).toBe('全部组合')
    expect(report.accountReturnAvailable).toBe(false)
  })

  it('applies a per-stock CNY adjustment to every aggregate without changing native profit', () => {
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account([trade('buy', 'buy', 100, 10, 0.9, 0)]) },
      exchangeRates(),
      { '116.00700': 25.5 }
    )

    expect(report.stocks[0].native[0].totalProfit).toBe(200)
    expect(report.stocks[0].cny.manualAdjustment).toBe(25.5)
    expect(report.stockRows[0].cny.manualAdjustment).toBe(25.5)
    expect(report.currencyRows[0].cny.manualAdjustment).toBe(25.5)
    expect(report.portfolioRow.cny.manualAdjustment).toBe(25.5)
    expect(report.portfolioRow.cny.totalProfit).toBe(229.5)
  })
})
