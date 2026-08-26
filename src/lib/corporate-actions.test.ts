import { describe, expect, it } from 'vitest'
import {
  classifyCorporateAction,
  extractCorporateActionDates,
  extractCorporateActionTerms
} from './corporate-actions'

describe('corporate action extraction', () => {
  it('classifies HKEX dividend and extracts amount, currency and dates', () => {
    const text =
      'Final Dividend HKD 1.20 per ordinary share. Ex-dividend date 8 June 2026. Record date 10 June 2026. Payment date 20 June 2026.'
    expect(classifyCorporateAction(text)).toBe('cashDividend')
    expect(extractCorporateActionTerms('cashDividend', text, '116.00700')).toMatchObject({
      kind: 'cashDividend',
      amountPerShare: { value: 1.2 },
      currency: { value: 'HKD' }
    })
    expect(extractCorporateActionDates(text)).toEqual({
      exDate: '2026-06-08',
      recordDate: '2026-06-10',
      payableDate: '2026-06-20',
      effectiveDate: undefined,
      electionDeadline: undefined
    })
  })

  it('extracts split, consolidation and rights ratios', () => {
    expect(
      extractCorporateActionTerms('split', 'Each existing share into four new shares', 'x')
    ).toMatchObject({
      kind: 'shareRatio',
      oldShares: { value: 1 },
      newShares: { value: 4 }
    })
    expect(
      extractCorporateActionTerms(
        'reverseSplit',
        'Every ten existing shares into one new share',
        'x'
      )
    ).toMatchObject({ oldShares: { value: 10 }, newShares: { value: 1 } })
    expect(
      extractCorporateActionTerms('reverseSplit', 'a 1-for-10 reverse stock split', 'x')
    ).toMatchObject({ oldShares: { value: 10 }, newShares: { value: 1 } })
    expect(
      extractCorporateActionTerms(
        'rightsIssue',
        '1 Rights Share for every 10 existing shares at subscription price HKD 15.00',
        'x'
      )
    ).toMatchObject({
      heldShares: { value: 10 },
      entitlementShares: { value: 1 },
      subscriptionPrice: { value: 15 },
      currency: { value: 'HKD' }
    })
  })

  it('extracts US month-first and ISO corporate action dates', () => {
    expect(
      extractCorporateActionDates(
        'The record date is June 10, 2026 and the payment date is 2026-06-20.'
      )
    ).toMatchObject({ recordDate: '2026-06-10', payableDate: '2026-06-20' })
  })
})
