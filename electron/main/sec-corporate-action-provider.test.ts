import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() }
}))

import { SecCorporateActionProvider } from './sec-corporate-action-provider'

describe('SecCorporateActionProvider', () => {
  it('reads the filing body when SEC metadata does not describe the action', async () => {
    const client = {
      resolveIssuer: vi.fn(async () => ({
        cik: 320193,
        name: 'Apple Inc.',
        ticker: 'AAPL',
        exchange: 'Nasdaq'
      })),
      getSubmissions: vi.fn(async () => ({
        filings: {
          recent: {
            accessionNumber: ['0000320193-26-000005'],
            filingDate: ['2026-01-29'],
            form: ['8-K'],
            primaryDocument: ['aapl-20260129.htm'],
            primaryDocDescription: ['8-K']
          }
        }
      })),
      getFilingText: vi.fn(
        async () =>
          'The Board of Directors declared a cash dividend of $0.26 per share payable February 12, 2026 to shareholders of record February 9, 2026.'
      ),
      filingUrl: vi.fn(
        (cik: number, accessionNumber: string, primaryDocument: string) =>
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber}/${primaryDocument}`
      ),
      filingTextUrl: vi.fn(
        (cik: number, accessionNumber: string) =>
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber}/${accessionNumber}.txt`
      )
    }

    const result = await new SecCorporateActionProvider(client).fetch('105.AAPL')

    expect(client.getFilingText).toHaveBeenCalledWith(320193, '0000320193-26-000005')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      type: 'cashDividend',
      announcementDate: '2026-01-29',
      recordDate: '2026-02-09',
      payableDate: '2026-02-12',
      terms: {
        kind: 'cashDividend',
        amountPerShare: { value: 0.26 },
        currency: { value: 'USD' }
      }
    })
    expect(result.candidates[0].evidence[0].url).toContain('.txt')
  })
})
