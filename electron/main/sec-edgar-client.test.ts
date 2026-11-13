import { afterEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { SecEdgarClient } from './sec-edgar-client'

function response(value: unknown): Response {
  return Response.json(value)
}

describe('SecEdgarClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    netFetch.mockReset()
  })

  it('paces request starts across client instances', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const requestTimes: number[] = []
    netFetch.mockImplementation(async () => {
      requestTimes.push(Date.now())
      return response({})
    })
    const firstClient = new SecEdgarClient()
    const secondClient = new SecEdgarClient()

    const requests = [
      firstClient.getSubmissions(1),
      secondClient.getCompanyFacts(2),
      firstClient.getFilingText(3, '0000000003-26-000001')
    ]

    await vi.advanceTimersByTimeAsync(300)
    await Promise.all(requests)

    expect(requestTimes).toEqual([0, 150, 300])
    for (const [, options] of netFetch.mock.calls) {
      expect(options?.headers).toMatchObject({
        From: 'SingleOne@users.noreply.github.com',
        'User-Agent': expect.stringMatching(/^JianZhangDesktop\/\d/)
      })
    }
  })

  it('recovers the issuer directory, submissions, company facts and filing text after Chromium 403', async () => {
    netFetch.mockImplementation(async () => new Response(null, { status: 403 }))
    const nodeFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('company_tickers_exchange')) {
        return Response.json({
          fields: ['cik', 'name', 'ticker', 'exchange'],
          data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']]
        })
      }
      if (url.includes('submissions')) return Response.json({ name: 'Apple Inc.' })
      if (url.includes('companyfacts')) return Response.json({ cik: 320193, facts: {} })
      return new Response('Apple filing text')
    })
    vi.stubGlobal('fetch', nodeFetch)
    const client = new SecEdgarClient()

    expect((await client.resolveIssuer('AAPL')).cik).toBe(320193)
    expect((await client.getSubmissions(320193)).name).toBe('Apple Inc.')
    expect((await client.getCompanyFacts(320193)).cik).toBe(320193)
    expect(await client.getFilingText(320193, '0000320193-26-000001')).toBe('Apple filing text')
    expect(nodeFetch).toHaveBeenCalledTimes(4)
    for (const [, init] of nodeFetch.mock.calls) {
      expect(init?.headers).toMatchObject({
        From: 'SingleOne@users.noreply.github.com',
        'User-Agent': expect.stringContaining('JianZhangDesktop')
      })
    }
  })

  it('uses the second official ticker index when the exchange directory stays forbidden', async () => {
    netFetch.mockImplementation(async (input: string) =>
      input.includes('company_tickers_exchange')
        ? new Response(null, { status: 403 })
        : Response.json({
            0: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' }
          })
    )
    const nodeFetch = vi.fn(async () => new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', nodeFetch)

    const issuer = await new SecEdgarClient().resolveIssuer('brk.b')

    expect(issuer).toEqual({
      cik: 1067983,
      ticker: 'BRK-B',
      name: 'BERKSHIRE HATHAWAY INC',
      exchange: ''
    })
    expect(netFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://www.sec.gov/files/company_tickers_exchange.json',
      'https://www.sec.gov/files/company_tickers.json'
    ])
  })

  it('retries body transport failures but preserves malformed JSON errors', async () => {
    netFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.reject(new DOMException('timed out', 'TimeoutError'))
    } as Response)
    const nodeFetch = vi.fn(async () => Response.json({ name: 'Apple Inc.' }))
    vi.stubGlobal('fetch', nodeFetch)
    const client = new SecEdgarClient()

    expect((await client.getSubmissions(320193)).name).toBe('Apple Inc.')
    netFetch.mockResolvedValueOnce(new Response('not JSON'))
    await expect(client.getSubmissions(320193)).rejects.toBeInstanceOf(SyntaxError)
    expect(nodeFetch).toHaveBeenCalledTimes(1)
  })
})
