import { describe, expect, it } from 'vitest'
import { createCnFeeScheme } from '../shared/fee-schemes'
import { DEFAULT_APP_SETTINGS, type TTradeRecord, type TTradingBatch } from '../shared/types'
import type { AccountTradeFeeContext } from './account-trade-fees'
import { calculateTBatchForecastMetrics, estimateTBreakEvenPrice } from './t-trade-forecast'
import { getTPlanRows, applyTFloatingProfitAlert } from './t-alerts'

const batch: TTradingBatch = {
  id: 't',
  sequence: 1,
  direction: 'forward',
  openedAt: '2026-10-01T10:00',
  sellLevels: [{ quantity: 100, targetPercent: 1 }],
  floatingProfitAlert: { enabled: true, threshold: 8, status: 'armed' }
}
const trades: TTradeRecord[] = [
  {
    id: 'buy',
    accountId: 'actual',
    batchId: 't',
    side: 'buy',
    purpose: 't',
    price: 10,
    quantity: 100,
    tradedAt: batch.openedAt,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    note: ''
  }
]
function context(minimum: number): AccountTradeFeeContext {
  const scheme = createCnFeeScheme('forecast', '预测账户')
  scheme.fixedFees = { handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
  scheme.commission.SZ = { ratePerTenThousand: 0, minimumCommission: minimum, includedFees: [] }
  return { accountId: 'forecast', accountName: '预测账户', quoteId: '0.000876', scheme }
}

describe('T forecasts use the prediction account current fee scheme', () => {
  it('keeps historical execution fees and changes plan net profit with the prediction account minimum', () => {
    const options = {
      market: 'CN' as const,
      marketTradeFees: DEFAULT_APP_SETTINGS.marketTradeFees,
      accountFeeContext: context(5)
    }
    const rows = getTPlanRows(
      batch,
      trades,
      'sell',
      DEFAULT_APP_SETTINGS.tTradingFees,
      '深A',
      options
    )
    expect(rows[0].expectedProfit).toBeCloseTo(5)
    expect(rows[0].fullPositionProfit).toBeCloseTo(5)
    expect(trades[0].fees.commission).toBe(0)
    expect(estimateTBreakEvenPrice(batch, trades, context(5))).toBeCloseTo(10.05)
  })
  it('uses the same closing fee for displayed net floating profit and its notification threshold', () => {
    const metrics = calculateTBatchForecastMetrics(batch, trades, 10.1, context(5))
    expect(metrics.floatingProfit).toBeCloseTo(5)
    expect(applyTFloatingProfitAlert(batch, trades, 10.1, context(5)).triggered).toBeUndefined()
    expect(applyTFloatingProfitAlert(batch, trades, 10.15, context(5)).triggered?.actualValue).toBe(
      10
    )
  })
  it('subtracts the predicted buy fee for reverse T cover and finds its lower break even price', () => {
    const reverse = { ...batch, direction: 'reverse' as const }
    const sells = [{ ...trades[0], side: 'sell' as const }]
    expect(
      calculateTBatchForecastMetrics(reverse, sells, 9.9, context(5)).floatingProfit
    ).toBeCloseTo(5)
    expect(estimateTBreakEvenPrice(reverse, sells, context(5))).toBeCloseTo(9.95)
  })
  it('includes already realized profit in the whole batch break even price', () => {
    const partial = [
      { ...trades[0], quantity: 200 },
      {
        ...trades[0],
        id: 'partial',
        side: 'sell' as const,
        price: 11,
        tradedAt: '2026-10-02T10:00'
      }
    ]
    expect(estimateTBreakEvenPrice(batch, partial, context(5))).toBeCloseTo(9.05)
  })
})
