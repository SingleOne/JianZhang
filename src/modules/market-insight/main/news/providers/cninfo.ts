import type { MarketNewsItem } from '../../../shared/types'
import type { MarketNewsProvider, NewsQuery } from '../types'
import { decodeHtml, emptyNews, requestJson } from './official-utils'

const STOCK_LIST_URL = 'https://www.cninfo.com.cn/new/data/szse_stock.json'
const ANNOUNCEMENT_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
const PDF_BASE_URL = 'https://static.cninfo.com.cn/'
const REQUEST_HEADERS = {
  Origin: 'https://www.cninfo.com.cn',
  Referer: 'https://www.cninfo.com.cn/',
  'X-Requested-With': 'XMLHttpRequest'
}
interface CninfoStock {
  code?: string
  orgId?: string
  category?: string
}

interface CninfoAnnouncement {
  secCode?: string
  orgId?: string
  announcementId?: string
  announcementTitle?: string
  announcementTime?: number
  adjunctUrl?: string
}

interface CninfoAnnouncementResponse {
  announcements?: CninfoAnnouncement[] | null
}

export class CninfoAnnouncementProvider implements MarketNewsProvider {
  readonly id = 'cninfo-announcement'
  private stockOrganizations: Promise<Map<string, string>> | null = null

  fetchSectorNews = emptyNews
  fetchMarketNews = emptyNews

  async fetchStockNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const organizations = await this.getStockOrganizations()
    const orgId = organizations.get(input.code)
    if (!orgId) return []

    const { column, plate } = this.marketParams(input.code, orgId)
    const body = new URLSearchParams({
      pageNum: '1',
      pageSize: '30',
      column,
      tabName: 'fulltext',
      plate,
      stock: `${input.code},${orgId}`,
      searchkey: '',
      secid: '',
      category: '',
      trade: '',
      seDate: '',
      sortName: 'time',
      sortType: 'desc',
      isHLtitle: 'true'
    })
    const payload = await requestJson<CninfoAnnouncementResponse>(ANNOUNCEMENT_URL, {
      method: 'POST',
      headers: {
        ...REQUEST_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString()
    })

    return (payload.announcements ?? [])
      .filter(
        (item) =>
          item.secCode === input.code &&
          item.announcementId &&
          item.announcementTitle &&
          typeof item.announcementTime === 'number' &&
          item.adjunctUrl
      )
      .map((item): MarketNewsItem => ({
        id: `cninfo:${item.announcementId}`,
        title: decodeHtml(item.announcementTitle!),
        source: '巨潮资讯',
        publishedAt: new Date(item.announcementTime!).toISOString(),
        url: new URL(item.adjunctUrl!, PDF_BASE_URL).toString(),
        category: 'announcement',
        scope: 'stock',
        relatedQuoteIds: [input.quoteId],
        fetchedAt: input.fetchedAt
      }))
  }

  private getStockOrganizations(): Promise<Map<string, string>> {
    if (!this.stockOrganizations) {
      this.stockOrganizations = requestJson<{ stockList?: CninfoStock[] }>(STOCK_LIST_URL, {
        headers: REQUEST_HEADERS
      })
        .then(
          (payload) =>
            new Map(
              (payload.stockList ?? [])
                .filter(
                  (item): item is Required<Pick<CninfoStock, 'code' | 'orgId'>> & CninfoStock =>
                    item.category === 'A股' && Boolean(item.code && item.orgId)
                )
                .map((item) => [item.code, item.orgId])
            )
        )
        .catch((error) => {
          this.stockOrganizations = null
          throw error
        })
    }
    return this.stockOrganizations
  }

  private marketParams(code: string, orgId: string): { column: string; plate: string } {
    if (orgId.includes('bj')) return { column: 'szse', plate: 'bj' }
    if (code.startsWith('6')) return { column: 'sse', plate: 'sh' }
    return { column: 'szse', plate: 'sz' }
  }
}
