import { net } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CninfoAnnouncementProvider } from './cninfo'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

afterEach(() => vi.unstubAllGlobals())

describe('Cninfo stock news', () => {
  it('uses official search after historical-query 403 and preserves news IDs and links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 }))
    )
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('szse_stock.json')) {
        return Response.json({
          stockList: [{ code: '000001', orgId: 'gssz0000001', category: 'A股', zwjc: '平安银行' }]
        })
      }
      if (url.includes('hisAnnouncement')) return new Response(null, { status: 403 })
      const item = {
        announcementId: 'latest',
        announcementTitle: '<em>平安银行</em>：公司公告',
        announcementTime: Date.parse('2026-11-13T00:00:00+08:00'),
        adjunctUrl: 'finalpage/latest.PDF',
        orgId: 'gssz0000001',
        secCode: '000001'
      }
      return Response.json({
        totalRecordNum: 2,
        announcements: [item, { ...item, announcementId: 'unrelated', orgId: 'other-issuer' }]
      })
    })

    const items = await new CninfoAnnouncementProvider().fetchStockNews({
      code: '000001',
      quoteId: '0.000001',
      fetchedAt: '2026-11-13T13:00:00.000Z',
      newsLookbackDays: 7
    })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'cninfo:latest',
        title: '平安银行：公司公告',
        url: 'https://static.cninfo.com.cn/finalpage/latest.PDF',
        relatedQuoteIds: ['0.000001']
      })
    ])
  })
})
