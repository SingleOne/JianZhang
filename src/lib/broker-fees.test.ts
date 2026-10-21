import { describe, expect, it } from 'vitest'
import { createCnFeeScheme } from '../shared/fee-schemes'
import {
  calculateSchemeTradeFees,
  calculateSchemeExecutionFees,
  roundFeeAmount
} from './broker-fees'

function scheme() {
  const result = createCnFeeScheme('test', '万 1 最低 1 元')
  for (const rule of Object.values(result.commission)) {
    rule.ratePerTenThousand = 1
    rule.minimumCommission = 1
  }
  return result
}

describe('broker scheme fee calculation', () => {
  it('multiplies execution prices and quantities as decimals before examining the third digit', () => {
    const settings = scheme()
    settings.roundingMode = 'next-digit-up'
    settings.fixedFees = { handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
    settings.commission.SZ = { ratePerTenThousand: 10, minimumCommission: 0, includedFees: [] }
    expect(calculateSchemeExecutionFees('1.23001', 1000, 'buy', settings, 'SZ').total).toBe(1.23)
    expect(calculateSchemeExecutionFees('1.231', 1000, 'buy', settings, 'SZ').total).toBe(1.24)
  })
  it.each([
    ['1.23001', 1.23],
    ['1.23099', 1.23],
    ['1.230', 1.23],
    ['1.231', 1.24],
    ['1.239999', 1.24],
    ['0.001', 0.01],
    ['0.0009', 0],
    ['1.23e-2', 0.02]
  ])('only inspects the adjacent third digit for %s', (value, expected) => {
    expect(roundFeeAmount(value, 'next-digit-up')).toBe(expected)
  })
  it.each([
    ['1.005', 1.01],
    ['1.00499', 1],
    ['1.235', 1.24],
    ['1.23001', 1.23]
  ])('rounds decimal %s without binary floating point drift', (value, expected) => {
    expect(roundFeeAmount(value, 'half-up')).toBe(expected)
  })
  it.each([
    ['half-up', 13.13, 0.84, 0.49],
    ['next-digit-up', 13.11, 0.85, 0.5]
  ] as const)(
    'keeps the quoted commission total when splitting included fees with %s',
    (roundingMode, commission, handling, regulatory) => {
      const fees = scheme()
      fees.roundingMode = roundingMode
      fees.commission.SH = {
        ratePerTenThousand: 5.854,
        minimumCommission: 5,
        includedFees: ['handling', 'regulatory']
      }
      expect(calculateSchemeExecutionFees('22.45', 1100, 'buy', fees, 'SH')).toEqual({
        fees: { commission, handling, regulatory, transfer: 0.25, stampDuty: 0 },
        total: 14.71,
        minimumTopUp: 0
      })
      expect(calculateSchemeTradeFees('24695', 'sell', fees, 'SH')).toEqual({
        fees: { commission, handling, regulatory, transfer: 0.25, stampDuty: 12.35 },
        total: 27.06,
        minimumTopUp: 0
      })
    }
  )
  it('does not overcharge when included fees round upward separately', () => {
    const fees = scheme()
    fees.fixedFees = { handling: 0.5, regulatory: 0.5, transfer: 0, stampDuty: 0 }
    fees.commission.SH = {
      ratePerTenThousand: 100,
      minimumCommission: 0,
      includedFees: ['handling', 'regulatory']
    }
    expect(calculateSchemeTradeFees('100', 'buy', fees, 'SH')).toEqual({
      fees: { commission: 0.98, handling: 0.01, regulatory: 0.01, transfer: 0, stampDuty: 0 },
      total: 1,
      minimumTopUp: 0
    })
  })
  it('keeps net commission nonnegative when included fees exceed the quoted total', () => {
    const fees = scheme()
    fees.commission.SZ.ratePerTenThousand = 0
    fees.commission.SZ.minimumCommission = 0
    expect(calculateSchemeTradeFees('8957', 'buy', fees, 'SZ')).toEqual({
      fees: { commission: 0, handling: 0.31, regulatory: 0.18, transfer: 0.09, stampDuty: 0 },
      total: 0.58,
      minimumTopUp: 0
    })
  })
  it('tops up the net commission after rounding each included fee', () => {
    expect(calculateSchemeTradeFees('8957', 'buy', scheme(), 'SZ')).toEqual({
      fees: { commission: 0.42, handling: 0.31, regulatory: 0.18, transfer: 0.09, stampDuty: 0 },
      total: 1,
      minimumTopUp: 0.1
    })
  })
  it('allows Shanghai transfer charges outside the commission minimum', () => {
    const fees = scheme()
    fees.commission.SH.includedFees = ['handling', 'regulatory']
    const result = calculateSchemeTradeFees(8957, 'buy', fees, 'SH')
    expect(result.fees.commission).toBe(0.51)
    expect(result.fees.transfer).toBe(0.09)
    expect(result.total).toBe(1.09)
    expect(calculateSchemeTradeFees(8957, 'buy', fees, 'SZ').total).toBe(1)
  })
  it('applies stamp duty only to sells and adds excluded fees once', () => {
    expect(calculateSchemeTradeFees(8957, 'sell', scheme(), 'SZ')).toMatchObject({
      fees: { stampDuty: 4.48 },
      total: 5.48
    })
  })
  it('supports no included fees and a selected stamp duty inclusion', () => {
    const fees = scheme()
    fees.commission.SZ.includedFees = []
    expect(calculateSchemeTradeFees(8957, 'buy', fees, 'SZ').total).toBe(1.58)
    fees.commission.SZ.includedFees = ['handling', 'regulatory', 'transfer', 'stampDuty']
    fees.commission.SZ.ratePerTenThousand = 10
    const result = calculateSchemeTradeFees(8957, 'sell', fees, 'SZ')
    expect(result.fees.commission).toBe(3.9)
    expect(result.total).toBe(8.96)
  })
  it('merges account overrides without changing the shared scheme or other accounts', () => {
    const fees = scheme()
    const original = structuredClone(fees)
    expect(
      calculateSchemeTradeFees(8957, 'sell', fees, 'SZ', { stampDuty: 0 }).fees.stampDuty
    ).toBe(0)
    expect(calculateSchemeTradeFees(8957, 'sell', fees, 'SZ').fees.stampDuty).toBe(4.48)
    expect(fees).toEqual(original)
  })
  it('does not charge minimum fees for a zero amount or disabled transfer rate', () => {
    expect(calculateSchemeTradeFees(0, 'buy', scheme(), 'SZ').total).toBe(0)
    expect(
      calculateSchemeTradeFees('1', 'buy', scheme(), 'SZ', { transfer: 0 }).fees.transfer
    ).toBe(0)
  })
})
