import { describe, expect, it } from 'vitest'
import {
  appendPortfolioLedgerEntries,
  normalizeTTradingAccounts,
  type CorporateActionCandidate,
  type TTradeRecord
} from '../shared/types'
import {
  calculatePortfolioLedgerMetrics,
  previewCorporateAction,
  reversalEntries
} from './portfolio-ledger'

function trade(id: string, quantity = 100, price = 20): TTradeRecord {
  return {
    id,
    side: 'buy',
    purpose: 'base',
    tradedAt: '2026-01-02T09:30:00.000Z',
    price,
    quantity,
    fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
    market: 'HK',
    currency: 'HKD',
    marketDate: '2026-01-02',
    actualSettlementDate: '2026-01-06',
    exchangeRate: 0.92,
    exchangeRateDate: '2026-01-02',
    note: '期初持仓'
  }
}

function account() {
  return normalizeTTradingAccounts({
    '116.00700': {
      quoteId: '116.00700',
      code: '00700',
      name: '腾讯控股',
      market: 'HK',
      currency: 'HKD',
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: [trade('opening')]
    }
  })['116.00700']
}

function candidate(
  type: CorporateActionCandidate['type'],
  terms: CorporateActionCandidate['terms']
): CorporateActionCandidate {
  return {
    id: `hkex:${type}`,
    quoteId: '116.00700',
    market: 'HK',
    type,
    status: 'detected',
    title: type,
    announcementDate: '2026-06-01',
    recordDate: '2026-06-10',
    payableDate: '2026-06-20',
    terms,
    evidence: [],
    providerId: 'hkex-news',
    providerEventId: type,
    contentHash: `hash-${type}`,
    detectedAt: '2026-06-01T00:00:00.000Z'
  }
}

describe('portfolio ledger corporate actions', () => {
  it('migrates existing trades into the versioned ledger without losing the compatibility mirror', () => {
    const normalized = account()
    expect(normalized.ledger.schemaVersion).toBe(1)
    expect(normalized.ledger.entries).toHaveLength(1)
    expect(normalized.ledger.entries[0]).toMatchObject({ kind: 'trade', externalId: 'opening' })
    expect(normalized.tradeRecords[0].id).toBe('opening')
  })

  it('previews a cash dividend with withholding tax, fees and CNY conversion', () => {
    const action = candidate('cashDividend', {
      kind: 'cashDividend',
      amountPerShare: { value: 1.2, confidence: 'high' },
      currency: { value: 'HKD', confidence: 'high' }
    })
    const preview = previewCorporateAction(action, account(), {
      withholdingTax: 10,
      fees: 2,
      exchangeRate: 0.91,
      exchangeRateDate: '2026-06-20'
    })

    expect(preview.grossCash).toBe(120)
    expect(preview.netCash).toBe(108)
    expect(preview.netCashCny).toBe(98.28)
    expect(preview.entries.map((entry) => entry.kind)).toEqual([
      'cashDividend',
      'withholdingTax',
      'corporateActionFee'
    ])
  })

  it('keeps total cost unchanged for a 1-to-4 split', () => {
    const action = candidate('split', {
      kind: 'shareRatio',
      oldShares: { value: 1, confidence: 'high' },
      newShares: { value: 4, confidence: 'high' }
    })
    const preview = previewCorporateAction(action, account(), {})
    const adjusted = appendPortfolioLedgerEntries(account(), preview.entries)
    const metrics = calculatePortfolioLedgerMetrics(adjusted, 'HKD')

    expect(preview.quantityAfter).toBe(400)
    expect(preview.costAfter).toBe(5)
    expect(metrics.quantity).toBe(400)
    expect(metrics.nativeCostBasis).toBe(2000)
  })

  it('applies a revised split after the original entry on the same effective date', () => {
    const action = candidate('split', {
      kind: 'shareRatio',
      oldShares: { value: 1, confidence: 'high' },
      newShares: { value: 4, confidence: 'high' }
    })
    const initial = previewCorporateAction(action, account(), {})
    const applied = appendPortfolioLedgerEntries(account(), initial.entries)
    const revisedAction = {
      ...action,
      status: 'revised' as const,
      detectedAt: '2026-06-02T00:00:00.000Z',
      contentHash: 'hash-split-revised',
      terms: {
        kind: 'shareRatio' as const,
        oldShares: { value: 1, confidence: 'high' as const },
        newShares: { value: 5, confidence: 'high' as const }
      }
    }
    const revised = previewCorporateAction(revisedAction, applied, {})
    const revisedAccount = appendPortfolioLedgerEntries(applied, revised.entries)

    expect(revised.quantityBefore).toBe(400)
    expect(revised.quantityAfter).toBe(500)
    expect(calculatePortfolioLedgerMetrics(revisedAccount, 'HKD').quantity).toBe(500)
  })

  it('does not add shares when a rights issue is declined', () => {
    const action = candidate('rightsIssue', {
      kind: 'rightsIssue',
      heldShares: { value: 10, confidence: 'high' },
      entitlementShares: { value: 1, confidence: 'high' },
      subscriptionPrice: { value: 15, confidence: 'high' },
      currency: { value: 'HKD', confidence: 'high' }
    })
    const preview = previewCorporateAction(action, account(), { subscribedQuantity: 0 })
    expect(preview.quantityAfter).toBe(100)
    expect(preview.entries).toEqual([])
    expect(preview.missingFields).toEqual([])
  })

  it('writes only the rights subscription cost difference when revised terms change the price', () => {
    const action = candidate('rightsIssue', {
      kind: 'rightsIssue',
      heldShares: { value: 10, confidence: 'high' },
      entitlementShares: { value: 1, confidence: 'high' },
      subscriptionPrice: { value: 15, confidence: 'high' },
      currency: { value: 'HKD', confidence: 'high' }
    })
    const initial = previewCorporateAction(action, account(), {
      subscribedQuantity: 10,
      subscriptionPrice: 15
    })
    const applied = appendPortfolioLedgerEntries(account(), initial.entries)
    const revised = previewCorporateAction(
      { ...action, contentHash: 'hash-rights-revised', status: 'revised' },
      applied,
      { subscribedQuantity: 10, subscriptionPrice: 14 }
    )

    expect(revised.quantityAfter).toBe(110)
    expect(revised.grossCash).toBe(10)
    expect(revised.entries[0]).toMatchObject({
      kind: 'rightsSubscription',
      quantity: 0,
      cost: -10
    })
  })

  it('reverses an applied share adjustment while retaining both records', () => {
    const action = candidate('reverseSplit', {
      kind: 'shareRatio',
      oldShares: { value: 10, confidence: 'high' },
      newShares: { value: 1, confidence: 'high' }
    })
    const preview = previewCorporateAction(action, account(), {})
    const appliedCandidate = {
      ...action,
      status: 'applied' as const,
      appliedEntryIds: preview.entries.map((entry) => entry.id)
    }
    const adjusted = appendPortfolioLedgerEntries(account(), preview.entries)
    const reversed = appendPortfolioLedgerEntries(
      adjusted,
      reversalEntries(appliedCandidate, adjusted)
    )

    expect(calculatePortfolioLedgerMetrics(adjusted, 'HKD').quantity).toBe(10)
    expect(calculatePortfolioLedgerMetrics(reversed, 'HKD').quantity).toBe(100)
    expect(reversed.ledger.entries.some((entry) => entry.kind === 'shareAdjustment')).toBe(true)
    expect(reversed.ledger.entries.some((entry) => entry.kind === 'reversal')).toBe(true)
  })
})
