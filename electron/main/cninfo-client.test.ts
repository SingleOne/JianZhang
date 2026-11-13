import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CninfoClient } from './cninfo-client'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

beforeEach(() => {
  vi.mocked(net.fetch).mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 }))
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('shared Cninfo client', () => {
  it('uses the official static directory when both connections to the main directory return 403', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.hostname === 'www.cninfo.com.cn') return new Response(null, { status: 403 })
      expect(url.href).toBe('https://static.cninfo.com.cn/new/data/szse_stock.json')
      expect(new Headers(init?.headers).has('Origin')).toBe(false)
      return Response.json({
        stockList: [{ code: '000001', orgId: 'gssz0000001', category: 'A股', zwjc: '平安银行' }]
      })
    })
    const client = new CninfoClient()

    expect(await client.getOrganization('000001')).toEqual({
      orgId: 'gssz0000001',
      name: '平安银行'
    })
    await client.getOrganization('000001')
    expect(net.fetch).toHaveBeenCalledTimes(2)
  })

  it('continues search pages until the requested number of this issuer announcements is found', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      const page = new URL(String(input)).searchParams.get('pageNum')
      const matching = {
        announcementId: 'matching',
        announcementTitle: '公司公告',
        announcementTime: Date.parse('2026-11-13'),
        adjunctUrl: 'finalpage/report.PDF',
        orgId: 'gssz0000001'
      }
      return Response.json({
        totalRecordNum: 101,
        announcements: page === '1' ? [{ ...matching, orgId: 'other-issuer' }] : [matching]
      })
    })

    const items = await new CninfoClient().searchAnnouncements(
      '000001',
      { orgId: 'gssz0000001', name: '平安银行' },
      '',
      '',
      1
    )

    expect(items.map((item) => item.announcementId)).toEqual(['matching'])
    expect(net.fetch).toHaveBeenCalledTimes(2)
  })
})
