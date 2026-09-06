import { afterEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { SecEdgarClient } from './sec-edgar-client'

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => value)
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
      return jsonResponse({})
    })
    const firstClient = new SecEdgarClient()
    const secondClient = new SecEdgarClient()

    const requests = [
      firstClient.getSubmissions(1),
      secondClient.getCompanyFacts(2),
      firstClient.getCompanyFacts(3)
    ]

    await vi.advanceTimersByTimeAsync(300)
    await Promise.all(requests)

    expect(requestTimes).toEqual([0, 150, 300])
  })
})
