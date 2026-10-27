import { describe, expect, it } from 'vitest'
import type {
  ExchangeRateSettings,
  PortfolioLedgerEntry,
  StockQuote,
  TTradeFees,
  TTradingAccount,
  WatchStock
} from '../shared/types'
import {
  calculateCurrentPositionProfitOverride,
  calculatePortfolioPerformanceCycles,
  calculatePortfolioPerformanceReport
} from './portfolio-performance'

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
  fees: number,
  tradedAt = side === 'buy' ? '2026-01-02T02:00:00.000Z' : '2026-03-02T02:00:00.000Z'
): PortfolioLedgerEntry {
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

describe('current position profit', () => {
  it('sums only holding accounts while keeping closed cycles in cumulative performance', () => {
    const closed = {
      ...account([
        trade('closed-buy', 'buy', 100, 10, 0.9, 5),
        trade('close', 'sell', 100, 15, 0.95, 5)
      ]),
      accountId: 'closed'
    }
    const firstHolding = {
      ...account([trade('first-buy', 'buy', 60, 11, 0.91, 2)]),
      accountId: 'first',
      position: stock(60).position
    }
    const secondHolding = {
      ...account([trade('second-buy', 'buy', 40, 10, 0.9, 1)]),
      accountId: 'second',
      position: stock(40).position
    }
    const book = {
      quoteId: '116.00700',
      accounts: { closed, first: firstHolding, second: secondHolding }
    }

    expect(
      calculateCurrentPositionProfitOverride(stock(100), quote(), book, exchangeRates())
    ).toEqual({ totalProfit: 137, cnyTotalProfit: 140.68 })

    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': book },
      exchangeRates()
    )
    expect(report.stockRows[0].cumulative.native[0].totalProfit).toBe(627)
    expect(report.stockRows[0].cumulative.cny.totalProfit).toBe(656.43)
    for (const row of [
      ...report.stockRows,
      ...report.marketRows,
      ...report.currencyRows,
      report.portfolioRow
    ]) {
      expect(row.currentCycle).toMatchObject({
        stockCount: 1,
        includedStockCount: 1,
        excludedStockCount: 0,
        cny: { realizedProfit: 0, unrealizedProfit: 143.4, tradeFees: 2.72, totalProfit: 140.68 }
      })
      expect(row.currentCycle.native[0].totalProfit).toBe(137)
    }
    expect(report.accountRows.find((row) => row.id === 'first')?.currentCycle.cny.totalProfit).toBe(
      59.98
    )
    expect(
      report.accountRows.find((row) => row.id === 'second')?.currentCycle.cny.totalProfit
    ).toBe(80.7)
    expect(report.accountRows.find((row) => row.id === 'closed')?.currentCycle).toMatchObject({
      stockCount: 0,
      excludedStockCount: 0,
      cny: { totalProfit: 0 }
    })
    const cycles = calculatePortfolioPerformanceCycles(stock(0), quote(), closed, exchangeRates())
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({ status: 'closed', cny: { totalProfit: 515.75 } })
  })

  it('preserves the legacy single-account position and the latest closed-cycle result', () => {
    const entries = [trade('buy', 'buy', 100, 10, 0.9, 5)]
    expect(
      calculateCurrentPositionProfitOverride(stock(100), quote(), account(entries), exchangeRates())
    ).toEqual({ totalProfit: 195, cnyTotalProfit: 199.5 })

    const closed = {
      ...account([...entries, trade('close', 'sell', 100, 15, 0.95, 5)]),
      accountId: 'closed'
    }
    const noPosition = { ...stock(), position: undefined }
    expect(
      calculateCurrentPositionProfitOverride(noPosition, quote(), closed, exchangeRates())
    ).toEqual({ totalProfit: 490, cnyTotalProfit: 515.75 })
  })
})

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

    expect(result.currentCycle.native[0]).toMatchObject({
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
    expect(result.currentCycle.cny).toMatchObject({
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
    expect(
      (result.currentCycle.cny.realizedProfit ?? 0) +
        (result.currentCycle.cny.unrealizedProfit ?? 0)
    ).toBe(
      (result.currentCycle.cny.priceContribution ?? 0) +
        (result.currentCycle.cny.exchangeRateContribution ?? 0)
    )
    for (const row of [
      ...report.stockRows,
      ...report.marketRows,
      ...report.accountRows,
      ...report.currencyRows,
      report.portfolioRow
    ]) {
      expect(row.currentCycle.cny).toEqual(result.currentCycle.cny)
      expect(row.currentCycle.native).toEqual(result.currentCycle.native)
    }
  })

  it('zeros current-cycle aggregates after closing while preserving cumulative profit and history', () => {
    const entries = [
      trade('buy', 'buy', 100, 10, 0.9, 5),
      trade('close', 'sell', 100, 15, 0.95, 5),
      cashEntry('cashDividend', 100),
      cashEntry('withholdingTax', 10),
      cashEntry('corporateActionFee', 2),
      cashEntry('cashAdjustment', 20)
    ]
    const closed = { ...account(entries), accountId: 'closed', performanceAdjustmentCny: 25.5 }
    const report = calculatePortfolioPerformanceReport(
      [stock(0)],
      [quote()],
      { '116.00700': closed },
      exchangeRates()
    )

    for (const row of [
      ...report.stockRows,
      ...report.marketRows,
      ...report.accountRows,
      ...report.currencyRows,
      report.portfolioRow
    ]) {
      expect(row.currentCycle).toEqual({
        stockCount: 0,
        includedStockCount: 0,
        excludedStockCount: 0,
        native: [],
        cny: {
          realizedProfit: 0,
          unrealizedProfit: 0,
          dividendIncome: 0,
          withholdingTax: 0,
          tradeFees: 0,
          corporateActionFees: 0,
          corporateActionIncome: 0,
          totalProfit: 0,
          priceContribution: 0,
          exchangeRateContribution: 0,
          manualAdjustment: 0
        },
        issueCounts: {}
      })
      expect(row.cumulative.cny.totalProfit).toBe(639.53)
      expect(row.cumulative.cny.manualAdjustment).toBe(25.5)
    }
    expect(report.stocks[0].currentCycle.cny.totalProfit).toBe(639.53)
    const cycles = calculatePortfolioPerformanceCycles(
      stock(0),
      quote(),
      closed,
      exchangeRates(),
      25.5
    )
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({
      status: 'closed',
      includedInCumulative: true,
      cny: { totalProfit: 639.53, manualAdjustment: 25.5 }
    })
  })

  it('excludes incomplete closed accounts from current-cycle completeness only', () => {
    const closed = {
      ...account([
        trade('closed-buy', 'buy', 100, 10, undefined, 0),
        trade('close', 'sell', 100, 15, 0.95, 0)
      ]),
      accountId: 'closed'
    }
    const holding = {
      ...account([trade('buy', 'buy', 100, 10, 0.9, 0)]),
      accountId: 'holding',
      position: stock(100).position
    }
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': { quoteId: '116.00700', accounts: { closed, holding } } },
      exchangeRates()
    )

    for (const row of [
      ...report.stockRows,
      ...report.marketRows,
      ...report.currencyRows,
      report.portfolioRow
    ]) {
      expect(row.currentCycle).toMatchObject({
        includedStockCount: 1,
        excludedStockCount: 0,
        cny: { totalProfit: 204 },
        issueCounts: {}
      })
      expect(row.cumulative.excludedStockCount).toBe(1)
      expect(row.cumulative.cny.totalProfit).toBeNull()
      expect(row.cumulative.issueCounts.missingHistoricalRate).toBe(1)
    }
  })

  it.each(['legacy', 'named'] as const)(
    'uses saved holdings for current-cycle membership when the %s account ledger disagrees',
    (kind) => {
      for (const savedQuantity of [0, 100]) {
        const entries = [trade('buy', 'buy', 100, 10, 0.9, 0)]
        if (savedQuantity > 0) entries.push(trade('close', 'sell', 100, 15, 0.95, 0))
        const savedStock = stock(savedQuantity)
        const book =
          kind === 'legacy'
            ? account(entries)
            : { ...account(entries), accountId: 'holding', position: savedStock.position }
        const report = calculatePortfolioPerformanceReport(
          [savedStock],
          [quote()],
          { '116.00700': book },
          exchangeRates()
        )

        expect(report.stocks[0].quantity).toBe(savedQuantity)
        expect(report.stocks[0].currentCycle.issues).toContain('positionMismatch')
        for (const row of [
          ...report.stockRows,
          ...report.marketRows,
          ...report.accountRows,
          ...report.currencyRows,
          report.portfolioRow
        ]) {
          expect(row.currentCycle.stockCount).toBe(savedQuantity > 0 ? 1 : 0)
          expect(row.currentCycle.excludedStockCount).toBe(savedQuantity > 0 ? 1 : 0)
          expect(row.currentCycle.cny.totalProfit).toBe(savedQuantity > 0 ? null : 0)
          expect(row.currentCycle.issueCounts.positionMismatch).toBe(
            savedQuantity > 0 ? 1 : undefined
          )
          expect(row.cumulative.excludedStockCount).toBe(1)
          expect(row.cumulative.cny.totalProfit).toBeNull()
        }
      }
    }
  )

  it('excludes a stock from CNY totals when its historical rate is missing', () => {
    const entries = [trade('buy', 'buy', 100, 10, undefined, 0)]
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(report.stocks[0].currentCycle.native[0].unrealizedProfit).toBe(200)
    expect(report.stocks[0].currentCycle.cny.totalProfit).toBeNull()
    expect(report.stocks[0].currentCycle.issues).toContain('missingHistoricalRate')
    expect(report.portfolioRow.currentCycle.includedStockCount).toBe(0)
    expect(report.portfolioRow.currentCycle.excludedStockCount).toBe(1)
    expect(report.portfolioRow.currentCycle.cny.totalProfit).toBeNull()
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

    expect(missingRate.stocks[0].currentCycle.issues).toContain('missingCurrentRate')
    expect(missingRate.stocks[0].currentCycle.cny.unrealizedProfit).toBeNull()
    expect(missingQuote.stocks[0].currentCycle.issues).toContain('missingQuote')
    expect(missingQuote.stocks[0].currentCycle.native[0].unrealizedProfit).toBeNull()
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

    expect(report.stocks[0].currentCycle.native[0]).toMatchObject({
      realizedProfit: 0,
      unrealizedProfit: 80,
      totalProfit: 80
    })
    expect(report.stocks[0].currentCycle.issues).not.toContain('positionMismatch')
  })

  it('resets accumulated performance at a broker cost calibration checkpoint', () => {
    const adjustment: PortfolioLedgerEntry = {
      id: 'position-adjustment:performance-reset',
      accountId: '116.00700',
      quoteId: '116.00700',
      occurredAt: '2026-04-02T02:00:00.000Z',
      marketDate: '2026-04-02',
      source: 'manual',
      currency: 'HKD',
      exchangeRate: 0.9,
      kind: 'positionAdjustment',
      resetsPerformance: true,
      quantityBefore: 50,
      quantityAfter: 60,
      costBefore: 10,
      costAfter: 11
    }
    const entries = [
      trade('buy', 'buy', 100, 10, 0.9, 5),
      trade('sell', 'sell', 50, 14, 0.95, 3),
      adjustment
    ]
    const report = calculatePortfolioPerformanceReport(
      [stock(60)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(report.stocks[0].currentCycle.native[0]).toMatchObject({
      realizedProfit: 0,
      unrealizedProfit: 60,
      tradeFees: 0,
      totalProfit: 60
    })
    expect(report.stocks[0].currentCycle.cny).toMatchObject({
      realizedProfit: 0,
      unrealizedProfit: 68.4,
      tradeFees: 0,
      totalProfit: 68.4
    })
    expect(report.stocks[0].cumulative.cny.totalProfit).toBe(68.4)

    const cycles = calculatePortfolioPerformanceCycles(
      stock(60),
      quote(),
      account(entries),
      exchangeRates()
    )
    expect(cycles).toHaveLength(2)
    expect(cycles[0]).toMatchObject({ status: 'excluded', includedInCumulative: false })
    expect(cycles[1]).toMatchObject({
      status: 'open',
      includedInCumulative: true,
      startedByPerformanceReset: true
    })
  })

  it('keeps accumulated performance when a position calibration does not reset it', () => {
    const adjustment: PortfolioLedgerEntry = {
      id: 'position-adjustment:keep-performance',
      accountId: '116.00700',
      quoteId: '116.00700',
      occurredAt: '2026-04-02T02:00:00.000Z',
      marketDate: '2026-04-02',
      source: 'manual',
      currency: 'HKD',
      exchangeRate: 0.9,
      kind: 'positionAdjustment',
      quantityBefore: 50,
      quantityAfter: 60,
      costBefore: 10,
      costAfter: 11
    }
    const entries = [
      trade('buy', 'buy', 100, 10, 0.9, 5),
      trade('sell', 'sell', 50, 14, 0.95, 3),
      adjustment
    ]
    const report = calculatePortfolioPerformanceReport(
      [stock(60)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(report.stocks[0].currentCycle.native[0]).toMatchObject({
      realizedProfit: 200,
      unrealizedProfit: 60,
      tradeFees: 8,
      totalProfit: 252
    })
  })

  it('starts holding profit again when a fully closed position is reopened', () => {
    const entries = [
      trade('first-buy', 'buy', 100, 10, 0.9, 0),
      trade('first-close', 'sell', 100, 15, 0.95, 0),
      trade('second-buy', 'buy', 60, 11, 0.91, 2, '2026-04-03T02:00:00.000Z')
    ]
    const report = calculatePortfolioPerformanceReport(
      [stock(60)],
      [quote()],
      { '116.00700': account(entries) },
      exchangeRates()
    )

    expect(report.stocks[0].currentCycle.native[0]).toMatchObject({
      realizedProfit: 0,
      unrealizedProfit: 60,
      tradeFees: 2,
      totalProfit: 58
    })
    expect(report.stocks[0].currentCycle.cny.totalProfit).toBeCloseTo(59.98)
    expect(report.stocks[0].cumulative.native[0]).toMatchObject({
      realizedProfit: 500,
      unrealizedProfit: 60,
      tradeFees: 2,
      totalProfit: 558
    })
    expect(report.stocks[0].cumulative.cny.totalProfit).toBeCloseTo(584.98)

    const cycles = calculatePortfolioPerformanceCycles(
      stock(60),
      quote(),
      account(entries),
      exchangeRates()
    )
    expect(cycles).toHaveLength(2)
    expect(cycles[0]).toMatchObject({ sequence: 1, status: 'closed', endingQuantity: 0 })
    expect(cycles[0].cny.totalProfit).toBe(525)
    expect(cycles[1]).toMatchObject({ sequence: 2, status: 'open', endingQuantity: 60 })
    expect(cycles[1].cny.totalProfit).toBeCloseTo(59.98)
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

  it('applies a per-stock CNY adjustment to CNY and native aggregates', () => {
    const report = calculatePortfolioPerformanceReport(
      [stock(100)],
      [quote()],
      { '116.00700': account([trade('buy', 'buy', 100, 10, 0.9, 0)]) },
      exchangeRates(),
      { '116.00700': 25.5 }
    )

    expect(report.stocks[0].currentCycle.native[0].manualAdjustment).toBe(27.72)
    expect(report.stocks[0].currentCycle.native[0].totalProfit).toBe(227.72)
    expect(report.stocks[0].currentCycle.cny.manualAdjustment).toBe(25.5)
    expect(report.stockRows[0].currentCycle.native[0].manualAdjustment).toBe(27.72)
    expect(report.stockRows[0].currentCycle.native[0].totalProfit).toBe(227.72)
    expect(report.stockRows[0].currentCycle.cny.manualAdjustment).toBe(25.5)
    expect(report.currencyRows[0].currentCycle.native[0].manualAdjustment).toBe(27.72)
    expect(report.currencyRows[0].currentCycle.native[0].totalProfit).toBe(227.72)
    expect(report.currencyRows[0].currentCycle.cny.manualAdjustment).toBe(25.5)
    expect(report.portfolioRow.currentCycle.native[0].manualAdjustment).toBe(27.72)
    expect(report.portfolioRow.currentCycle.native[0].totalProfit).toBe(227.72)
    expect(report.portfolioRow.currentCycle.cny.manualAdjustment).toBe(25.5)
    expect(report.portfolioRow.currentCycle.cny.totalProfit).toBe(229.5)
    expect(report.portfolioRow.cumulative.cny.totalProfit).toBe(229.5)
  })
})
