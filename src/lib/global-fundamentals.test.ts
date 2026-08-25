import { describe, expect, it } from 'vitest'
import {
  buildStructuredFinancialPeriods,
  extractHkexFinancialMetrics,
  type StructuredCompanyFacts
} from './global-fundamentals'

function fact(
  value: number,
  start: string | undefined,
  end: string,
  filed: string,
  form: string,
  fiscalYear: number,
  fiscalPeriod: string,
  accessionNumber: string
) {
  return {
    val: value,
    start,
    end,
    filed,
    form,
    fy: fiscalYear,
    fp: fiscalPeriod,
    accn: accessionNumber
  }
}

describe('global fundamental helpers', () => {
  it('maps SEC facts into annual, interim and reliable TTM periods', () => {
    const payload: StructuredCompanyFacts = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                fact(1_000, '2025-01-01', '2025-12-31', '2026-02-01', '10-K', 2025, 'FY', 'annual'),
                fact(250, '2025-01-01', '2025-03-31', '2025-05-01', '10-Q', 2025, 'Q1', 'prior-q1'),
                fact(
                  300,
                  '2026-01-01',
                  '2026-03-31',
                  '2026-05-01',
                  '10-Q',
                  2026,
                  'Q1',
                  'current-q1'
                )
              ]
            }
          },
          NetIncomeLoss: {
            units: {
              USD: [
                fact(100, '2025-01-01', '2025-12-31', '2026-02-01', '10-K', 2025, 'FY', 'annual'),
                fact(20, '2025-01-01', '2025-03-31', '2025-05-01', '10-Q', 2025, 'Q1', 'prior-q1'),
                fact(35, '2026-01-01', '2026-03-31', '2026-05-01', '10-Q', 2026, 'Q1', 'current-q1')
              ]
            }
          },
          Assets: {
            units: {
              USD: [
                fact(2_000, undefined, '2026-03-31', '2026-05-01', '10-Q', 2026, 'Q1', 'current-q1')
              ]
            }
          },
          Liabilities: {
            units: {
              USD: [
                fact(800, undefined, '2026-03-31', '2026-05-01', '10-Q', 2026, 'Q1', 'current-q1')
              ]
            }
          }
        }
      }
    }
    const periods = buildStructuredFinancialPeriods(payload, [
      { accessionNumber: 'annual', url: 'https://www.sec.gov/annual' },
      { accessionNumber: 'prior-q1', url: 'https://www.sec.gov/prior-q1' },
      { accessionNumber: 'current-q1', url: 'https://www.sec.gov/current-q1' }
    ])
    const ttm = periods.find((period) => period.periodType === 'ttm')
    expect(ttm?.metrics.find((metric) => metric.id === 'revenue')?.value).toBe(1_050)
    expect(ttm?.metrics.find((metric) => metric.id === 'netIncome')?.value).toBe(115)
    expect(ttm?.metrics.find((metric) => metric.id === 'debtAssetRatio')?.value).toBe(40)
    expect(periods.find((period) => period.periodType === 'annual')?.sourceUrl).toBe(
      'https://www.sec.gov/annual'
    )
  })

  it('extracts HKEX values only when currency and scale are explicit', () => {
    const result = extractHkexFinancialMetrics(`
      CONSOLIDATED INCOME STATEMENT
      RMB in million
      Revenue 660,257 609,015
      Gross profit 350,000 320,000
      Profit for the year 200,000 180,000
      Total assets 1,800,000 1,700,000
      Total liabilities 700,000 680,000
    `)
    expect(result?.currency).toBe('CNY')
    expect(result?.metrics.find((metric) => metric.id === 'revenue')?.value).toBe(660_257_000_000)
    expect(result?.metrics.find((metric) => metric.id === 'netMargin')?.value).toBeCloseTo(30.29, 2)
    expect(extractHkexFinancialMetrics('Revenue 660,257')).toBeNull()
  })
})
