import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { net } from 'electron'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { CninfoCompanyReportProvider } from './cninfo-company-report-provider'

const STOCKS = {
  stockList: [
    { code: '000001', orgId: 'gssz0000001', category: 'A股', zwjc: '平安银行' },
    { code: '920002', orgId: 'gfbj0873843', category: 'A股', zwjc: '万达轴承' }
  ]
}

function announcement(id: string, title: string, extra = {}) {
  return {
    announcementId: id,
    announcementTitle: title,
    announcementTime: Date.parse('2026-04-15T00:00:00+08:00'),
    adjunctUrl: `finalpage/2026-04-15/${id}.PDF`,
    secCode: '000001',
    orgId: 'gssz0000001',
    ...extra
  }
}

beforeEach(() => {
  vi.mocked(net.fetch).mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 }))
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('CninfoCompanyReportProvider', () => {
  it('keeps historical-query pagination and report IDs when the endpoint works', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('szse_stock.json')) return Response.json(STOCKS)
      const body = new URLSearchParams(init?.body as string)
      if (body.get('category') !== 'category_ndbg_szsh;') {
        return Response.json({ announcements: [], totalAnnouncement: 0 })
      }
      return Response.json({
        announcements: [
          body.get('pageNum') === '1'
            ? announcement('annual', '2025年年度报告')
            : announcement('summary', '2025年年度报告摘要')
        ],
        totalAnnouncement: 31
      })
    })

    const result = await new CninfoCompanyReportProvider().fetch('0.000001')

    expect(result.reports.map((report) => report.id).sort()).toEqual([
      'cninfo:annual',
      'cninfo:summary'
    ])
    expect(net.fetch).toHaveBeenCalledTimes(6)
    expect(
      vi.mocked(net.fetch).mock.calls.some(([url]) => String(url).includes('fulltextSearch'))
    ).toBe(false)
  })

  it('recovers from HTTP 403 using paginated official search and filters unrelated announcements', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('szse_stock.json')) return Response.json(STOCKS)
      if (url.pathname.includes('hisAnnouncement')) return new Response(null, { status: 403 })
      expect(url.pathname).toBe('/new/fulltextSearch/full')
      expect(url.searchParams.get('searchkey')).toBe('平安银行 报告')
      expect(url.searchParams.get('isfulltext')).toBe('false')
      expect(url.searchParams.get('pageSize')).toBe('100')
      expect(url.searchParams.get('sdate')).toMatch(/^\d{4}-01-01$/)
      return Response.json({
        totalRecordNum: 101,
        announcements:
          url.searchParams.get('pageNum') === '1'
            ? [
                announcement('annual', '<em>平安银行</em>：2025年年度报告'),
                announcement('summary', '2025年年度报告摘要'),
                announcement('english', '2025年年度报告（英文版）'),
                announcement('semiannual', '2026年半年度报告（修订版）'),
                announcement('first', '2026年一季度报告'),
                announcement('third', '2026年第三季度报告'),
                announcement('another-issuer', '2025年年度报告', {
                  secCode: '601318',
                  orgId: '9900002221'
                }),
                announcement('wrong-org', '2025年年度报告', { orgId: 'another-company' }),
                announcement('audit', '2025年度内部控制审计报告'),
                announcement('notice', '关于2025年年度报告的更正公告'),
                announcement('meeting', '2025年年度报告暨2026年一季度报告业绩说明会预告公告'),
                announcement('missing-url', '2025年年度报告', { adjunctUrl: null })
              ]
            : [
                announcement('annual', '2025年年度报告'),
                announcement('older', '2024年年度报告', { orgId: undefined })
              ]
      })
    })

    const result = await new CninfoCompanyReportProvider().fetch('0.000001')

    expect(result).toMatchObject({ quoteId: '0.000001', source: '巨潮资讯', fromCache: false })
    expect(result.reports.map((report) => report.id).sort()).toEqual(
      ['annual', 'summary', 'english', 'semiannual', 'first', 'third', 'older']
        .map((id) => `cninfo:${id}`)
        .sort()
    )
    expect(result.reports.find((report) => report.id === 'cninfo:annual')).toMatchObject({
      reportType: 'annual',
      reportYear: 2025,
      title: '2025年年度报告',
      url: 'https://static.cninfo.com.cn/finalpage/2026-04-15/annual.PDF'
    })
    expect(result.reports.find((report) => report.id === 'cninfo:semiannual')).toMatchObject({
      reportType: 'semiannual',
      amended: true
    })
    expect(result.reports.find((report) => report.id === 'cninfo:english')?.variant).toBe('english')
    expect(result.reports.find((report) => report.id === 'cninfo:summary')?.variant).toBe('summary')
    expect(result.reports.find((report) => report.id === 'cninfo:first')?.reportType).toBe(
      'firstQuarter'
    )
    expect(result.reports.find((report) => report.id === 'cninfo:third')?.reportType).toBe(
      'thirdQuarter'
    )
    expect(
      vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).includes('fulltextSearch'))
    ).toHaveLength(2)
  })

  it('matches a Beijing issuer by its stable orgId after a stock-code change', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('szse_stock.json')) return Response.json(STOCKS)
      if (url.pathname.includes('hisAnnouncement')) return new Response(null, { status: 403 })
      expect(url.searchParams.get('searchkey')).toBe('万达轴承 报告')
      return Response.json({
        totalAnnouncement: 1,
        announcements: [
          announcement('old-code', '[定期报告]<em>万达轴承</em>:2023年年度报告', {
            secCode: '873843',
            orgId: 'gfbj0873843'
          })
        ]
      })
    })

    const result = await new CninfoCompanyReportProvider().fetch('0.920002')

    expect(result.reports).toHaveLength(1)
    expect(result.reports[0]).toMatchObject({
      id: 'cninfo:old-code',
      quoteId: '0.920002',
      code: '920002',
      reportType: 'annual',
      reportYear: 2023
    })
  })

  it('propagates fallback failure so the service can retain its existing cache', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('szse_stock.json')) return Response.json(STOCKS)
      return new Response(null, { status: url.includes('hisAnnouncement') ? 403 : 503 })
    })

    await expect(new CninfoCompanyReportProvider().fetch('0.000001')).rejects.toThrow('HTTP 503')
  })

  it.each([429, 500])('preserves HTTP %i without starting another query route', async (status) => {
    vi.mocked(net.fetch).mockImplementation(async (input) =>
      String(input).endsWith('szse_stock.json')
        ? Response.json(STOCKS)
        : new Response(null, { status })
    )

    await expect(new CninfoCompanyReportProvider().fetch('0.000001')).rejects.toThrow(
      `HTTP ${status}`
    )
    expect(
      vi.mocked(net.fetch).mock.calls.some(([url]) => String(url).includes('fulltextSearch'))
    ).toBe(false)
  })

  it('allows retrying the stock directory after an initial failure', async () => {
    vi.mocked(net.fetch).mockImplementation(async () => new Response(null, { status: 403 }))
    const provider = new CninfoCompanyReportProvider()
    await expect(provider.fetch('0.000001')).rejects.toThrow('HTTP 403')
    vi.mocked(net.fetch).mockImplementation(async (input) =>
      Response.json(String(input).endsWith('szse_stock.json') ? STOCKS : { announcements: [] })
    )

    expect((await provider.fetch('0.000001')).reports).toEqual([])
  })
})
