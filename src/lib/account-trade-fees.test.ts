import { describe, expect, it } from 'vitest'
import { createCnFeeScheme } from '../shared/fee-schemes'
import type { TTradeRecord } from '../shared/types'
import {
  calculateAccountTradeFees,
  getAccountTradeFeeContext,
  reestimateTradeExecution,
  type AccountTradeFeeContext
} from './account-trade-fees'
import { totalRecordedTradeFees } from './t-trading'

function context(accountId = 'chuan', quoteId = '0.000876'): AccountTradeFeeContext {
  const scheme = createCnFeeScheme(`fee:${accountId}`, '万1最低1元')
  for (const rule of Object.values(scheme.commission)) {
    rule.ratePerTenThousand = 1
    rule.minimumCommission = 1
  }
  return { accountId, accountName: accountId, quoteId, scheme }
}
function record(id: string, quantity: number, changes: Partial<TTradeRecord> = {}): TTradeRecord {
  return {
    id,
    accountId: 'chuan',
    side: 'buy',
    purpose: 'base',
    price: 6.89,
    quantity,
    tradedAt: '2026-10-06T10:00',
    marketDate: '2026-10-06',
    fees: { commission: 9, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    note: '',
    ...changes
  }
}

describe('account fee scheme execution entry points', () => {
  it('uses the bound scheme and the selected account overrides instead of a global broker', () => {
    const c = context()
    const other = context('other')
    if (other.scheme.market === 'CN') other.scheme.commission.SZ.minimumCommission = 5
    const state = {
      securitiesAccounts: {
        chuan: {
          id: 'chuan',
          name: '川财',
          market: 'CN' as const,
          enabled: true,
          isSystemDefault: false,
          feeSchemeId: c.scheme.id,
          fixedFeeOverrides: { transfer: 0 }
        },
        other: {
          id: 'other',
          name: '其他',
          market: 'CN' as const,
          enabled: true,
          isSystemDefault: false,
          feeSchemeId: other.scheme.id
        }
      },
      feeSchemes: { [c.scheme.id]: c.scheme, [other.scheme.id]: other.scheme }
    }
    const result = calculateAccountTradeFees(getAccountTradeFeeContext(state, 'chuan', c.quoteId), {
      price: 6.89,
      quantity: 1300,
      side: 'buy'
    })
    expect(result.total).toBe(1)
    expect(result.fees.transfer).toBe(0)
    expect(
      calculateAccountTradeFees(getAccountTradeFeeContext(state, 'other', c.quoteId), {
        price: 6.89,
        quantity: 1300,
        side: 'buy'
      }).total
    ).toBe(5)
  })
  it('charges the Shanghai transfer fee outside the selected commission bundle', () => {
    const c = context('chuan', '1.600000')
    if (c.scheme.market === 'CN') c.scheme.commission.SH.includedFees = ['handling', 'regulatory']
    expect(calculateAccountTradeFees(c, { price: 6.89, quantity: 1300, side: 'buy' }).total).toBe(
      1.09
    )
  })
  it('reestimates one full execution and allocates its minimum once without touching other accounts', () => {
    const source = { id: 'whole', quantity: 1300 }
    const records = [
      record('whole', 1000, { purpose: 't', batchId: 't', splitSource: source }),
      record('base', 300, { splitSource: source }),
      record('other', 1300, { accountId: 'other', splitSource: source })
    ]
    const updated = reestimateTradeExecution(records, 'base', context())
    expect(totalRecordedTradeFees(updated[0])).toBe(0.77)
    expect(totalRecordedTradeFees(updated[1])).toBe(0.23)
    expect(updated[0].batchId).toBe('t')
    expect(updated[2]).toBe(records[2])
    expect(records[0].fees.commission).toBe(9)
    expect(updated[0].accountFeeSnapshot).toBeUndefined()
  })
  it('rejects incomplete split records and a different account fee context', () => {
    const one = record('whole', 1000, { splitSource: { id: 'whole', quantity: 1300 } })
    expect(() => reestimateTradeExecution([one], one.id, context())).toThrow('流水不完整')
    const regular = record('regular', 1300)
    expect(() => reestimateTradeExecution([regular], regular.id, context('other'))).toThrow(
      '实际所属账户'
    )
  })
})
