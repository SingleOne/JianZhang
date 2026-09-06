import { afterEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { SecEdgarClient } from './sec-edgar-client'

function response(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => value),
    text: vi.fn(async () => String(value))
  } as unknown as Response
}

describe('SecEdgarClient', () => {
  afterEach(() => {
    vi.useRealTimers()
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
        'User-Agent': expect.stringContaining('Mozilla/5.0')
      })
    }
  })
})
