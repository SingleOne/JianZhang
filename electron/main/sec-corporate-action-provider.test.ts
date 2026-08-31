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
          "Apple's board of directors has declared a cash dividend of $0.26 per share of the Company's common stock. The dividend is payable on February 12, 2026, to shareholders of record as of the close of business on February 9, 2026."
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

  it('reports a request failure when every required filing body is unavailable', async () => {
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
      getFilingText: vi.fn(async () => {
        throw new Error('请求 SEC EDGAR 披露正文失败：HTTP 403')
      }),
      filingUrl: vi.fn(
        (cik: number, accessionNumber: string, primaryDocument: string) =>
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber}/${primaryDocument}`
      ),
      filingTextUrl: vi.fn(
        (cik: number, accessionNumber: string) =>
          `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber}/${accessionNumber}.txt`
      )
    }

    await expect(new SecCorporateActionProvider(client).fetch('105.AAPL')).rejects.toThrow(
      'SEC 披露正文全部获取失败'
    )
  })

  it('does not turn historical or negated dividend text into a current candidate', async () => {
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
            accessionNumber: ['0000320193-26-000006'],
            filingDate: ['2026-01-30'],
            form: ['8-K'],
            primaryDocument: ['aapl-20260130.htm'],
            primaryDocDescription: ['8-K']
          }
        }
      })),
      getFilingText: vi.fn(
        async () =>
          'In 2022, the board declared a cash dividend of $0.10 per share. The company has never declared or paid any other cash dividends.'
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

    expect(result.candidates).toEqual([])
    expect(result.degraded).toBe(false)
  })
})
