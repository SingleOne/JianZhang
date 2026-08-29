import type { MarketNewsItem } from '../../../shared/types'
import type { MarketNewsProvider, NewsQuery } from '../types'
import {
  absoluteUrl,
  chinaDateTimeToIso,
  decodeHtml,
  emptyNews,
  requestJson,
  requestText,
  sourceId
} from './official-utils'

abstract class MarketOnlyProvider implements MarketNewsProvider {
  abstract readonly id: string
  private cache: { items: MarketNewsItem[]; expiresAt: number; lookbackDays: number } | null = null
  private refresh: { task: Promise<MarketNewsItem[]>; lookbackDays: number } | null = null

  fetchStockNews = emptyNews
  fetchSectorNews = emptyNews

  fetchMarketNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    if (
      this.cache &&
      this.cache.expiresAt > Date.now() &&
      this.cache.lookbackDays >= input.newsLookbackDays
    )
      return Promise.resolve(this.cache.items)
    if (this.refresh) {
      return this.refresh.lookbackDays >= input.newsLookbackDays
        ? this.refresh.task
        : this.refresh.task.then(() => this.fetchMarketNews(input))
    }
    const task = this.loadMarketNews(input)
      .then((items) => {
        this.cache = {
          items,
          expiresAt: Date.now() + 10 * 60_000,
          lookbackDays: input.newsLookbackDays
        }
        return items
      })
      .finally(() => {
        this.refresh = null
      })
    this.refresh = { task, lookbackDays: input.newsLookbackDays }
    return task
  }

  protected abstract loadMarketNews(input: NewsQuery): Promise<MarketNewsItem[]>
}

interface CsrcListResponse {
  data?: {
    results?: Array<{
      title?: string
      url?: string
      publishedTimeStr?: string
    }>
  }
}

export class CsrcNewsProvider extends MarketOnlyProvider {
  readonly id = 'csrc-news'

  protected async loadMarketNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const pageSize = input.newsLookbackDays > 7 ? 100 : 20
    const url = `https://www.csrc.gov.cn/searchList/a1a078ee0bc54721ab6b148884c784a8?_isAgg=true&_isJson=true&_pageSize=${pageSize}&_template=index&_rangeTimeGte=&_channelName=&page=1`
    const payload = await requestJson<CsrcListResponse>(url, {
      headers: { Referer: 'https://www.csrc.gov.cn/csrc/c100028/common_xq_list.shtml' }
    })
    return (payload.data?.results ?? []).flatMap((item): MarketNewsItem[] => {
      if (!item.title || !item.url || !item.publishedTimeStr) return []
      const itemUrl = absoluteUrl(item.url, 'https://www.csrc.gov.cn/')
      const publishedAt = chinaDateTimeToIso(item.publishedTimeStr)
      if (!publishedAt) return []
      return [
        {
          id: sourceId('csrc', itemUrl),
          title: decodeHtml(item.title),
          source: '中国证监会',
          publishedAt,
          url: itemUrl,
          category: 'policy',
          scope: 'market',
          relatedQuoteIds: [],
          fetchedAt: input.fetchedAt
        }
      ]
    })
  }
}

export class SseNoticeProvider extends MarketOnlyProvider {
  readonly id = 'sse-notice'

  protected async loadMarketNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const pageUrl = 'https://www.sse.com.cn/disclosure/announcement/general/s_list.shtml'
    const html = await requestText(pageUrl, {
      headers: { Referer: 'https://www.sse.com.cn/disclosure/announcement/general/' }
    })
    const pattern =
      /<dd>\s*<span>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>\s*<a[^>]+href="([^"]+)"[^>]+title="([^"]+)"/gi
    const limit = input.newsLookbackDays > 7 ? 100 : 20
    return [...html.matchAll(pattern)].slice(0, limit).map((match): MarketNewsItem => {
      const itemUrl = absoluteUrl(match[2], pageUrl)
      return {
        id: sourceId('sse', itemUrl),
        title: decodeHtml(match[3]),
        source: '上海证券交易所',
        publishedAt: chinaDateTimeToIso(match[1]),
        url: itemUrl,
        category: 'announcement',
        scope: 'market',
        relatedQuoteIds: [],
        fetchedAt: input.fetchedAt
      }
    })
  }
}

export class SzseNoticeProvider extends MarketOnlyProvider {
  readonly id = 'szse-notice'

  protected async loadMarketNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const pageUrl = 'https://www.szse.cn/disclosure/notice/general/index.html'
    const html = await requestText(pageUrl, {
      headers: { Referer: 'https://www.szse.cn/' }
    })
    const pattern =
      /var curHref\s*=\s*'([^']+)'[\s\S]{0,500}?var curTitle\s*=\s*'([^']+)'[\s\S]{0,1800}?<span class="time">\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/gi
    const limit = input.newsLookbackDays > 7 ? 100 : 20
    return [...html.matchAll(pattern)].slice(0, limit).map((match): MarketNewsItem => {
      const itemUrl = absoluteUrl(match[1], pageUrl)
      return {
        id: sourceId('szse', itemUrl),
        title: decodeHtml(match[2]),
        source: '深圳证券交易所',
        publishedAt: chinaDateTimeToIso(match[3]),
        url: itemUrl,
        category: 'announcement',
        scope: 'market',
        relatedQuoteIds: [],
        fetchedAt: input.fetchedAt
      }
    })
  }
}

export class BseNoticeProvider extends MarketOnlyProvider {
  readonly id = 'bse-notice'

  protected async loadMarketNews(input: NewsQuery): Promise<MarketNewsItem[]> {
    const pageUrl = 'https://www.bse.cn/disclosure/vocational.html'
    const pageSize = input.newsLookbackDays > 7 ? 100 : 20
    const endpoint = `https://www.bse.cn/disclosureInfoController/stockInfoResult.do?callback=marketInsight&page=0&pageSize=${pageSize}&disclosureType=9506&siteId=6&xxfcbj=2`
    const response = await requestText(endpoint, {
      method: 'POST',
      headers: { Referer: 'https://www.bse.cn/' }
    })
    const json = response.match(/^marketInsight\(([\s\S]+)\)\s*;?\s*$/)?.[1]
    if (!json) throw new Error('北交所公告响应格式发生变化')
    const payload = JSON.parse(json) as Array<{
      listInfo?: {
        content?: Array<{
          disclosureCode?: string
          disclosurePostTitle?: string
          disclosureTitle?: string
          destFilePath?: string
          infoId?: number
          publishDate?: string
        }>
      }
    }>
    return (payload[0]?.listInfo?.content ?? []).flatMap((item): MarketNewsItem[] => {
      if (!item.disclosureTitle || !item.destFilePath || !item.publishDate) return []
      const itemUrl = absoluteUrl(item.destFilePath, pageUrl)
      return [
        {
          id: item.disclosureCode
            ? `bse:${item.disclosureCode}`
            : item.infoId
              ? `bse:${item.infoId}`
              : sourceId('bse', itemUrl),
          title: decodeHtml(`${item.disclosureTitle}${item.disclosurePostTitle ?? ''}`),
          source: '北京证券交易所',
          publishedAt: chinaDateTimeToIso(item.publishDate),
          url: itemUrl,
          category: 'announcement',
          scope: 'market',
          relatedQuoteIds: [],
          fetchedAt: input.fetchedAt
        }
      ]
    })
  }
}
