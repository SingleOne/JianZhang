import { describe, expect, it } from 'vitest'
import {
  formatAmount,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares,
  formatSigned
} from './format'

describe('shared number formatting', () => {
  it('formats missing values consistently', () => {
    expect(formatPrice(null)).toBe('--')
    expect(formatPercent(undefined)).toBe('--')
    expect(formatProfit(null)).toBe('--')
    expect(formatShares(undefined)).toBe('--')
  })

  it('formats prices with the existing precision rules', () => {
    expect(formatPrice(1248.067)).toBe('1248.07')
    expect(formatPrice(48.26)).toBe('48.26')
    expect(formatPrice(8.008)).toBe('8.008')
  })

  it('adds signs to percentages and profits', () => {
    expect(formatSigned(1.236)).toBe('+1.24')
    expect(formatPercent(-0.256)).toBe('-0.26%')
    expect(formatProfit(1234.5)).toBe('+1,234.50')
    expect(formatProfit(-12.5)).toBe('-12.50')
  })

  it('formats amounts, currencies and quantities for every surface', () => {
    expect(formatAmount(268_450_000)).toBe('2.68亿')
    expect(formatAmount(26_845)).toBe('2.7万')
    expect(formatCurrency(36.5)).toBe('36.50')
    expect(formatShares(12_300)).toBe('12,300 股')
  })
})
