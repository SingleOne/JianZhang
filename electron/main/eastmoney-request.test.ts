import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetch, check, verification } = vi.hoisted(() => {
  const check = vi.fn()
  return { fetch: vi.fn(), check, verification: { required: false, check } }
})

vi.mock('./eastmoney-history-session', () => ({
  eastmoneyHistorySession: { getSession: async () => ({ fetch }), verification }
}))
vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

import { fetchEastmoney, parseEastmoneyJson, readEastmoneyJson } from './eastmoney-request'

const URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.600000'

describe('Eastmoney request verification detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verification.required = false
  })

  it('uses shared session cookies and keeps a normal response', async () => {
    fetch.mockImplementation(async () => new Response('{"data":{"diff":[{"f12":"600000"}]}}'))
    const response = await fetchEastmoney(URL)
    await expect(readEastmoneyJson(response, URL)).resolves.toMatchObject({
      data: { diff: [{ f12: '600000' }] }
    })
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ credentials: 'include' }))
    expect(check).not.toHaveBeenCalled()
  })

  it('recognizes explicit challenges and retains an official redirect URL', () => {
    const redirect = 'https://quote.eastmoney.com/verify'
    expect(() => parseEastmoneyJson(URL, 403, '<title>安全验证</title>', redirect)).toThrow(
      '需要手动安全验证'
    )
    expect(check).toHaveBeenCalledWith(URL, true, redirect)
  })

  it('only requests a background inspection on empty data and network failures', async () => {
    expect(parseEastmoneyJson(URL, 200, '{"data":null}')).toEqual({ data: null })
    expect(check).toHaveBeenCalledWith(URL)
    fetch.mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))
    await expect(fetchEastmoney(URL)).rejects.toThrow('ERR_EMPTY_RESPONSE')
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('leaves requests to the existing fallback while the user is verifying', async () => {
    verification.required = true
    await expect(fetchEastmoney(URL)).rejects.toThrow('等待手动安全验证')
    expect(fetch).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it('does not inspect normal empty search or radar results', () => {
    expect(parseEastmoneyJson(URL, 200, '{"data":null}', undefined, false)).toEqual({ data: null })
    expect(check).not.toHaveBeenCalled()
  })
})
