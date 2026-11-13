import type { MarketNewsItem } from '../../../shared/types'
import type { MarketNewsProvider, NewsQuery } from '../types'
import { decodeHtml, emptyNews } from './official-utils'
import {
  CninfoClient,
  cninfoMarketParams,
  isCninfoForbidden,
  type CninfoAnnouncementResponse
} from '../../../../../../electron/main/cninfo-client'

const PDF_BASE_URL = 'https://static.cninfo.com.cn/'

export class CninfoAnnouncementProvider implements MarketNewsProvider {
  readonly id = 'cninfo-announcement'
  readonly name = '巨潮资讯'
  constructor(private readonly client = new CninfoClient()) {}

  fetchSectorNews = emptyNews
  fetchMarketNews = emptyNews

  async fetchStockNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const organization = await this.client.getOrganization(input.code)
    if (!organization) return []
    const { orgId } = organization

    const { column, plate } = cninfoMarketParams(input.code, orgId)
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
    let payload: CninfoAnnouncementResponse
    try {
      payload = await this.client.queryAnnouncements(body)
    } catch (error) {
      if (!isCninfoForbidden(error)) throw error
      payload = {
        announcements: await this.client.searchAnnouncements(input.code, organization, '', '', 30)
      }
    }

    return (payload.announcements ?? [])
      .filter(
        (item) =>
          (item.orgId ? item.orgId === orgId : item.secCode === input.code) &&
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
}
