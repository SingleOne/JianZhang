import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetch } = vi.hoisted(() => ({
  netFetch: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetch }
}))

import { HkexNewsClient } from './hkex-news-client'

function textResponse(value: string): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn(async () => value)
  } as unknown as Response
}

describe('HkexNewsClient', () => {
  beforeEach(() => {
    netFetch.mockReset()
  })

  it('parses a JSONP stock response with trailing line breaks', async () => {
    netFetch.mockResolvedValue(
      textResponse(
        'callback({"more":"1","stockInfo":[{"stockId":190371,"code":"01810","name":"XIAOMI-W"}]});\r\n'
      )
    )

    await expect(new HkexNewsClient().resolveStock('01810')).resolves.toEqual({
      stockId: 190371,
      code: '01810',
      name: 'XIAOMI-W'
    })
  })
})
