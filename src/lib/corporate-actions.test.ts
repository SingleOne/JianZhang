import { describe, expect, it } from 'vitest'
import {
  classifyCorporateAction,
  extractCnCorporateActionEffects,
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

  it('splits an A-share cash and stock distribution into independent effects', () => {
    const text =
      '以股权登记日总股本为基数，每10股派发现金红利1.50元（含税），每10股送红股1股，以资本公积金每10股转增2股。股权登记日：2026年6月18日，除权除息日：2026年6月19日，现金红利发放日：2026年6月19日，新增股份上市日：2026年6月20日。'

    expect(extractCnCorporateActionEffects(text)).toMatchObject([
      {
        type: 'cashDividend',
        terms: { amountPerShare: { value: 0.15 }, currency: { value: 'CNY' } }
      },
      {
        type: 'stockDividend',
        terms: { oldShares: { value: 10 }, newShares: { value: 13 } }
      }
    ])
    expect(extractCorporateActionDates(text)).toEqual({
      exDate: '2026-06-19',
      recordDate: '2026-06-18',
      payableDate: '2026-06-19',
      effectiveDate: '2026-06-20',
      electionDeadline: undefined
    })
  })

  it('extracts A-share rights ratio, price and deadline', () => {
    const text =
      '本次配股按照每10股配售3股，配股价格为人民币5.20元/股。股权登记日为2026-07-01，配股缴款截止日为2026-07-08。'

    expect(classifyCorporateAction(text)).toBe('rightsIssue')
    expect(extractCorporateActionTerms('rightsIssue', text, '1.600000')).toMatchObject({
      heldShares: { value: 10 },
      entitlementShares: { value: 3 },
      subscriptionPrice: { value: 5.2 },
      currency: { value: 'CNY' }
    })
    expect(extractCorporateActionDates(text)).toMatchObject({
      recordDate: '2026-07-01',
      electionDeadline: '2026-07-08'
    })
  })
})
